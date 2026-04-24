export function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    mjs: "javascript", cjs: "javascript", mts: "typescript", cts: "typescript",
    json: "json", html: "markup", css: "css", md: "markdown",
    py: "python", rs: "rust", go: "go", sh: "bash", bash: "bash",
    yml: "yaml", yaml: "yaml", toml: "toml", xml: "markup",
    sql: "sql", graphql: "graphql",
  };
  return map[ext] || "";
}

export function isTextFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const textExts = new Set([
    "ts", "tsx", "js", "jsx", "json", "html", "css", "scss", "less",
    "md", "txt", "py", "rs", "go", "sh", "bash", "yml", "yaml", "toml",
    "xml", "sql", "graphql", "env", "gitignore", "prettierrc", "eslintrc",
    "lock", "log", "conf", "cfg", "ini", "csv", "tsv",
    "mjs", "cjs", "mts", "cts", "map",
  ]);
  return textExts.has(ext);
}

export function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
