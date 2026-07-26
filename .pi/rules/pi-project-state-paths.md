---
description: Keep project-private Pi state out of global app config and repositories.
severity: high
globs:
  - "src/shared/**"
  - "src/mainview/stores/**"
  - "../pi-momo-fork/packages/coding-agent/src/**"
---

# Pi Project State Paths

- Store project-private trust, permission caches, fallback approval state, asset state, and similar user state under the project-scoped agent state directory.
- Keep `~/.pi-agent-chat/config.json` for app-level indexes such as recent projects and open tabs.
- Do not key durable project-private state only by cwd in a global JSON file.
- Do not write user-private runtime state into the repository unless the feature explicitly requires repo-owned config.
