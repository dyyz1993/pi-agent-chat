---
name: pi-hooks-authoring
description: Design, implement, and validate Pi hooks. Use when working on hook files, hook docs, lifecycle events, pre/post tool behavior, approval hooks, shell hooks, or hook-related agent automation.
---

# Pi Hooks Authoring

Use hooks for deterministic local policy or workflow automation. Do not use hooks to hide product behavior that should be visible in the UI or runtime contract.

## Authoring Rules

- Identify the lifecycle event first: before tool, after tool, before agent start, context injection, provider request, compaction, or session event.
- Keep hook output deterministic and bounded. Avoid chatty logs, secret dumps, or full file contents.
- Treat secrets as unavailable. Never echo env vars, tokens, auth files, OAuth files, or raw credentials.
- Make failure modes explicit: allow, deny, ask, skip, retry, or soft warning.
- Prefer structured JSON payloads when the runtime supports them.
- Keep hook logic project-scoped unless the user explicitly asks for global behavior.

## Validation

1. Run the hook path directly with a minimal fixture or RPC/core command when available.
2. Verify positive and negative cases.
3. Verify timeout and malformed input behavior.
4. Then validate the UI or agent workflow that triggers the hook.

## Review Checklist

- Does the hook run only for the intended event?
- Does it avoid broad filesystem scans on hot paths?
- Does it produce stable output after refresh or reconnect?
- Does it preserve user confirmation for destructive, merge, delete, publish, or permission changes?
