export interface MemoryFile {
	filename: string
	filePath: string
	description: string | null
	type: "user" | "feedback" | "project" | "reference" | null
	mtimeMs: number
	size: number
}

export interface MemoryMethods {
	"memory.listFiles": {
		params: { projectPath: string; sessionId?: string }
		result: { files: MemoryFile[]; entrypointContent: string | null; memoryDir: string }
	}
	"memory.readFile": {
		params: { filePath: string }
		result: { content: string; size: number }
	}
	"memory.remember": {
		params: { projectPath: string; sessionId: string; messageIds: string[]; content: string }
		result: { ok: boolean }
	}
}
