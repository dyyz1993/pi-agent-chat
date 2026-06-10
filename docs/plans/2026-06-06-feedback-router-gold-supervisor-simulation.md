# Goal Supervisor, Gold, and Feedback Router Simulation

## Source Session

- Session id: `ac54e448-c5ab-47bc-bb68-21524c1d8594`
- Session file: `/Users/xuyingzhou/.pi/agent/sessions/--Users-xuyingzhou-Project-study-rust-browser--/ac54e448-c5ab-47bc-bb68-21524c1d8594.jsonl`
- Project: `/Users/xuyingzhou/Project/study-rust/browser`
- Title: `Rust轻量级SPA爬虫浏览器开发计划`

The session is a good stress case because it combines short user feedback, explicit file approvals, memory updates, agent switches, background-process notifications, compaction, and long-running milestone execution.

The important lesson is not that the product should support many `继续` interactions. The opposite is true: a healthy goal-driven runtime should not require the user to supervise every step. Short feedback like `继续` is mostly evidence that the agent stopped too early, the runtime lost continuity, or the system lacked a durable goal supervisor.

## Observed Signals

| Signal | Count | Meaning |
| --- | ---: | --- |
| `message` | 1274 | User, assistant, and tool-result turns |
| `step-snapshot` | 136 | Changed-file snapshot after a work turn |
| `file-review-turn` | 136 | Reviewable file list for a turn |
| `file-approval` | 114 | User accepted specific file changes |
| `agent_change` | 46 | UI or runtime switched agent mode, mostly `build` |
| `memory_prefetch` / result | 17 / 17 | Memory lookup and injection around user turns |
| `compaction` | 1 | Context summarized mid-session |

Tool use was also heavy: `bash` 359, `edit` 148, `write` 128, `read` 94. This means any continuation policy must account for in-flight tools and verification status, not only natural-language messages.

## User Feedback Patterns

1. `B`
   - Occurred after a plan-mode answer that offered options.
   - It should be treated as selecting a visible pending option, not as a free-form command.

2. `继续`
   - After M0 completion, the assistant interpreted it as `git init + commit` because the prior pending action was commit.
   - Later it meant continue the next milestone step.
   - Same text, different action. The router needs a `pendingAction`, not keyword matching.

3. `继续？`
   - Sometimes meant "please continue", sometimes meant "check whether continuing is appropriate".
   - The question mark should lower confidence unless there is a clear pending action.

4. Long directive updates
   - Example: the user changed the execution policy to continuous execution until SPA rendering works.
   - This should update durable session policy and affect future routing.

5. System-looking user messages
   - Example: background process exit notification stored as a user message.
   - These should be classified as runtime events, not human intent.

6. `file-approval`
   - These are user feedback, but they are scoped to file review.
   - They can unblock follow-up actions such as commit or continue, but should not directly trigger arbitrary work.

## Correct First Principle

There should be a durable goal first.

```text
User goal
   |
   v
Goal Supervisor
   |
   +--> Agent works
   |
   +--> Gold checks completion
   |
   +--> If incomplete, continue automatically
   |
   +--> If blocked / unsafe / needs choice, ask user
```

The user should only be pulled back in for real decisions:

- destructive action approval
- external credential or permission choice
- ambiguous product decision
- unrecoverable runtime failure
- goal changed by the user

Everything else should be handled by supervisor + gold without requiring `继续`.

## Proposed Responsibility Split

Implementation note: this should be one user-facing plugin, not multiple plugins. The existing `session-supervisor` extension is the closest base. It can evolve into the Goal plugin/product surface, with gold checking as an internal service. Do not add separate `gold` and `supervisor` plugins.

Hooks note: user-facing Hooks should point to `claude-hooks-compat` for Claude Code hook configs. `hooks-engine` is Pi Native Hooks and should be marked as not currently used by the main Hooks path unless Pi native hook config is explicitly present.

### Goal Supervisor

Owns session continuity and goal progress.

- Stores the current goal and progress state.
- Tracks agent started/stopped/recovered state.
- Knows whether there is an in-flight tool, active run, abort, or reconnection.
- Calls gold when the agent stops, times out, aborts, or claims completion.
- If gold says incomplete and no hard blocker exists, sends an explicit continue message to the agent automatically.
- Emits UI entries for important decisions and recovery.

### Gold

Owns completion checks.

- Reads the goal, recent agent output, tool results, file diffs, tests, and milestone plan.
- Determines whether the goal is complete, incomplete, blocked, or unsafe to continue.
- Produces evidence: commands, pass/fail, duration, cache/context usage where available.
- Suggests a concrete next continuation message only when incomplete work is established.

### Feedback Router

Handles user and UI feedback, but should not be the main driver.

- Resolves residual short feedback against active `pendingAction`.
- Converts structured events into typed facts.
- Rejects unsafe/destructive inference when no pending action exists.
- Used when the user manually intervenes or when UI sends approval/selection responses.

## Minimal Goal State

```ts
type GoalState = {
  id: string;
  objective: string;
  status: "running" | "checking" | "complete" | "blocked" | "needs_user";
  currentMilestone?: string;
  latestAgentEntryId?: string;
  latestGoldEntryId?: string;
  continuationCount: number;
  blockers: Array<{
    kind: "permission" | "choice" | "runtime" | "unsafe" | "unknown";
    summary: string;
  }>;
};
```

## Minimal Gold Result

