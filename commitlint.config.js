module.exports = {
  rules: {
    "body-max-line-length": [2, "always", 200],
    "footer-max-line-length": [2, "always", 200],
    "header-max-length": [2, "always", 120],
    "scope-case": [2, "always", "lower-case"],
    "scope-empty": [1, "never"],
    "scope-enum": [
      2,
      "always",
      [
        "agent", "bash", "chat", "ci", "deps", "diff", "explorer",
        "file", "git", "lint", "lsp", "memory", "mermaid", "project", "rpc",
        "rules", "session", "snapshot", "status", "subagent", "tab",
        "theme", "todo", "ui", "upload"
      ],
    ],
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
    "type-enum": [
      2,
      "always",
      [
        "build", "chore", "ci", "docs", "feat", "fix", "improve",
        "perf", "refactor", "revert", "style", "test"
      ],
    ],
  },
};
