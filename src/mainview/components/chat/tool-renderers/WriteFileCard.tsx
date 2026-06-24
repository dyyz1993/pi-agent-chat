import { memo, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../../shared/lib/logger";
import type { ContentBlock } from "../../../types";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { CopyButton } from "../CopyButton";
import { InlineCodeViewer } from "./InlineCodeViewer";
import { ToolCardHeader } from "../primitives/ToolCardHeader";
import type { LspDiagnosticFile } from "../primitives/LspDiagnosticList";
import { InlineDiffViewer } from "./InlineDiffViewer";
import {
  formatFilePath,
  formatToolHeaderPath,
  useKnownProjectRoots,
} from "../../../lib/format-path";
import { parseUnifiedDiff } from "../../../lib/diff-utils";
import { useAutoCollapse } from "../../../hooks/use-auto-collapse";
import { ContextReferenceCard, type ContextReference } from "../ContextReferenceCard";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

const logger = createLogger("chat");

interface WriteToolArgs {
  path: string;
  content: string;
}

interface EditToolArgs {
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
}

interface EditToolDetails {
  diff: string;
  firstChangedLine?: number;
}

interface LspDiagnosticData {
  files?: LspDiagnosticFile[];
}

function isLspDiagnosticData(d: unknown): d is LspDiagnosticData {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return Array.isArray(obj.files);
}

function isEditToolDetails(d: unknown): d is EditToolDetails {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return typeof obj.diff === "string";
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdc", ".mdx", ".markdown"]);

function isMarkdownFile(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  const lower = path.toLowerCase();
  for (const ext of MARKDOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function parseWriteArgs(args: string): WriteToolArgs {
  try {
    const parsed: unknown = JSON.parse(args || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      return {
        path: typeof obj.path === "string" ? obj.path : "",
        content: typeof obj.content === "string" ? obj.content : "",
      };
    }
  } catch (e) {
    logger.warn("Failed to parse write args", { error: String(e) });
  }
  return { path: "", content: "" };
}

function parseEditArgs(args: string): EditToolArgs {
  try {
    const parsed: unknown = JSON.parse(args || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const edits = Array.isArray(obj.edits)
        ? (obj.edits.filter(
            (e: unknown) =>
              e &&
              typeof e === "object" &&
              typeof (e as Record<string, unknown>).oldText === "string" &&
              typeof (e as Record<string, unknown>).newText === "string",
          ) as Array<{ oldText: string; newText: string }>)
        : [];
      return {
        path: typeof obj.path === "string" ? obj.path : "",
        edits,
      };
    }
  } catch (e) {
    logger.warn("Failed to parse edit args", { error: String(e) });
  }
  return { path: "", edits: [] };
}

function isEditTool(block: Block): boolean {
  return block.toolName.toLowerCase() === "edit";
}

export const WriteFileCard = memo(function WriteFileCard({
  block,
  blockId,
}: {
  block: Block;
  blockId?: string;
}) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const isEdit = isEditTool(block);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("chat");
  const projectRoots = useKnownProjectRoots();

  const [collapsed, setCollapsed] = useAutoCollapse(isRunning);

  const writeArgs = useMemo(() => parseWriteArgs(block.args), [block.args]);
  const editArgs = useMemo(() => parseEditArgs(block.args), [block.args]);
  const filePath = isEdit ? editArgs.path : writeArgs.path;
  const fileContent = writeArgs.content;

  useEffect(() => {
    if (scrollContainerRef.current && !isRunning && fileContent) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [fileContent, isRunning]);

  const displayPath = filePath
    ? formatToolHeaderPath(filePath, projectRoots)
    : block.args?.slice(0, 80) || block.toolName;
  const isMd = isMarkdownFile(filePath);
  const hasContent = (fileContent ?? "").length > 0;

  const lspDetails = isLspDiagnosticData(block.details) ? block.details : null;
  const lspReferences: ContextReference[] =
    lspDetails?.files?.map((file, index) => {
      const issueCount = file.issues.length;
      const firstIssue = file.issues[0];
      return {
        id: `lsp:${file.filePath}:${index}`,
        kind: "lsp",
        title: formatFilePath(file.filePath),
        subtitle: `${issueCount} issue${issueCount === 1 ? "" : "s"}${firstIssue ? ` · L${firstIssue.line}` : ""}`,
        path: file.filePath,
        line: firstIssue?.line,
        status: file.issues.some((issue) => issue.severity === 1) ? "error" : "warning",
        detail: file.summary,
      };
    }) ?? [];
  const editDetails = isEdit ? (isEditToolDetails(block.details) ? block.details : null) : null;
  const diffData = useMemo(() => {
    if (!editDetails?.diff) return null;
    return parseUnifiedDiff(editDetails.diff);
  }, [editDetails?.diff]);

  const copyContent = useMemo(() => {
    if (isEdit && editDetails?.diff) return editDetails.diff;
    return fileContent;
  }, [isEdit, editDetails?.diff, fileContent]);

  return (
    <div
      data-block-id={blockId}
      className={`border-x-0 border-t border-b overflow-hidden ${
        isRunning
          ? "border-status-success/25 bg-status-success/5"
          : isError
            ? "border-status-error/15 bg-status-error/5"
            : "border-border-secondary/30 bg-surface-dim"
      }`}
    >
      <ToolCardHeader
        toolName={isEditTool(block) ? "edit" : "write"}
        status={isRunning ? "running" : isError ? "error" : "done"}
        description={displayPath}
        mono
        rtl
        collapsed={collapsed}
        onClick={() => setCollapsed(!collapsed)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          isRunning ? (
            <span className="text-[10px] text-status-success animate-pulse shrink-0">
              {t("writeFile.writing")}
            </span>
          ) : copyContent ? (
            <div onClick={(e) => e.stopPropagation()}>
              <CopyButton text={copyContent} />
            </div>
          ) : undefined
        }
      />

      {collapsed ? null : (
        <>
          {isEdit && !isRunning ? (
            <div className="px-2 pb-2">
              {diffData ? (
                <InlineDiffViewer
                  oldValue={diffData.oldValue}
                  newValue={diffData.newValue}
                  maxHeight="250px"
                  showToggle
                  filePath={filePath}
                />
              ) : editArgs.edits.length > 0 ? (
                <div className="px-1">
                  {editArgs.edits.map((edit, i) => (
                    <div key={i} className="mb-1 last:mb-0">
                      <div className="text-[10px] text-status-error/70 font-mono bg-status-error/5 px-2 py-1 rounded-t">
                        - {edit.oldText}
                      </div>
                      <div className="text-[10px] text-status-success/70 font-mono bg-status-success/5 px-2 py-1 rounded-b">
                        + {edit.newText}
                      </div>
                    </div>
                  ))}
                </div>
              ) : block.output ? (
                <pre className="text-[11px] text-text-primary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-surface-code rounded mx-1 px-2 py-1.5">
                  {block.output}
                </pre>
              ) : null}
            </div>
          ) : isMd && hasContent ? (
            <div
              ref={scrollContainerRef}
              className="px-3 pb-2 max-h-40 overflow-y-auto bg-surface-code rounded-sm mx-2 mb-2"
            >
              <div className="px-2 py-2 prose prose-sm prose-gray dark:prose-invert max-w-none overflow-auto prose-p:my-1 prose-pre:bg-surface-hover dark:prose-pre:bg-black/30 prose-pre:rounded prose-pre:px-2 prose-pre:py-1.5 prose-headings:text-text-primary dark:prose-headings:text-text-secondary prose-a:text-semantic-accent prose-code:text-pink-600 dark:prose-code:text-pink-300 prose-code:before:content-[''] prose-code:after:content-[''] prose-code:bg-surface-hover dark:prose-code:bg-surface-dim/60 prose-code:px-1 prose-code:rounded prose-code:text-[11px] prose-strong:text-text-primary dark:prose-strong:text-text-secondary prose-blockquote:border-l-semantic-accent/50 prose-blockquote:text-text-secondary dark:prose-blockquote:text-text-tertiary prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1">
                <CachedReactMarkdown>{fileContent}</CachedReactMarkdown>
              </div>
            </div>
          ) : !isMd && hasContent && !isRunning ? (
            <div className="px-2 pb-2">
              <InlineCodeViewer code={fileContent} filename={filePath} maxHeight="250px" />
            </div>
          ) : (
            <div className="px-3 pb-2">
              {block.output ? (
                <pre className="text-[11px] text-text-primary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-surface-code rounded px-2 py-1.5">
                  {block.output}
                </pre>
              ) : isRunning ? (
                <div className="text-[11px] text-text-tertiary italic py-1">
                  {t("writeFile.writingProgress")}
                </div>
              ) : null}
            </div>
          )}

          {lspDetails && lspDetails.files && lspDetails.files.length > 0 && (
            <div className="border-t border-border-secondary/30">
              <ContextReferenceCard references={lspReferences} />
            </div>
          )}
        </>
      )}
    </div>
  );
});
