# Session Context And Compaction Flow

This document is the contract for how Pi turns a persisted session into model input, and how manual or automatic compaction must reuse the same effective-history semantics.

The short rule:

> Chat and compaction must start from the same materialized session branch. Chat may then run message/provider hooks for the next LLM request. Compaction may then summarize or let an extension replace the summary, but it must not reinterpret raw session history on its own.

## Why This Exists

Session history is not a flat chat log. It is a JSONL tree with branch pointers, deletion markers, compaction entries, branch summaries, custom extension entries, tool calls, tool results, and hidden assistant thinking. If each feature reads this tree differently, the UI can show one thing while `/compact` sends a different thing to the model.

The bug class this contract prevents:

- Normal chat succeeds because it uses the effective session context.
- Manual compaction fails because it reads raw branch entries and re-includes rolled-back or deleted messages.
- Extension compaction sees a different history from normal chat.
- A rollback or leaf pointer change leaves old hidden content in the summarization payload.

## Important Code Paths

These paths are in the linked `@dyyz1993/pi-coding-agent` fork.

| Area                                                         | Source                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Session tree, leaf path, materialization                     | `packages/coding-agent/src/core/session-manager.ts`       |
| Built-in compaction preparation and summarization            | `packages/coding-agent/src/core/compaction/compaction.ts` |
| Prompt, extension events, auto-compaction, manual compaction | `packages/coding-agent/src/core/agent-session.ts`         |
| Provider request assembly and context hook bridge            | `packages/coding-agent/src/core/sdk.ts`                   |
| Extension event dispatch                                     | `packages/coding-agent/src/core/extensions/runner.ts`     |
| Extension event types                                        | `packages/coding-agent/src/core/extensions/types.ts`      |

## Data Layers

| Layer                 | Meaning                                                                                | Owner                                                                 |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Raw entries           | Persisted JSONL session entries, including deletion markers and inactive branch data.  | `SessionManager`                                                      |
| Current branch        | Entries from the current leaf pointer back to root, reversed into chronological order. | `SessionManager.getBranch()` / `buildSessionContext()`                |
| Materialized branch   | Current branch after session-visible semantics are applied.                            | `buildSessionContext()` effective-history logic / compaction resolver |
| Session context       | Model-facing messages plus active thinking/model metadata.                             | `buildSessionContext()`                                               |
| Agent state           | Runtime message state used by the active `Agent`.                                      | `AgentSession` / `Agent`                                              |
| Hook-mutated messages | Messages after extension `context` handlers run.                                       | `ExtensionRunner.emitContext()`                                       |
| Provider payload      | Final provider-specific request, after conversion and `before_provider_request`.       | `Agent` / SDK                                                         |

## Materialized Branch Contract

The effective-history logic in `buildSessionContext()` is the shared boundary for session-visible history. Any code that prepares LLM-facing history from session entries must use this logic or a wrapper around it.

It applies these rules:

| Rule                | Behavior                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Leaf pointer        | Only entries reachable from the selected leaf are considered. Unreachable branches are ignored.                            |
| Deletion entries    | `deletion.targetIds` are hidden from the effective branch. The deletion marker itself is not sent to the model.            |
| Tool result cascade | If a deleted assistant message contained tool calls, matching `toolResult` messages are also hidden.                       |
| Orphan tool calls   | If a tool result is hidden, the corresponding assistant `toolCall` block is stripped from the assistant message.           |
| Assistant thinking  | Kept for normal chat context unless a caller explicitly passes `stripThinking: true`; compaction uses this option.         |
| Non-message entries | Entries not relevant to model context remain available for later phases unless explicitly filtered by the consuming phase. |

Do not reinterpret raw entries differently in compaction, extension code, UI session scanners, or provider adapters.

## Normal Chat Flow

Normal chat has two related flows: session restore and a new user prompt.

### Session Restore

On startup, resume, reload, fork, or session switch:

