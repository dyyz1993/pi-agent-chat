import * as fs from "node:fs";
import * as path from "node:path";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { getProcessManager } from "./agent";
import type { RuleDetail, RulesChannelEvent } from "../modules/rules";

const GLOBAL_RULES_DIRS = [
	path.join(process.env.HOME || "", ".claude", "rules"),
	path.join(process.env.HOME || "", ".config", "opencode", "rules"),
	"/etc/claude-code/.claude/rules",
];

function getProjectRulesDirs(cwd?: string): string[] {
	if (!cwd) return [];
	const candidates = [
		path.join(cwd, ".claude", "rules"),
		path.join(cwd, ".opencode", "rules"),
		path.join(cwd, ".trae", "rules"),
	];
	return candidates.filter((d) => fs.existsSync(d));
}

function parseFrontmatter(content: string): { paths?: string[]; severity?: string; description?: string; scope?: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\n?---\r?\n/);
	if (!match) return {};
	const frontmatter: Record<string, unknown> = {};
	const lines = match[1].split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const idx = line.indexOf(":");
		if (idx === -1) { i++; continue; }
		const key = line.slice(0, idx).trim();
		let val: string | string[] = line.slice(idx + 1).trim();

		if (val === "" || val === "null" || val === "undefined") {
			const listItems: string[] = [];
			let j = i + 1;
			while (j < lines.length) {
				const subLine = lines[j];
				if (subLine.match(/^\s*-\s+/)) {
					listItems.push(subLine.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, ""));
					j++;
				} else if (subLine.trim() === "" || subLine.match(/^\s+/)) {
					j++;
				} else {
					break;
				}
			}
			if (listItems.length > 0) {
				frontmatter[key] = listItems;
				i = j;
				continue;
			}
		}

		if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
		if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
			val = val
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim().replace(/"/g, ""));
		}
		frontmatter[key] = val;
		i++;
	}
	return frontmatter as Record<string, unknown>;
}

function loadRulesFromDisk(cwd?: string): { rules: RuleDetail[]; totalRules: number } {
	const rules: RuleDetail[] = [];
	const allDirs = [...GLOBAL_RULES_DIRS, ...getProjectRulesDirs(cwd)];

	for (const dir of allDirs) {
		if (!fs.existsSync(dir)) continue;
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !(entry.name.endsWith(".md") || entry.name.endsWith(".mdc"))) continue;
			try {
				const filePath = path.join(dir, entry.name);
				const content = fs.readFileSync(filePath, "utf-8");
				const fm = parseFrontmatter(content);
				const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
				rules.push({
					name: entry.name.replace(/\.md$/, ""),
					title: fm.description || entry.name.replace(/\.md$/, ""),
					content: bodyContent,
					scope: ((fm.scope as string) || "user") as RuleDetail["scope"],
					source: dir,
					severity: ((fm.severity as string) || "medium") as RuleDetail["severity"],
					isUnconditional: !Array.isArray(fm.paths) || fm.paths.length === 0,
					paths: (fm.paths as string[]) || [],
					description: fm.description as string | undefined,
				});
			} catch {}
		}
	}

	return { rules, totalRules: rules.length };
}

export function register(server: RPCServer, _options: HandlerOptions): void {
	server.register("rules.list", async () => ({ rules: [], totalRules: 0 }));

	server.register("rules.requestSnapshot", async (params: unknown) => {
		const pm = getProcessManager();

		const sid =
			params && typeof params === "object" && "sessionId" in params
				? String((params as Record<string, unknown>).sessionId)
				: "";

		if (pm?.sendChannelMessage) {
			try {
				const result = await Promise.race([
					pm.sendChannelMessage(sid, "rules-engine", { action: "request_snapshot" }),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
				]);

				if (result && typeof result === "object" && "type" in result && result.type === "snapshot") {
					return result;
				}
			} catch {
			}
		}

		let cwd: string | undefined;
		if (pm && sid) {
			try {
				const managed = (pm as unknown as { clients: Map<string, { info: { projectPath: string } }> }).clients.get(sid);
				if (managed?.info?.projectPath) cwd = managed.info.projectPath;
			} catch {}
		}

		const { rules, totalRules } = loadRulesFromDisk(cwd);

		const unconditional = rules.filter((r) => r.isUnconditional);
		const allDirs = [...GLOBAL_RULES_DIRS, ...getProjectRulesDirs(cwd)];

		const snapshot: RulesChannelEvent = {
			type: "snapshot",
			rules,
			injectedRuleNames: unconditional.map((r) => r.name),
			totalRules,
			unconditionalCount: unconditional.length,
			conditionalCount: rules.length - unconditional.length,
			matchHistory: [],
			lifecycleLog: [
				{
					event: "loaded",
					message: `Loaded ${totalRules} rules from disk`,
					ruleCount: totalRules,
					timestamp: Date.now(),
					details: {
						scannedDirs: allDirs.map((d) => ({
							dir: d,
							fileCount: fs.readdirSync(d).filter((f) => f.endsWith(".md") || f.endsWith(".mdc")).length,
							ruleNames: [],
						})),
						configSource: cwd ? "project+global" : "global",
						cacheHit: false,
					},
				},
			],
			loadedAt: Date.now(),
			cacheTTL: 30000,
		};

		return snapshot;
	});
}
