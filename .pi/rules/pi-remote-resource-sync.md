---
description: Protect SSH and remote resource sync boundaries.
severity: critical
globs:
  - "docs/architecture/remote-runtime-architecture-comparison.md"
  - "docs/workflows/ssh-remote-runtime.md"
  - "src/**/remote**"
  - "src/**/ssh**"
  - "../pi-momo-fork/packages/coding-agent/src/**/remote**"
  - "../pi-momo-fork/packages/coding-agent/src/**/ssh**"
---

# Pi Remote Resource Sync

- Do not inject local absolute skill, memory, rule, hook, plugin, MCP, auth, or session paths into remote Agent runtime.
- Standard SSH resource sync may copy only low-risk managed resources such as skills, agents, and rules into the remote managed agent root.
- Do not sync `auth.json`, `oauth.json`, `models.json`, `.env`, memory, plugins, MCP configs, hooks, sessions, or secret files.
- Maintain a manifest/hash for synced resources and skip symlinks and sensitive files.
