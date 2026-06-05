/**
 * Output Guard Extension - Global fallback truncation + tool limit optimization.
 *
 * Aligns pi-momo-fork's truncation strategy with OpenCode's approach:
 *
 * OpenCode has a global truncation layer in `Tool.define()` that checks
 * `metadata.truncated` - if undefined, applies 50KB/2000-line truncation
 * and saves full output to disk. Plugin/MCP tools are wrapped in
 * `fromPlugin()` with `Truncate.output()` built in.
 *
 * Pi lacks this global layer. This extension fills the gap via `tool_result`
 * event hooks, providing equivalent protection for:
 * - Extension/plugin tools (no built-in truncation)
 * - MCP tools (no built-in truncation)
 * - Any future tool that forgets to self-manage
 *
 * Three capabilities:
 *
 * 1. **Global truncation fallback**: Intercepts `tool_result` for tools that
 *    don't self-manage truncation. Applies 50KB/2000-line limit, saves full
 *    output to `<sessionDataDir>/tool-output/`, returns truncated preview
 *    with actionable file path hint.
 *
 * 2. **Tool limit optimization**: Intercepts `tool_call` to enforce lower
 *    result limits on find (1000 -> 100) and ls (500 -> 100), matching
 *    OpenCode's glob/ls defaults. Reduces unnecessary context consumption.
 *
 * 3. **PDF text extraction**: Registers a `pdf_read` tool that extracts text
 *    from PDF files. OpenCode sends PDFs as raw base64 to the model; Pi's
 *    read tool doesn't support PDFs at all. This tool uses pdf-parse for
 *    text extraction, which is more token-efficient than base64 encoding.
 *
 * Configuration (via .pi/settings.json `outputGuard` key):
 *   maxLines: number (default: 2000)
 *   maxBytes: number (default: 51200 = 50KB)
 *   findLimit: number (default: 100)
 *   lsLimit: number (default: 100)
 *   saveToFile: boolean (default: true)
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as nodePathResolve } from "node:path";
import { createRequire } from "node:module";
import { Type } from "typebox";
import type {
	ExtensionFactory,
	ToolResultEvent,
	ToolResultEventResult,
	ToolCallEvent,
	ToolCallEventResult,
	ExtensionContext,
} from "@dyyz1993/pi-coding-agent";

// ============================================================================
// Constants
// ============================================================================

/** Matches OpenCode's MAX_LINES */
const DEFAULT_MAX_LINES = 2000;
/** Matches OpenCode's MAX_BYTES */
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
/** Matches OpenCode's glob limit of 100 */
const DEFAULT_FIND_LIMIT = 100;
/** Matches OpenCode's ls limit of 100 */
const DEFAULT_LS_LIMIT = 100;

/**
 * Built-in tools that self-manage truncation.
 * These tools set details.truncation and handle their own size limits,
 * so the global fallback must skip them (matches OpenCode's
 * `metadata.truncated !== undefined` check).
 */
const SELF_MANAGED_TOOLS = new Set(["read", "bash", "grep", "find", "ls"]);

// ============================================================================
// Configuration
// ============================================================================

interface OutputGuardConfig {
	maxLines: number;
	maxBytes: number;
	findLimit: number;
	lsLimit: number;
	saveToFile: boolean;
}

function loadConfig(_ctx: ExtensionContext): OutputGuardConfig {
	// Note: ExtensionContext does not expose settings. User configuration
	// via .pi/settings.json is not currently supported. Use defaults only.
	// TODO: When ExtensionAPI exposes a settings accessor, wire it here.
	return {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
		findLimit: DEFAULT_FIND_LIMIT,
		lsLimit: DEFAULT_LS_LIMIT,
		saveToFile: true,
	};
}

// ============================================================================
// Truncation Logic (mirrors OpenCode's Truncate.output)
// ============================================================================

