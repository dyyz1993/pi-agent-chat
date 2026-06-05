export function normalizeRange(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const record = raw;
    const start = normalizePosition(record.start);
    const end = normalizePosition(record.end);
    if (!start || !end)
        return undefined;
    return { start, end };
}
export function normalizePosition(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const record = raw;
    if (typeof record.line !== "number" || typeof record.character !== "number")
        return undefined;
    return { line: record.line, character: record.character };
}
export function languageIdFromPath(filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const map = {
        ts: "typescript",
        tsx: "typescriptreact",
        js: "javascript",
        jsx: "javascriptreact",
        json: "json",
        css: "css",
        html: "html",
        md: "markdown",
        py: "python",
        rs: "rust",
        go: "go",
        c: "c",
        cpp: "cpp",
        lua: "lua",
    };
    return map[ext] ?? ext;
}
export function extractPullDiagnostics(payload) {
    if (!payload || typeof payload !== "object")
        return [];
    const record = payload;
    const items = Array.isArray(record.items) ? record.items : [];
    const diagnostics = [];
    for (const item of items) {
        if (!item || typeof item !== "object")
            continue;
        const d = item;
        if (typeof d.message !== "string")
            continue;
        const range = normalizeRange(d.range);
        if (!range)
            continue;
        diagnostics.push({
            range,
            message: d.message,
            severity: typeof d.severity === "number" ? d.severity : undefined,
            code: typeof d.code === "string" || typeof d.code === "number" ? d.code : undefined,
            source: typeof d.source === "string" ? d.source : undefined,
        });
    }
    return diagnostics;
}
//# sourceMappingURL=lsp-helpers.js.map