1. `SessionManager` loads raw JSONL entries.
2. The current leaf is resolved from `leaf_pointer` or the latest reachable entry.
3. `buildSessionContext()` walks from leaf to root and reverses the path.
4. `buildSessionContext()` applies deletion, tool-result cascade, orphan tool-call stripping, and branch visibility.
5. `buildSessionContext()` applies `segment_summary`, `branch_summary`, and `compaction` semantics.
6. `buildSessionContext()` returns `{ messages, thinkingLevel, model }`.
7. `AgentSession` assigns `agent.state.messages = sessionContext.messages`.

This is the canonical restoration path for normal chat history.

### New Prompt

When the user sends a message through `AgentSession.prompt()`:

1. Slash commands are checked first. Extension commands can handle the input and skip the normal prompt.
2. The `input` extension event can handle or transform the raw user text and images.
3. Skill commands and prompt templates are expanded.
4. If an agent run is already streaming, the message is queued as steer or follow-up.
5. The current model and auth are validated.
6. Preflight context size is estimated from `agent.state.messages`.
7. If needed, auto-compaction or emergency truncation runs before the new prompt.
8. The user message is built.
9. Pending `nextTurn` messages are appended beside the user message.
10. `before_agent_start` extensions can modify the system prompt and add custom messages.
11. `agent.prompt(messages)` starts the model loop.

The provider request path then continues:

1. `Agent` combines `agent.state.messages` with the new prompt messages.
2. `transformContext` calls `ExtensionRunner.emitContext(messages)`.
3. `context` extensions can return a replacement message array. Learning memory injection belongs here.
4. Messages are converted into provider payload format.
5. `before_provider_request` extensions can replace the final provider payload.
6. A `provider_request_context_usage` custom entry is appended for diagnostics.
7. `streamSimple()` sends the request.
8. `after_provider_response` extensions observe the HTTP/provider response.
9. Assistant/tool messages are persisted back to the session.
10. Post-run logic handles retry, compaction, and queued messages.

## Hook Order And Responsibility

| Hook/Event                | Runs During Chat                    | Runs During Compact                                                                                      | Purpose                                                                   |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `input`                   | Yes                                 | No                                                                                                       | Handle or transform raw user input before prompt/template expansion.      |
| `before_agent_start`      | Yes                                 | No                                                                                                       | Modify system prompt or add custom messages for the new agent turn.       |
| `context`                 | Yes, before each LLM call           | Not for built-in summarizer unless explicitly routed through chat/provider path                          | Mutate the final model message list. Learning memory injection uses this. |
| `before_provider_request` | Yes                                 | Not for `completeSimple()` compaction unless compaction is routed through the same provider-payload path | Last chance to replace provider payload.                                  |
| `after_provider_response` | Yes                                 | No by default for built-in compaction summarizer                                                         | Observe provider response metadata.                                       |
| `session_before_compact`  | No                                  | Yes                                                                                                      | Cancel compaction or provide an extension-owned compaction result.        |
| `session_compact`         | After compaction affects chat state | Yes                                                                                                      | React after compaction is persisted and session context rebuilt.          |

Important distinction:

- `before_agent_start` changes the upcoming chat turn. It does not rebuild old session history.
- `context` changes the messages immediately before provider calls.
- `session_before_compact` changes the compaction result. It should use `preparation` as effective history, not raw `branchEntries`, unless it intentionally needs audit/raw data.

## Built-In Compaction Flow

Manual `/compact` calls `AgentSession.compact()`.

1. The active agent operation is aborted and disconnected.
2. `sessionManager.getBranch()` returns raw entries on the current branch.
3. `prepareCompaction(pathEntries, settings)` is called.
4. `prepareCompaction()` uses `buildSessionContext(pathEntries)` to estimate the same effective context visible to chat.
5. Previous compaction boundaries are detected from the current branch.
6. Compaction message extraction uses the same effective deletion and `segment_summary` semantics as `buildSessionContext()`.
7. `findCutPoint()` chooses the first kept entry based on `keepRecentTokens`.
8. `messagesToSummarize`, `turnPrefixMessages`, previous summary, and file operation details are extracted from effective entries.
9. `session_before_compact` is emitted with:
   - `preparation`: effective-history compaction input.
   - `branchEntries`: raw branch entries for diagnostics or advanced extensions.
   - `customInstructions`.
   - `signal`.