interface TruncationInfo {
	truncated: boolean;
	content: string;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	truncatedBy: "lines" | "bytes" | null;
	fullOutputPath?: string;
	headLines: number;
	tailLines: number;
	omittedLines: number;
}

const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.3;

function collectLinesBudget(
	lines: string[],
	maxLines: number,
	maxBytes: number,
	direction: "head" | "tail",
): { lines: string[]; bytes: number; truncatedBy: "lines" | "bytes" } {
	const result: string[] = [];
	let bytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	if (direction === "head") {
		for (let i = 0; i < lines.length && result.length < maxLines; i++) {
			const lineBytes = Buffer.byteLength(lines[i], "utf-8") + (result.length > 0 ? 1 : 0);
			if (bytes + lineBytes > maxBytes) {
				truncatedBy = "bytes";
				break;
			}
			result.push(lines[i]);
			bytes += lineBytes;
		}
		if (result.length >= maxLines && bytes <= maxBytes) truncatedBy = "lines";
	} else {
		for (let i = lines.length - 1; i >= 0 && result.length < maxLines; i--) {
			const lineBytes = Buffer.byteLength(lines[i], "utf-8") + (result.length > 0 ? 1 : 0);
			if (bytes + lineBytes > maxBytes) {
				truncatedBy = "bytes";
				break;
			}
			result.unshift(lines[i]);
			bytes += lineBytes;
		}
		if (result.length >= maxLines && bytes <= maxBytes) truncatedBy = "lines";
	}

	return { lines: result, bytes, truncatedBy };
}

function truncateOutput(
	content: string,
	config: OutputGuardConfig,
	ctx: ExtensionContext,
): TruncationInfo {
	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	if (totalLines <= config.maxLines && totalBytes <= config.maxBytes) {
		return {
			truncated: false,
			content,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			truncatedBy: null,
			headLines: totalLines,
			tailLines: 0,
			omittedLines: 0,
		};
	}

	const noticeOverhead = 300;
	const budgetBytes = Math.max(config.maxBytes - noticeOverhead, config.maxBytes * 0.8);
	const budgetLines = Math.max(config.maxLines - 6, Math.floor(config.maxLines * 0.95));

	const headLineBudget = Math.max(1, Math.floor(budgetLines * HEAD_RATIO));
	const tailLineBudget = Math.max(1, Math.floor(budgetLines * TAIL_RATIO));
	const headByteBudget = Math.max(1024, Math.floor(budgetBytes * HEAD_RATIO));
	const tailByteBudget = Math.max(1024, Math.floor(budgetBytes * TAIL_RATIO));

	const head = collectLinesBudget(lines, headLineBudget, headByteBudget, "head");
	const tailLinesSlice = lines.slice(totalLines - tailLineBudget * 2);
	const tail = collectLinesBudget(tailLinesSlice, tailLineBudget, tailByteBudget, "tail");

	const headCount = head.lines.length;
	const tailCount = tail.lines.length;
	const omittedLines = totalLines - headCount - tailCount;
	const truncatedBy = head.truncatedBy === "bytes" || tail.truncatedBy === "bytes" ? "bytes" : "lines";

	const truncatedContent = head.lines.join("\n");
	const finalOutputBytes = Buffer.byteLength(
		truncatedContent + "\n\n" + buildInlineNotice(totalLines, headCount, tailCount, omittedLines) + "\n\n" + tail.lines.join("\n"),
		"utf-8",
	);
	let fullOutputPath: string | undefined;

	// Save full output to disk (matches OpenCode's behavior)
	if (config.saveToFile) {
		fullOutputPath = saveFullOutput(content, ctx);
	}

	return {
		truncated: true,
		content: truncatedContent,
		totalLines,
		totalBytes,
		outputLines: headCount + tailCount,
		outputBytes: finalOutputBytes,
		truncatedBy,
		fullOutputPath,
		headLines: headCount,
		tailLines: tailCount,
		omittedLines,
	};
}

