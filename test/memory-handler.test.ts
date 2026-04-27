import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join, resolve } from "path"
import { tmpdir } from "os"
import { stat, readdir, readFile } from "fs/promises"

type MemoryFile = {
	filename: string
	filePath: string
	description: string | null
	type: "user" | "feedback" | "project" | "reference" | null
	mtimeMs: number
	size: number
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

function encodeCwd(cwd: string): string {
	return "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--"
}

async function listFiles(projectPath: string, memoryBaseDir: string) {
	const memoryDir = join(memoryBaseDir, encodeCwd(projectPath))
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
		} catch { /* noop */ }
	}
	files.sort((a, b) => b.mtimeMs - a.mtimeMs)
	let entrypointContent: string | null = null
	const entrypointPath = join(memoryDir, "MEMORY.md")
	if (existsSync(entrypointPath)) {
		try {
			entrypointContent = await readFile(entrypointPath, "utf-8")
		} catch { /* noop */ }
	}
	return { files, entrypointContent, memoryDir }
}

async function readMemoryFile(filePath: string, memoryBase?: string) {
	if (memoryBase !== undefined) {
		const resolvedBase = resolve(memoryBase)
		const resolvedPath = resolve(filePath)
		if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + "/") && !resolvedPath.startsWith(resolvedBase + "\\")) {
			throw new Error("Path outside memory directory")
		}
	}
	const content = await readFile(filePath, "utf-8")
	const s = await stat(filePath)
	return { content, size: s.size }
}

let tempDir: string

