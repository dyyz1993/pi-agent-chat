# Tool Lifecycle Rendering Refactor

## Problem

Tool cards can stay expanded as `streaming` / `waiting` after refresh, tab backgrounding, or reconnect. The visible symptom is a duplicated pair:

- a live-looking card with `streaming` and action buttons
- a terminal historical card below it with real output

The root cause is not WebSocket backlog alone. The UI previously allowed `agent/session isStreaming` to preserve a running tool card. In the fork runtime, `isStreaming` means the assistant turn is still active; it does not mean a specific tool call is still active.

## Requirement

The business rule is:

1. A tool card is running only if a tool lifecycle source says its `toolCallId` is active.
2. Historical `toolResult` or terminal tool execution always wins over a stale running card.
3. Refresh and background-tab recovery must produce the same normalized message list as live WebSocket updates.
4. Message loading order must not matter. If messages arrive before active-tool state, the later active snapshot must re-normalize existing messages.
5. UI components should render store data. They should not infer tool lifecycle from session streaming state.

## Architecture

```
Fork runtime events
  tool_execution_start / tool_execution_end / agent_end
        |
        v
App server process manager
  managed.info.activeToolExecutions
        |
        v
RPC agent.getState
  activeToolExecutions: [{ toolCallId, toolName, args, startedAt }]
        |
        v
Frontend session initial state + realtime event handler
  useChatStore.setActiveToolCallIds(sessionId, ids)
        |
        v
Unified store write gateway
  prepareMessagesForStore(messages, { activeToolCallIds })
        |
        v
UI rendering
  cards render normalized toolExecution blocks
```

## Decisions

- `isStreaming` remains a turn-level signal only.
- `activeToolExecutions` is the authoritative tool-level signal in the app server.
- `setMessagesForSession`, `loadSessionMessages`, `_backgroundRefreshMessages`, and `loadMoreMessages` all pass through the same normalization gateway.
- `setActiveToolCallIds` reprocesses existing session messages, so late state snapshots fix stale cards immediately.
- Background-tab batching uses microtasks instead of `requestAnimationFrame`, because RAF can pause while the tab is hidden and flush stale updates after the user returns.

## Tests

Current focused coverage:

- Store gateway normalizes `toolCall + toolResult` to a terminal `toolExecution`.
- Stale running tools close when they are no longer active.
- Latest streaming assistant tools close when active snapshot is empty.
- Existing messages reprocess when active snapshot arrives after message load.
- Realtime `tool_execution_start/end` maintains active ids.
- Server event routing tracks `activeToolExecutions`.
- `agent.getState` returns active tool snapshot.
- Pagination and background refresh keep terminal history authoritative.

## Follow-up

The fork can eventually expose active tool executions directly from runtime state. Until then, the app server derives the snapshot from lifecycle events it already receives. This is still data-driven and testable; it is not a UI-only workaround.
