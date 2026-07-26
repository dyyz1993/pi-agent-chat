---
description: Keep session context and compaction semantics unified.
severity: critical
globs:
  - "docs/architecture/session-context-and-compaction-flow.md"
  - "src/**/session**"
  - "src/**/compact**"
  - "extensions/**/context**"
  - "extensions/**/compact**"
  - "../pi-momo-fork/packages/coding-agent/src/**"
  - "../pi-momo-fork/packages/coding-agent/extensions/**"
---

# Pi Session Context

- Before changing chat history, compaction, rollback/delete/leaf pointer, memory/rules injection, context diagnostics, or provider payload logic, read `docs/architecture/session-context-and-compaction-flow.md`.
- Use the same effective-history semantics as `materializeSessionContextEntries()` and `buildSessionContext()`.
- Do not prepare compaction from raw branch entries with a separate interpretation unless the same materialization rules are deliberately reapplied.
- Update documentation and tests when the LLM-visible history boundary changes.