```ts
type GoldResult = {
  goalId: string;
  verdict: "complete" | "incomplete" | "blocked" | "unsafe";
  confidence: number;
  evidence: Array<{
    kind: "test" | "command" | "diff" | "assistant_claim" | "runtime";
    summary: string;
    passed?: boolean;
  }>;
  continueMessage?: string;
  userQuestion?: string;
};
```

## Minimal Feedback Decision

```ts
type FeedbackDecision = {
  kind:
    | "none"
    | "select_option"
    | "confirm_pending_action"
    | "continue_current_work"
    | "update_session_policy"
    | "runtime_event"
    | "ask_user";
  confidence: number;
  sourceEntryId: string;
  pendingActionId?: string;
  reason: string;
  messageForAgent?: string;
};
```

Avoid making `source` too broad. A simpler source is enough:

```ts
type DecisionSource = "user_text" | "ui_response" | "runtime_event" | "model";
```

Gold, todo, specs, and CI are better represented as evidence inside the decision, not as top-level sources.

## Simulation Fixtures

```json
[
  {
    "name": "agent-stopped-before-goal-complete",
    "entries": [
      {"type": "goal", "objective": "实现 Rust SPA 渲染并通过验收", "status": "running"},
      {"role": "assistant", "text": "M3 完成。"},
      {"type": "gold", "verdict": "incomplete", "evidence": [{"kind": "assistant_claim", "summary": "目标要求 SPA 渲染，当前只完成 M3。"}]}
    ],
    "expected": {"supervisorAction": "auto_continue", "messageForAgent": "继续推进当前目标：完成 SPA 渲染验收。不要停在 M3，先进入 M4。"}
  },
  {
    "name": "assistant-claims-complete-but-gold-fails",
    "entries": [
      {"type": "goal", "objective": "SPA 页面可访问并能渲染出内容", "status": "checking"},
      {"role": "assistant", "text": "项目目标达成。"},
      {"type": "gold", "verdict": "incomplete", "evidence": [{"kind": "command", "summary": "render-url 真实站点超时", "passed": false}]}
    ],
    "expected": {"supervisorAction": "auto_continue", "messageForAgent": "Gold 检查发现真实站点验收未通过。请继续修复 render-url 超时并重新验证。"}
  },
  {
    "name": "select-visible-option",
    "entries": [
      {"role": "assistant", "text": "选择 A 只写计划，B 直接执行 M0", "pendingAction": {"kind": "select_option", "options": ["A", "B"]}},
      {"role": "user", "text": "B"}
    ],
    "expected": {"kind": "select_option", "messageForAgent": "用户选择 B：直接执行 M0。"}
  },
  {
    "name": "continue-means-commit",
    "entries": [
      {"role": "assistant", "text": "M0 完成。要我执行 commit 吗？还是先 review？", "pendingAction": {"kind": "commit"}},
      {"role": "user", "text": "继续"}
    ],
    "expected": {"kind": "confirm_pending_action", "messageForAgent": "用户确认继续执行 pending commit。"}
  },
  {
    "name": "continue-question-after-goal-complete",
    "entries": [
      {"role": "assistant", "text": "M4 SPA 渲染目标已达成。M5 GUI 可选。", "pendingAction": {"kind": "continue_milestone", "milestone": "M5"}},
      {"role": "user", "text": "继续？"}
    ],
    "expected": {"kind": "confirm_pending_action", "messageForAgent": "用户倾向继续 M5，但需要按 M5 pending action 执行。"}
  },
  {
    "name": "background-process-event",
    "entries": [
      {"role": "user", "text": "[system] Background process exited with code unknown after 1m0s."}
    ],
    "expected": {"kind": "runtime_event"}
  },
  {
    "name": "file-approval-unblocks-commit",
    "entries": [
      {"type": "file-review-turn", "changes": [{"path": "Cargo.toml", "status": "modified"}]},
      {"type": "file-approval", "path": "Cargo.toml", "status": "approved"}
    ],
    "expected": {"kind": "none", "reason": "Approval is evidence only unless commit or continue is pending."}
  }
]
```

## Proposed Transient System Prompt

```text
You are a goal completion checker for a coding-agent session.

Decide whether the active goal is complete, incomplete, blocked, or unsafe to continue. Do not execute tools. Do not invent evidence.

Inputs:
- activeGoal
- recentVisibleMessages
- recentToolResults
- recentFileDiffs
- inFlightToolState
- sessionPolicy

Rules:
1. A user should not need to send "continue" for normal progress.
2. If the assistant stopped but the goal is incomplete, return incomplete with a concrete continueMessage.
3. If the assistant claims completion, verify against goal evidence.
4. If there is a real user decision, permission, credential, or unsafe/destructive action, return blocked with userQuestion.
5. Runtime events are evidence, not user intent.
6. Prefer deterministic evidence over model judgement.
7. Return JSON only.

Output:
{
  "verdict": "complete | incomplete | blocked | unsafe",
  "confidence": 0.0,
  "goalId": "...",
  "reason": "...",
  "evidence": [],
  "continueMessage": "...",
  "userQuestion": "..."
}
```

## Implementation Implication

The important piece is not routing `继续`. It is making `继续` unnecessary in the happy path.

1. User sets a goal.
2. Runtime writes `GoalState`.
3. Agent works until it stops, claims completion, hits timeout, or needs permission.
4. Supervisor asks gold to check completion.
5. If incomplete and no blocker exists, supervisor continues automatically.
6. If blocked, supervisor asks the user with a focused choice.
7. UI shows goal progress, gold evidence, and auto-continuation decisions without injecting unnecessary context into the main conversation.

`FeedbackRouter` remains useful, but only for user intervention and UI responses. It is not the central loop.
