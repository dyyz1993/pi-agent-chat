# Streaming Tool Card Debugging Guide

This document records the debugging lessons from the hooks permission and tool
card closure issues found on 2026-06-05. It is meant to be used when chat tool
cards duplicate, stay open after completion, reopen after reconnect, or appear
in a surprising place in the message list.

## Principle

Do not fix these issues by hiding UI symptoms. A tool card is the rendered form
of an event lifecycle:

```text
message_start/message_update
  -> tool_execution_start
  -> tool_execution_update*
  -> tool_execution_end
  -> message_end / agent_end
```

When the UI is wrong, trace which event or persisted message created each card,
then repair the lifecycle invariant at the earliest reliable layer.

## Known Failure Modes

### 1. Reconnect or tab restore replays too many stale events

Symptom:

- Switching browser tabs, reconnecting, or changing sessions causes old running
  tool cards to reappear.
- Logs show `agent.replayHoldEvents` replaying hundreds or thousands of events
  for one session.

Root cause:

- `holdEvents` was acting like an append-only event log.
- `onReconnect` and session switching call `agent.replayHoldEvents`.
- Replaying the full buffer sends stale `message_update` and tool updates back
  into the frontend.

Correct fix:

- Treat held events as a replayable state snapshot, not a full stream log.
- Compact held events before replay:
  - keep only the latest open `message_update`
  - drop text updates after `message_end`
  - keep `tool_execution_start + latest update` for running tools
  - keep `tool_execution_start + tool_execution_end` for terminal tools
  - ignore delayed updates after terminal events

Regression tests:

- `test/process-manager-hold-events.test.ts`
- `compactHoldEventsForReplay`
- `AgentProcessManager.replayHoldEvents`

Operational check:

```bash
rg -n "replayHoldEvents" logs/$(date +%F).log | tail -20
```

Healthy logs should include `held`, `replayed`, and `compacted`, and replayed
counts should stay small relative to streaming volume.

### 2. Delayed `message_update` reopens a completed tool

Symptom:

- A tool card completes, then after tab restore or delayed delivery a new
  running card appears for the same tool call.
- The session status may flip back from idle to streaming.

Root cause:

- A stale `message_update` carrying a `toolCall` can arrive after
  `tool_execution_end` or `message_end`.
- If the last assistant message is already closed, the frontend may synthesize a
  new streaming assistant message and convert that `toolCall` to a running card.

Correct fix:

- Before handling `message_update`, check whether its tool call ids are already
  terminal in the last closed assistant message.
- If all incoming tool calls are already `done` or `error`, treat the update as
  stale and drop it.
- Do not change session status back to streaming for this stale update.

Regression test:

- `test/agent-event-handler.test.ts`
- `ignores delayed message_update for a tool call that is already terminal`

### 3. Live stream creates two cards for one command

Symptom:

- No tab switch is needed.
- One running card remains open while a second card below it has completed
  output for the same command.
- This often appears as:

```text
[running]  查看 now-mock 项目
[done]     查看 now-mock 项目
```

Root cause:

- `message_update` creates a pending tool card from the assistant message's
  `toolCall.id`.
- `tool_execution_start/end` may use a different `toolCallId` for the same tool
  invocation.
- Matching only by id creates two cards. `tool_execution_end` closes only the
  execution event card, leaving the message-update card running forever.

Correct fix:

- Prefer exact id matching.
- If `tool_execution_start` has no exact id match, reconcile against a pending
  message-update tool block using stable identity:
  - same `toolName`
  - same normalized command/args
  - pending block is not terminal
- Replace the pending block's id with the execution `toolCallId`, so later
  `tool_execution_update/end` events close the same card.

Regression test:

- `test/agent-event-handler.test.ts`
- `reuses a pending message_update tool block when execution start uses a different id`

## Debugging Checklist

1. Identify whether the bad card is live, replayed, or loaded from JSONL.
2. Check the visible symptom:
   - duplicate cards
   - running card after completed output
   - session status stuck streaming
   - card reappears after tab restore
3. Inspect backend replay logs:

```bash
rg -n "replayHoldEvents|agent.start|already_running|WebSocket not open" logs/$(date +%F).log
```

4. Inspect frontend event handling:
   - `src/mainview/stores/agent-event-handler.ts`
   - `message_update`
   - `tool_execution_start`
   - `tool_execution_update`
   - `tool_execution_end`
   - `message_end`
   - `agent_end`
5. Inspect loaded-message normalization:
   - `src/mainview/stores/use-chat-store.ts`
   - `normalizeToolBlocks`
6. Add a failing test that reproduces the event order exactly.
7. Fix the lifecycle invariant, not the rendered component.
8. Run targeted tests, then build.

## Testing Strategy

Use pure or store-level tests first. They are faster and make event ordering
explicit.

Recommended tests:

```bash
bun test --isolate \
  test/agent-event-handler.test.ts \
  test/refresh-recovery-integration.test.ts \
  test/chat-store.test.ts \
  test/process-manager-hold-events.test.ts \
  test/refresh-recovery.test.ts
```

Then run static checks and build:

```bash
bunx eslint src/mainview/stores/agent-event-handler.ts test/agent-event-handler.test.ts
git diff --check
bun run build
```

For backend replay changes, include:

```bash
bun test --isolate test/process-manager-hold-events.test.ts
bunx eslint src/shared/agent/process-manager.ts test/process-manager-hold-events.test.ts
```

## Design Invariants

- A tool invocation should have at most one visible `toolExecution` card.
- A terminal tool card must not become running again.
- `message_end` or `agent_end` must close remaining running tool cards.
- Reconnect replay must restore current state, not re-stream old history.
- Loaded JSONL messages and live replay must converge to the same card state.
- UI renderers should not be responsible for hiding lifecycle bugs.

## Files To Know

- `src/shared/agent/process-manager.ts`
  - Backend agent process lifecycle.
  - `holdEvents` storage and replay.
- `src/mainview/stores/agent-event-handler.ts`
  - Live event to chat state conversion.
  - Most streaming card lifecycle bugs start here.
- `src/mainview/stores/use-chat-store.ts`
  - Loaded message normalization and cross-message dedupe.
- `src/mainview/stores/use-session-store.ts`
  - Session switching and reconnect flow.
- `src/mainview/stores/session-subscriptions.ts`
  - Agent event subscription wiring.

## Commit References

These commits introduced the current guardrails:

- `a8e8914c Compact held agent events before replay`
- `78970521 Ignore stale terminal tool message updates`
- `11c842ee Reconcile live tool call ids`