beforeEach(async () => {
	tempDir = join(tmpdir(), `memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	await mkdir(tempDir, { recursive: true })
})

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true })
})

describe("parseFrontmatter", () => {
	it("parses valid frontmatter", () => {
		const result = parseFrontmatter("---\ntype: user\ndescription: my desc\n---\nBody text")
		expect(result.frontmatter).toEqual({ type: "user", description: "my desc" })
		expect(result.body).toBe("Body text")
	})

	it("returns empty frontmatter when no --- present", () => {
		const result = parseFrontmatter("Just some content\nNo frontmatter")
		expect(result.frontmatter).toEqual({})
		expect(result.body).toBe("Just some content\nNo frontmatter")
	})

	it("returns empty frontmatter when closing --- is missing", () => {
		const result = parseFrontmatter("---\ntype: user\nNo closing")
		expect(result.frontmatter).toEqual({})
		expect(result.body).toBe("---\ntype: user\nNo closing")
	})

	it("handles CRLF line endings", () => {
		const result = parseFrontmatter("---\r\ntype: feedback\r\n---\r\nBody")
		expect(result.frontmatter).toEqual({ type: "feedback" })
		expect(result.body).toBe("Body")
	})

	it("handles empty body after frontmatter", () => {
		const result = parseFrontmatter("---\ntype: project\n---\n")
		expect(result.frontmatter).toEqual({ type: "project" })
		expect(result.body).toBe("")
	})

	it("ignores lines without colons", () => {
		const result = parseFrontmatter("---\ntype: user\njust a line\nname: foo\n---\nbody")
		expect(result.frontmatter).toEqual({ type: "user", name: "foo" })
	})

	it("trims keys and values", () => {
		const result = parseFrontmatter("---\n  type  :  project  \n---\nbody")
		expect(result.frontmatter).toEqual({ type: "project" })
	})

	it("ignores empty keys", () => {
		const result = parseFrontmatter("---\n: value\n---\nbody")
		expect(result.frontmatter).toEqual({})
	})
})

describe("listFiles", () => {
	it("returns empty for non-existent directory", async () => {
		const result = await listFiles("/no/such/project", tempDir)
		expect(result.files).toEqual([])
		expect(result.entrypointContent).toBeNull()
	})

	it("returns parsed files from memory directory", async () => {
		await writeFile(join(tempDir, "user-pref.md"), "---\ntype: user\ndescription: likes dark mode\n---\nI prefer dark mode")
		await writeFile(join(tempDir, "feedback-001.md"), "---\ntype: feedback\ndescription: always use tabs\n---\nUse tabs not spaces")
		await writeFile(join(tempDir, "project-info.md"), "---\ntype: project\nname: my-project\n---\nProject info body")

		const encoded = encodeCwd("/my/project")
		const memoryDir = join(tempDir, encoded)
		await mkdir(memoryDir, { recursive: true })
		await writeFile(join(memoryDir, "user-pref.md"), "---\ntype: user\ndescription: likes dark mode\n---\nI prefer dark mode")
		await writeFile(join(memoryDir, "feedback-001.md"), "---\ntype: feedback\ndescription: always use tabs\n---\nUse tabs not spaces")
		await writeFile(join(memoryDir, "project-info.md"), "---\ntype: project\nname: my-project\n---\nProject info body")

		const result = await listFiles("/my/project", tempDir)
		expect(result.files).toHaveLength(3)

		const types = result.files.map((f) => f.type).sort()
		expect(types).toEqual(["feedback", "project", "user"])

		const userFile = result.files.find((f) => f.type === "user")!
		expect(userFile.description).toBe("likes dark mode")
		expect(userFile.filename).toBe("user-pref.md")

		const projectFile = result.files.find((f) => f.type === "project")!
		expect(projectFile.description).toBe("my-project")
	})

	it("ignores non-.md files, dotfiles, and MEMORY.md", async () => {
		const encoded = encodeCwd("/test/project")
		const memoryDir = join(tempDir, encoded)
		await mkdir(memoryDir, { recursive: true })

		await writeFile(join(memoryDir, "valid.md"), "---\ntype: user\n---\nvalid")
		await writeFile(join(memoryDir, "data.json"), '{"key": "value"}')
		await writeFile(join(memoryDir, ".hidden.md"), "---\ntype: user\n---\nhidden")
		await writeFile(join(memoryDir, "MEMORY.md"), "# Memory entrypoint")

		const result = await listFiles("/test/project", tempDir)
		expect(result.files).toHaveLength(1)
		expect(result.files[0].filename).toBe("valid.md")
	})

	it("sorts by mtimeMs descending", async () => {
		const encoded = encodeCwd("/sort/project")
		const memoryDir = join(tempDir, encoded)
		await mkdir(memoryDir, { recursive: true })

		const fileA = join(memoryDir, "a.md")
		const fileB = join(memoryDir, "b.md")
		const fileC = join(memoryDir, "c.md")

		await writeFile(fileA, "---\ntype: user\n---\na")
		await new Promise((r) => setTimeout(r, 20))
		await writeFile(fileC, "---\ntype: reference\n---\nc")
		await new Promise((r) => setTimeout(r, 20))
		await writeFile(fileB, "---\ntype: feedback\n---\nb")

		const result = await listFiles("/sort/project", tempDir)
		expect(result.files.map((f) => f.filename)).toEqual(["b.md", "c.md", "a.md"])
	})

	it("reads MEMORY.md as entrypointContent", async () => {
		const encoded = encodeCwd("/entry/project")
		const memoryDir = join(tempDir, encoded)
		await mkdir(memoryDir, { recursive: true })

		await writeFile(join(memoryDir, "MEMORY.md"), "# My Memory\n\nImportant context")
		await writeFile(join(memoryDir, "file.md"), "---\ntype: user\n---\ndata")

		const result = await listFiles("/entry/project", tempDir)
		expect(result.entrypointContent).toBe("# My Memory\n\nImportant context")
		expect(result.files).toHaveLength(1)
	})

	it("returns null entrypointContent when MEMORY.md does not exist", async () => {
		const encoded = encodeCwd("/no-entry/project")
		const memoryDir = join(tempDir, encoded)
		await mkdir(memoryDir, { recursive: true })

		await writeFile(join(memoryDir, "file.md"), "---\ntype: user\n---\ndata")

		const result = await listFiles("/no-entry/project", tempDir)
		expect(result.entrypointContent).toBeNull()
	})

	it("handles files without frontmatter (type=null, description=null)", async () => {
		const encoded = encodeCwd("/no-fm/project")
		const memoryDir = join(tempDir, encoded)
		await mkdir(memoryDir, { recursive: true })

		await writeFile(join(memoryDir, "plain.md"), "Just plain text, no frontmatter")

		const result = await listFiles("/no-fm/project", tempDir)
		expect(result.files).toHaveLength(1)
		expect(result.files[0].type).toBeNull()
		expect(result.files[0].description).toBeNull()
	})

	it("handles unknown type as null", async () => {
		const encoded = encodeCwd("/unknown-type/project")
		const memoryDir = join(tempDir, encoded)
		await mkdir(memoryDir, { recursive: true })

		await writeFile(join(memoryDir, "weird.md"), "---\ntype: unknown_type\n---\ndata")

		const result = await listFiles("/unknown-type/project", tempDir)
		expect(result.files[0].type).toBeNull()
	})
})

describe("readMemoryFile", () => {
	it("returns content and size", async () => {
		const filePath = join(tempDir, "read-test.md")
		const content = "---\ntype: user\n---\nHello world"
		await writeFile(filePath, content)

		const result = await readMemoryFile(filePath)
		expect(result.content).toBe(content)
		expect(result.size).toBe(Buffer.byteLength(content, "utf-8"))
	})

	it("throws for non-existent file", async () => {
		await expect(readMemoryFile(join(tempDir, "nope.md"))).rejects.toThrow()
	})

	it("rejects absolute path outside memory directory", async () => {
		await expect(readMemoryFile("/etc/passwd", tempDir)).rejects.toThrow("Path outside memory directory")
	})

	it("rejects traversal path outside memory directory", async () => {
		const traversalPath = join(tempDir, "..", "..", "..", "etc", "passwd")
		await expect(readMemoryFile(traversalPath, tempDir)).rejects.toThrow("Path outside memory directory")
	})

	it("allows reading file within memory directory", async () => {
		const filePath = join(tempDir, "safe.md")
		await writeFile(filePath, "---\ntype: user\n---\nsafe content")

		const result = await readMemoryFile(filePath, tempDir)
		expect(result.content).toContain("safe content")
	})

	it("allows reading file in subdirectory of memory directory", async () => {
		const subDir = join(tempDir, "sub")
		await mkdir(subDir, { recursive: true })
		const filePath = join(subDir, "nested.md")
		await writeFile(filePath, "nested content")

		const result = await readMemoryFile(filePath, tempDir)
		expect(result.content).toBe("nested content")
	})
})

describe("encodeCwd", () => {
	it("encodes root path", () => {
		expect(encodeCwd("/")).toBe("----")
	})

	it("encodes nested path", () => {
		expect(encodeCwd("/Users/foo/project")).toBe("--Users-foo-project--")
	})

	it("encodes relative-looking path", () => {
		expect(encodeCwd("relative/path")).toBe("--relative-path--")
	})

	it("encodes backslash paths (Windows)", () => {
		expect(encodeCwd("C:\\Users\\foo\\project")).toBe("--C--Users-foo-project--")
	})

	it("strips leading backslash", () => {
		expect(encodeCwd("\\Users\\foo")).toBe("--Users-foo--")
	})

  it("encodes colons (Windows drive letters)", () => {
    expect(encodeCwd("C:/Users/foo")).toBe("--C--Users-foo--")
  })
})

describe("listFiles edge cases", () => {
  it("with unreadable file returns partial results", async () => {
    const encoded = encodeCwd("/unreadable/project")
    const memoryDir = join(tempDir, encoded)
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(memoryDir, "readable.md"), "---\ntype: user\n---\nreadable content")

    const unreadablePath = join(memoryDir, "unreadable.md")
    await writeFile(unreadablePath, "---\ntype: feedback\n---\nunreadable content")

    const { chmod } = await import("fs/promises")
    try {
      await chmod(unreadablePath, 0o000)
    } catch {
      return
    }

    const result = await listFiles("/unreadable/project", tempDir)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].filename).toBe("readable.md")

    await chmod(unreadablePath, 0o644).catch(() => {})
  })

  it("with directory named .md is not included", async () => {
    const encoded = encodeCwd("/dirmd/project")
    const memoryDir = join(tempDir, encoded)
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(memoryDir, "real.md"), "---\ntype: user\n---\nreal file")
    await mkdir(join(memoryDir, "fake.md"), { recursive: true })

    const result = await listFiles("/dirmd/project", tempDir)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].filename).toBe("real.md")
  })
})

describe("encodeCwd additional cases", () => {
  it("encodes Windows C:\\Users\\foo\\bar", () => {
    expect(encodeCwd("C:\\Users\\foo\\bar")).toBe("--C--Users-foo-bar--")
  })

  it("encodes unicode paths", () => {
    expect(() => encodeCwd("café/项目")).not.toThrow()
    expect(encodeCwd("café/项目")).toBe("--café-项目--")
  })
})
