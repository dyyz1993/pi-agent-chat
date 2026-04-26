import type { RPCServer } from "@dyyz1993/rpc-core"
import type { RPCMethods, HandlerOptions } from "../rpc-schema"
import type { MemoryFile } from "../modules/memory"
import { readdir, readFile, stat } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never

function encodeCwd(cwd: string): string {
	return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--"
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
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

export function register(server: RPCServer, _options: HandlerOptions): void {
	const r = <K extends keyof RPCMethods & string>(
		method: K,
		handler: (params: P<K>) => Promise<R<K>>,
	) => {
		server.register(method, handler as (params: unknown) => Promise<unknown>)
	}

	r("memory.listFiles", async (params) => {
		const agentDir = join(homedir(), ".pi", "agent")
		const memoryDir = join(agentDir, "memory", encodeCwd(params.projectPath))

		if (!existsSync(memoryDir)) {
			return { files: [], entrypointContent: null, memoryDir }
		}

		const files: MemoryFile[] = []

		const entries = await readdir(memoryDir)
		for (const entry of entries) {
			if (entry.startsWith(".")) continue
			if (!entry.endsWith(".md")) continue
			if (entry === "MEMORY.md") continue

			const filePath = join(memoryDir, entry)
			try {
				const s = await stat(filePath)
				if (!s.isFile()) continue
				const content = await readFile(filePath, "utf-8")
				const { frontmatter } = parseFrontmatter(content)
				files.push({
					filename: entry,
					filePath,
					description: frontmatter.description ?? frontmatter.name ?? null,
					type: (["user", "feedback", "project", "reference"].includes(frontmatter.type) ? frontmatter.type : null) as MemoryFile["type"],
					mtimeMs: s.mtimeMs,
					size: s.size,
				})
			} catch {}
		}

		files.sort((a, b) => b.mtimeMs - a.mtimeMs)

		let entrypointContent: string | null = null
		const entrypointPath = join(memoryDir, "MEMORY.md")
		if (existsSync(entrypointPath)) {
			try {
				entrypointContent = await readFile(entrypointPath, "utf-8")
			} catch {}
		}

		return { files, entrypointContent, memoryDir }
	})

	r("memory.readFile", async (params) => {
		const content = await readFile(params.filePath, "utf-8")
		const s = await stat(params.filePath)
		return { content, size: s.size }
	})
}
