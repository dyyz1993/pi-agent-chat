---
name: pi-session-context
description: Work on Pi session context, history materialization, compaction, rollback/delete/leaf pointer behavior, memory/rules injection, or context diagnostics. Use when modifying compaction or LLM-visible history logic.
---

# Pi Session Context

The LLM-visible history boundary must stay unified. Do not create an alternate interpretation of raw branch entries.

## Required Reading

Before edits, read `docs/architecture/session-context-and-compaction-flow.md`.

## Source Of Truth

- Use `materializeSessionContextEntries()` and `buildSessionContext()` semantics for effective history.
- Treat raw branch entries as audit or diagnostic data unless the extension explicitly reapplies the same materialization rules.
- `session_before_compact` should prefer prepared effective history.

## Change Checklist

Update docs and tests when touching:

- `SessionManager.buildSessionContext()`
- `materializeSessionContextEntries()`
- `AgentSession.prompt()`
- `AgentSession.compact()`
- auto-compaction
- input/context/provider/compaction hooks
- provider payload conversion
- context diagnostics

## Validation

1. Test direct context building or compaction logic.
2. Test manual compaction.
3. Test auto-compaction if affected.
4. Test refresh or reconnect recovery when UI-visible state changes.
