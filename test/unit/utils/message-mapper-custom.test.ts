import { describe, it, expect } from "vitest"
import { messageToChatMessage } from "../../../src/mainview/lib/message-mapper"

describe("messageToChatMessage custom role", () => {
	it("maps custom role with customType and data", () => {
		const result = messageToChatMessage({
			role: "custom",
			customType: "memory_prefetch_result",
			data: { summary: "test", snippet: "text" },
		})

		expect(result).not.toBeNull()
		expect(result!.role).toBe("custom")
		expect(result!.content).toHaveLength(1)
		expect(result!.content[0].type).toBe("custom")
		expect(result!.content[0]).toEqual({
			type: "custom",
			customType: "memory_prefetch_result",
			data: { summary: "test", snippet: "text" },
		})
	})

	it("maps custom role with missing customType falls back to unknown", () => {
		const result = messageToChatMessage({
			role: "custom",
			data: { foo: "bar" },
		})

		expect(result).not.toBeNull()
		expect(result!.role).toBe("custom")
		expect(result!.content[0]).toEqual({
			type: "custom",
			customType: "unknown",
			data: { foo: "bar" },
		})
	})

	it("maps custom role with missing data defaults to {}", () => {
		const result = messageToChatMessage({
			role: "custom",
			customType: "memory_extract",
		})

		expect(result).not.toBeNull()
		expect(result!.role).toBe("custom")
		expect(result!.content[0]).toEqual({
			type: "custom",
			customType: "memory_extract",
			data: {},
		})
	})

	it("rejects non-custom unknown roles", () => {
		const result = messageToChatMessage({
			role: "something_else",
			content: "hello",
		})
		expect(result).toBeNull()
	})

	it("rejects null message", () => {
		expect(messageToChatMessage(null)).toBeNull()
	})

	it("rejects message without role", () => {
		expect(messageToChatMessage({ content: "hello" })).toBeNull()
	})

	it("maps custom role with details field (LSP sendMessage format)", () => {
		const result = messageToChatMessage({
			role: "custom",
			customType: "lsp_diagnostics",
			details: { files: [{ filePath: "src/index.ts", summary: "1 error", issues: [{ severity: 1, line: 5, message: "Type error" }] }] },
		})

		expect(result).not.toBeNull()
		expect(result!.role).toBe("custom")
		expect(result!.content[0]).toEqual({
			type: "custom",
			customType: "lsp_diagnostics",
			data: { files: [{ filePath: "src/index.ts", summary: "1 error", issues: [{ severity: 1, line: 5, message: "Type error" }] }] },
		})
	})

	it("prefers details over data when both present", () => {
		const result = messageToChatMessage({
			role: "custom",
			customType: "lsp_diagnostics",
			details: { files: [] },
			data: { old: "format" },
		})

		expect(result).not.toBeNull()
		expect(result!.content[0]).toEqual({
			type: "custom",
			customType: "lsp_diagnostics",
			data: { files: [] },
		})
	})
})
