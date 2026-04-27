export interface BookmarkFile {
	filename: string
	filePath: string
	title: string
	description: string
	summary: string
	tags: string[]
	sourceSessionId: string
	sourceMessageIds: string[]
	mtimeMs: number
	size: number
}

export interface BookmarkMethods {
	"bookmark.add": {
		params: { projectPath: string; sessionId: string; messageIds: string[]; messageContent: string }
		result: { filename: string; filePath: string; title: string; summary: string; tags: string[] }
	}
	"bookmark.list": {
		params: { projectPath: string }
		result: { files: BookmarkFile[] }
	}
	"bookmark.remove": {
		params: { filePath: string }
		result: { success: boolean }
	}
	"bookmark.search": {
		params: { projectPath: string; query: string }
		result: { files: BookmarkFile[] }
	}
}
