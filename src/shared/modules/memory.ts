export interface MemoryFile {
	filename: string
	filePath: string
	description: string | null
	type: "user" | "feedback" | "project" | "reference" | "bookmark" | null
	mtimeMs: number
	size?: number
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

export interface MemoryEventData {
	sessionId: string
	timestamp: number
	[key: string]: unknown
}

export interface MemoryEvents {
	"memory.bookmark_creating": { sessionId: string; timestamp: number }
	"memory.creating": { sessionId: string; sourceMessageIds: string[]; timestamp: number }
	"memory.updated": { sessionId: string; files: MemoryFile[]; timestamp: number }
	"memory.update_failed": { sessionId: string; reason: string; timestamp: number }
	"memory.memory_prefetch": MemoryEventData
	"memory.memory_prefetch_result": MemoryEventData
	"memory.memory_extract": MemoryEventData
	"memory.memory_extract_result": MemoryEventData
	"memory.memory_dream": MemoryEventData
	"memory.memory_dream_result": MemoryEventData
}
