import type { RPCServer } from "@dyyz1993/rpc-core"
import type { HandlerOptions } from "../rpc-schema"
import type { BookmarkFile } from "../modules/bookmark"
import { readdir, readFile, stat, unlink, writeFile } from "fs/promises"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join, resolve } from "path"
import { homedir } from "os"

type AddParams = { projectPath: string; sessionId: string; messageIds: string[]; messageContent: string }
type ListParams = { projectPath: string }
type RemoveParams = { filePath: string }
type SearchParams = { projectPath: string; query: string }

function encodeCwd(cwd: string): string {
	return "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--"
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "")
	if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized }
	const endIndex = normalized.indexOf("\n---", 3)
	if (endIndex === -1) return { frontmatter: {}, body: normalized }
	const yamlString = normalized.slice(4, endIndex)
	const body = normalized.slice(endIndex + 4).trim()
	const frontmatter: Record<string, string> = {}
	for (const line of yamlString.split("\n")) {
		const colonIndex = line.indexOf(":")
		if (colonIndex === -1) continue
		const key = line.slice(0, colonIndex).trim()
		const value = line.slice(colonIndex + 1).trim()
		if (key) frontmatter[key] = value
	}
	return { frontmatter, body }
}

function parseTags(raw: string | undefined): string[] {
	if (!raw) return []
	return raw.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean)
}

export function register(server: RPCServer, _options: HandlerOptions): void {
	const r = <P, R>(
		method: string,
		handler: (params: P) => Promise<R>,
	) => {
		server.register(method, handler as (params: unknown) => Promise<unknown>)
	}

	r<AddParams, { filename: string; filePath: string; title: string; summary: string; tags: string[] }>("bookmark.add", async (p) => {
		const agentDir = join(homedir(), ".pi", "agent")
		const memoryDir = join(agentDir, "memory", encodeCwd(p.projectPath))

		if (!existsSync(memoryDir)) {
			await import("node:fs/promises").then(({ mkdir }) => mkdir(memoryDir, { recursive: true }))
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
		const safeTitle = `bookmark-${timestamp}`
		const filename = `${safeTitle}.md`
		const filePath = join(memoryDir, filename)

		const fm = [
			"---",
			`name: ${safeTitle}`,
			"description: Pending LLM summary",
			"type: bookmark",
			`sourceSession: ${p.sessionId}`,
			`sourceMessageIds: ${p.messageIds.join(", ")}`,
			"tags: []",
			`createdAt: ${new Date().toISOString()}`,
			"---",
		].join("\n")

		await writeFile(filePath, `${fm}\n\n## 原始内容预览\n> ${p.messageContent.slice(0, 500)}${p.messageContent.length > 500 ? "..." : ""}`)

		return { filename, filePath, title: safeTitle, description: "Pending LLM summary", summary: "", tags: [] }
	})

	r<ListParams, { files: BookmarkFile[] }>("bookmark.list", async (p) => {
		const agentDir = join(homedir(), ".pi", "agent")
		const memoryDir = join(agentDir, "memory", encodeCwd(p.projectPath))

		if (!existsSync(memoryDir)) return { files: [] }

		const entries = await readdir(memoryDir)
		const files: BookmarkFile[] = []

		for (const entry of entries) {
			if (entry.startsWith(".") || entry === "MEMORY.md" || !entry.endsWith(".md")) continue
			const fp = join(memoryDir, entry)
			try {
				const s = await stat(fp)
				if (!s.isFile()) continue
				const content = await readFile(fp, "utf-8")
				const { frontmatter } = parseFrontmatter(content)
				if (frontmatter.type !== "bookmark") continue
				files.push({
					filename: entry,
					filePath: fp,
					title: frontmatter.name || entry.replace(/\.md$/, ""),
					description: frontmatter.description || "",
					summary: content.split("\n---")[1]?.trim() || "",
					tags: parseTags(frontmatter.tags),
					sourceSessionId: frontmatter.sourceSession || "",
					sourceMessageIds: frontmatter.sourceMessageIds
						? frontmatter.sourceMessageIds.split(",").map((s) => s.trim()).filter(Boolean)
						: [],
					mtimeMs: s.mtimeMs,
					size: s.size,
				})
			} catch {}
		}

		files.sort((a, b) => b.mtimeMs - a.mtimeMs)
		return { files }
	})

	r<RemoveParams, { success: boolean }>("bookmark.remove", async (p) => {
		const resolvedPath = resolve(p.filePath)
		if (existsSync(resolvedPath)) await unlink(resolvedPath)
		return { success: true }
	})

	r<SearchParams, { files: BookmarkFile[] }>("bookmark.search", async (p) => {
		const agentDir = join(homedir(), ".pi", "agent")
		const memoryDir = join(agentDir, "memory", encodeCwd(p.projectPath))

		if (!existsSync(memoryDir)) return { files: [] }

		const entries = readdirSync(memoryDir)
		const files: BookmarkFile[] = []

		for (const entry of entries) {
			if (entry.startsWith(".") || entry === "MEMORY.md" || !entry.endsWith(".md")) continue
			const fp = join(memoryDir, entry)
			try {
				const s = statSync(fp)
				if (!s.isFile()) continue
				const content = readFileSync(fp, "utf-8")
				const { frontmatter } = parseFrontmatter(content)
				if (frontmatter.type !== "bookmark") continue
				const summary = content.split("\n---")[1]?.trim() || ""
				const query = p.query.toLowerCase()
				const tags = parseTags(frontmatter.tags)
				if (
					query &&
					!frontmatter.name?.toLowerCase().includes(query) &&
					!frontmatter.description?.toLowerCase().includes(query) &&
					!summary.toLowerCase().includes(query) &&
					!tags.some((t: string) => t.toLowerCase().includes(query))
				)
					continue
				files.push({
					filename: entry,
					filePath: fp,
					title: frontmatter.name || entry.replace(/\.md$/, ""),
					description: frontmatter.description || "",
					summary,
					tags,
					sourceSessionId: frontmatter.sourceSession || "",
					sourceMessageIds: frontmatter.sourceMessageIds
						? frontmatter.sourceMessageIds.split(",").map((s) => s.trim()).filter(Boolean)
						: [],
					mtimeMs: s.mtimeMs,
					size: s.size,
				})
			} catch {}
		}

		return { files }
	})
}