10. If an extension returns `compaction`, that result is used.
11. Otherwise built-in `compact()` calls the summarization model via `completeSimple()`.
12. `appendCompaction()` persists a new compaction entry.
13. `sessionManager.buildSessionContext()` rebuilds canonical runtime messages.
14. `agent.state.messages` is replaced with the rebuilt session context.
15. `session_compact` is emitted.
16. The agent reconnects.

Auto-compaction uses the same compaction primitives, but is triggered from post-run or preflight context-size checks.

Trigger semantics:

- `thresholdPercent` is an explicit override. When it is configured, auto-compaction triggers once `contextTokens > contextWindow * thresholdPercent`.
- If `thresholdPercent` is absent, the legacy reserve-token rule applies: trigger once `contextTokens > contextWindow - reserveTokens`.
- Context usage display and trigger input must use the materialized session context from `buildSessionContext()`, not raw in-memory message object identity. After restart or JSONL re-materialization, find the last assistant usage by message position in the materialized context and estimate any trailing messages after it.

## Multi-Compaction And Extension Rules

Extensions that implement richer compaction, such as multi-compaction, must obey these rules:

- Use `SessionBeforeCompactEvent.preparation` for the messages and boundaries to summarize.
- Do not rebuild summarization input directly from `branchEntries` unless the extension first applies the same materialization semantics.
- If an extension needs raw entries for diagnostics, treat them as audit data, not model input.
- If an extension returns a `compaction` result, it becomes the persisted compaction entry and should set `firstKeptEntryId` to an entry that exists in the effective branch.
- After compaction, rely on `session_compact` and `buildSessionContext()` to refresh runtime chat state.

## Summary, Segment Summary, And Deletion

| Entry Type        | Model Context Behavior                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `compaction`      | Replaces older history with a compaction summary, then keeps entries from `firstKeptEntryId` onward. |
| `branch_summary`  | Emits a branch summary message.                                                                      |
| `segment_summary` | Replaces a group of target entries with one summary at the first target.                             |
| `deletion`        | Hides target entries from effective model context.                                                   |
| `custom`          | Persisted extension state only; not model context.                                                   |
| `custom_message`  | Participates in model context.                                                                       |
| `system_event`    | Can participate in context through `buildSessionContext()` when display/context rules allow it.      |
| `leaf_pointer`    | Selects the active branch; not model content.                                                        |

## What Must Stay Unified

Any feature that prepares session history for an LLM must not invent a separate interpretation of session entries.

Use this decision rule:

| Feature              | Required Entry Source                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Chat restore         | `buildSessionContext()`                                                                    |
| Manual compact       | `prepareCompaction()` using `buildSessionContext()`-equivalent effective-history semantics |
| Auto compact         | Same preparation path as manual compact                                                    |
| Extension compact    | `SessionBeforeCompactEvent.preparation`                                                    |
| Provider diagnostics | Final provider payload or `provider_request_context_usage`, not raw branch guesses         |
| UI session display   | UI can show raw/display entries, but must not infer LLM context from raw rows              |

## Change Checklist

When changing any of these areas, update this document and tests in the same change set:

- `SessionManager.buildSessionContext()`
- `buildSessionContext()` effective-history semantics or compaction message extraction
- deletion / rollback / leaf pointer behavior
- `segment_summary`, `branch_summary`, or `compaction` semantics
- `AgentSession.prompt()`, `AgentSession.compact()`, or auto-compaction
- extension events: `input`, `before_agent_start`, `context`, `before_provider_request`, `session_before_compact`, `session_compact`
- provider payload conversion or diagnostics
- learning memory or rules injection that affects model context

Minimum validation:

- Unit tests for `buildSessionContext()` behavior.
- Unit tests for `prepareCompaction()` using deletion, rollback-hidden content, tool call/tool result pairs, and assistant thinking.
- If hooks changed, extension runner tests for hook order and mutation behavior.
- If provider payload changed, a diagnostic test that compares model-visible messages with `provider_request_context_usage`.