/**
 * Save full output to disk.
 * Path format: /tmp/<project-slug>/tool-output/output-<ts>-<rand>.log
 * where project-slug is the projectRoot with "/" replaced by "-".
 */
function saveFullOutput(content: string, ctx: ExtensionContext): string | undefined {
	try {
		const id = `output-${Date.now()}-${randomBytes(4).toString("hex")}`;
		const projectSlug = (ctx.projectRoot || ctx.cwd || "unknown")
			.replace(/\/+$/, "")
			.replace(/\//g, "-");
		const dir = join(tmpdir(), projectSlug, "tool-output");
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const filePath = join(dir, `${id}.txt`);
		fsWriteFileSync(filePath, content);
		return filePath;
	} catch {
		return undefined;
	}
}

// ============================================================================
// Extension Entry Point
// ============================================================================

const factory: ExtensionFactory = (pi) => {
	pi.setName("output-guard");
	let truncatedCount = 0;
	let limitAdjustedCount = 0;
	// ------------------------------------------------------------------
	// 1. Global truncation fallback via tool_result hook
	//
	// Mirrors OpenCode's Tool.define() wrapper:
	//   if (result.metadata.truncated === undefined) {
	//     result.output = Truncate.output(result.output)
	//   }
	//
	// In pi, the equivalent is: if a tool's details doesn't have a
	// truncation field AND the tool isn't a known self-managing tool,
	// apply truncation.
	// ------------------------------------------------------------------
	pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext): Promise<ToolResultEventResult | void> => {
		const config = loadConfig(ctx);

		// Only process text content
		const textParts = event.content.filter((p): p is { type: "text"; text: string } => p.type === "text");
		if (textParts.length === 0) return;

		// Skip tools that self-manage truncation
		// (matches OpenCode's `metadata.truncated !== undefined` check)
		if (hasSelfManagedTruncation(event)) return;

		// Skip image content - images have their own size management
		// (matches OpenCode's `metadata.truncated = false` for images)
		const hasImages = event.content.some((p) => p.type === "image");
		if (hasImages) return;

		// Concatenate all text parts
		const fullText = textParts.map((p) => p.text).join("\n");
		const totalBytes = Buffer.byteLength(fullText, "utf-8");
		const totalLines = fullText.split("\n").length;

		// Skip if within limits
		if (totalLines <= config.maxLines && totalBytes <= config.maxBytes) return;

		// Truncate
		const result = truncateOutput(fullText, config, ctx);
		truncatedCount++;

		let finalContent: string;
		if (result.truncated) {
			const allLines = fullText.split("\n");
			const headText = allLines.slice(0, result.headLines).join("\n");
			const tailText = allLines.slice(allLines.length - result.tailLines).join("\n");
			const inlineNotice = buildInlineNotice(result.totalLines, result.headLines, result.tailLines, result.omittedLines);
			const fileNotice = buildFileNotice(result, config);
			finalContent = headText + "\n\n" + inlineNotice + fileNotice + "\n\n" + tailText;
		} else {
			finalContent = result.content;
		}

		console.debug(
			`[output-guard] truncated tool "${event.toolName}": ${result.totalLines} lines / ${result.totalBytes} bytes → ${result.outputLines} lines / ${result.outputBytes} bytes (truncatedBy: ${result.truncatedBy ?? "none"}, path: ${result.fullOutputPath ?? "N/A"})`,
		);
		pi.appendEntry("output_guard_truncate", {
			toolName: event.toolName,
			totalLines: result.totalLines,
			totalBytes: result.totalBytes,
			outputLines: result.outputLines,
			outputBytes: result.outputBytes,
			truncated: result.truncated,
			truncatedBy: result.truncatedBy,
			fullOutputPath: result.fullOutputPath,
			truncatedCount,
		});

		return {
			content: [{ type: "text" as const, text: finalContent }],
		};
	});

	// ------------------------------------------------------------------
	// 2. Tool limit optimization via tool_call hook
	//
	// OpenCode: glob=100, ls=100
	// Pi default: find=1000, ls=500
	// This hook reduces Pi's limits to match OpenCode.
	// ------------------------------------------------------------------
	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | void> => {
		const config = loadConfig(ctx);

		// Enforce lower limits on find tool
		if (event.toolName === "find") {
			const input = event.input as { limit?: number };
			if (input.limit === undefined || input.limit > config.findLimit) {
				console.debug(`[output-guard] capped find limit: ${input.limit ?? "unlimited"} → ${config.findLimit}`);
				input.limit = config.findLimit;
				limitAdjustedCount++;
			}
		}

		// Enforce lower limits on ls tool
		if (event.toolName === "ls") {
			const input = event.input as { limit?: number };
			if (input.limit === undefined || input.limit > config.lsLimit) {
				console.debug(`[output-guard] capped ls limit: ${input.limit ?? "unlimited"} → ${config.lsLimit}`);
				input.limit = config.lsLimit;
				limitAdjustedCount++;
			}
		}
	});

	// ------------------------------------------------------------------
	// 3. PDF text extraction tool
	//
	// OpenCode sends PDFs as raw base64 attachments (no text extraction).
	// Pi's read tool doesn't support PDFs at all (outputs binary garbage).
	// This tool uses pdf-parse to extract text, which is more token-efficient.
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "pdf_read",
		label: "pdf_read",
		description:
			"Read and extract text content from a PDF file. " +
			"Returns the text content of the PDF with metadata. " +
			"Use this instead of the read tool for PDF files.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the PDF file" }),
			maxPages: Type.Optional(
				Type.Number({ description: "Maximum number of pages to extract (default: all pages)" }),
			),
		}),
		execute: async (
			toolCallId: string,
			args: { path: string; maxPages?: number },
			_signal?: AbortSignal,
			_onUpdate?: unknown,
			ctx?: ExtensionContext,
		) => {
			const absolutePath = nodePathResolve(ctx?.cwd ?? process.cwd(), args.path);

			// Check file exists
			try {
				const stat = await fsStat(absolutePath);
				if (!stat.isFile()) {
					return { content: [{ type: "text" as const, text: `Error: ${args.path} is not a file` }], isError: true, details: {} };
				}
			} catch {
				return { content: [{ type: "text" as const, text: `Error: File not found: ${args.path}` }], isError: true, details: {} };
			}

			// Read PDF
			try {
				const buffer = await fsReadFile(absolutePath);

				console.debug(`[output-guard] pdf_read: ${args.path} (${buffer.length} bytes, pages: ${args.maxPages ?? "all"})`);

				// Dynamic import of pdf-parse (optional dependency)
				let pdfParse: ((buffer: Buffer) => Promise<{ text: string; numpages: number; info?: { Title?: string; Author?: string } }>) | undefined;
				try {
					const req = createRequire(import.meta.url);
					const raw = req("pdf-parse");
					pdfParse = (typeof raw === "function" ? raw : raw.default) as typeof pdfParse;
				} catch {
					console.debug("[output-guard] pdf_read failed: pdf-parse not installed");
					pi.appendEntry("output_guard_pdf_error", {
						path: args.path,
						error: "pdf-parse not installed",
					});
				return {
					content: [
						{
							type: "text" as const,
							text: "Error: pdf-parse is not installed. Install it with: npm install pdf-parse",
						},
					],
					isError: true,
					details: {},
				};
				}

				const data = await pdfParse!(buffer);
				let text = data.text;

				console.debug(`[output-guard] pdf_read success: ${args.path} (${data.numpages} pages, ${text.length} chars extracted)`);
				pi.appendEntry("output_guard_pdf_read", {
					path: args.path,
					pages: data.numpages,
					chars: text.length,
					title: data.info?.Title ?? null,
					author: data.info?.Author ?? null,
				});

				// Add metadata header
				const header = [
					`PDF: ${args.path}`,
					`Pages: ${data.numpages}`,
					data.info?.Title ? `Title: ${data.info.Title}` : "",
					data.info?.Author ? `Author: ${data.info.Author}` : "",
					"---",
				]
					.filter(Boolean)
					.join("\n");

				// Truncate if needed
				const config = ctx ? loadConfig(ctx) : { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES, findLimit: DEFAULT_FIND_LIMIT, lsLimit: DEFAULT_LS_LIMIT, saveToFile: true };
				const totalBytes = Buffer.byteLength(text, "utf-8");
				const totalLines = text.split("\n").length;

				if (totalLines > config.maxLines || totalBytes > config.maxBytes) {
					const truncResult = ctx ? truncateOutput(text, config, ctx) : null;
					if (truncResult && truncResult.truncated) {
						const allLines = text.split("\n");
						const headText = allLines.slice(0, truncResult.headLines).join("\n");
						const tailText = allLines.slice(allLines.length - truncResult.tailLines).join("\n");
						const inlineNotice = buildInlineNotice(truncResult.totalLines, truncResult.headLines, truncResult.tailLines, truncResult.omittedLines);
						const fileNotice = buildFileNotice(truncResult, config);
						text = headText + "\n\n" + inlineNotice + fileNotice + "\n\n" + tailText;
					}
				}

				return {
					content: [{ type: "text" as const, text: header + "\n" + text }],
					details: {},
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Error reading PDF: ${message}` }],
					isError: true,
					details: {},
				};
			}
		},
	});
};
export default factory;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a tool already self-manages truncation.
 *
 * Mirrors OpenCode's check: `result.metadata.truncated !== undefined`.
 * In pi, built-in tools set `details.truncation`, and any tool can opt in
 * by including a `truncation` field in its details.
 */
function hasSelfManagedTruncation(event: ToolResultEvent): boolean {
	// Built-in tools that self-manage truncation
	if (SELF_MANAGED_TOOLS.has(event.toolName)) return true;

	// Check if details has a truncation field (any tool can opt in)
	const details = event.details as Record<string, unknown> | undefined;
	if (details && typeof details === "object" && "truncation" in details) return true;

	return false;
}

function buildInlineNotice(totalLines: number, headLines: number, tailLines: number, omittedLines: number): string {
	return `--- ... ${omittedLines} lines omitted (showing ${headLines} head + ${tailLines} tail of ${totalLines} total) ... ---`;
}

function buildFileNotice(info: TruncationInfo, config: OutputGuardConfig): string {
	const parts: string[] = [];
	if (info.truncatedBy === "bytes") {
		parts.push(`Output exceeded ${formatBytes(config.maxBytes)} byte limit (${formatBytes(info.totalBytes)} total).`);
	}
	if (info.fullOutputPath) {
		parts.push(`Full output saved to: ${info.fullOutputPath}`);
		parts.push("Use grep to search within it, or read with offset to paginate.");
	}
	return parts.length > 0 ? "\n" + parts.join("\n") : "";
}

function buildTruncationNotice(info: TruncationInfo, config: OutputGuardConfig): string {
	const parts: string[] = [];

	if (info.truncatedBy === "lines") {
		const omitted = info.totalLines - info.outputLines;
		parts.push(`...${omitted} lines truncated.`);
		parts.push(`Output exceeded ${config.maxLines} line limit (${info.totalLines} total lines).`);
	} else if (info.truncatedBy === "bytes") {
		parts.push(`...output truncated at ${formatBytes(info.outputBytes)}.`);
		parts.push(`Output exceeded ${formatBytes(config.maxBytes)} byte limit (${formatBytes(info.totalBytes)} total).`);
	}

	if (info.fullOutputPath) {
		parts.push(`Full output saved to: ${info.fullOutputPath}`);
		parts.push("Use grep to search within it, or read with offset to paginate.");
	}

	return parts.join("\n");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
