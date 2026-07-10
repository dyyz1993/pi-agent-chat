# Recent PR / Issue Test Matrix

Scope:

- Repo: `dyyz1993/pi-agent-chat`
- Snapshot date: `2026-07-03`
- Focus window: merged / updated on `2026-07-02`
- GitHub pull request count merged on `2026-07-02`: `40`
- GitHub issue count updated on `2026-07-02`: `35`

Source queries used:

- `gh pr list --state merged --search "merged:2026-07-02 sort:updated-desc" --limit 100`
- `gh issue list --state all --search "updated:2026-07-02 sort:updated-desc" --limit 100`

## Recommended First Sweep

If time is limited, run these first because they cover the widest regression surface:

- [ ] Session create / restore / refresh: create a new scoped session, switch away, refresh app, return to it. Expected: no jump back to old session, no duplicate render, agent changes and system events restore correctly.
- [ ] Queue + steer controls: queue multiple messages, remove one queued item, then clear while one item is already executing. Expected: individual remove works, active steer aborts cleanly, queue state matches UI.
- [ ] Parallel tool output: trigger two tools in parallel and watch live cards. Expected: both tool outputs stream and finalize; no missing `toolResult`.
- [ ] Pending modal / ask modal scope: trigger a permission request from one chat while another chat is open. Expected: pending panel stays scoped to the originating chat and shows request source clearly.
- [ ] ContentSurface / file preview / markdown links: open image, markdown, code expand, diff, and file overlay from chat; click relative and absolute file links in markdown. Expected: all content uses consistent surface chrome and opens the correct file.
- [ ] Long paste handling: paste a long multi-line block or code fence. Expected: content compacts into the intended attachment / placeholder flow instead of flooding the textarea.
- [ ] Session mention picker: type `@` or the configured trigger in composer, select a session, send. Expected: selection inserts the right session reference and navigation / preview behavior stays correct.
- [ ] Idle reload: wait for an idle session, verify reload button appears, click it. Expected: RPC client reconnects cleanly and button is not shown while busy.
- [ ] SSH status and bootstrap: open an SSH project or simulated remote attach flow. Expected: tab status differentiates connecting SSH vs starting agent, bootstrap verification reports pass/fail clearly.
- [ ] Worktree isolation: create or inspect a managed worktree stack. Expected: worktrees live under `~/.pi/worktrees/`, registry / manifest data stays consistent, and paired stack metadata is intact.
- [ ] Token / observability stats: run a session with model output, then inspect token usage and observability views. Expected: cumulative token usage, cache display toggle, and session observability stats are accurate and non-duplicated.
- [ ] Hooks / background bash: on mobile width and desktop, trigger a hook command and a background bash action. Expected: hook command text remains readable on mobile and background action cards reconcile with real process state.

## Full Checklist By PR

Format:

- `Priority | PR / related issue | Case`

### P0: Core Runtime, Session, Queue, Chat

- [ ] `P0 | PR #142 / Issue #100 |` Keep the app running, open many sessions, switch among them, then inspect memory-sensitive UI behavior after a long session. Expected: inactive sessions no longer keep unbounded chat-message cache; app remains responsive.
- [ ] `P0 | PR #141 / Issue #14 |` Start a delegated child agent that can hit approval / wait paths. Expected: delegated flow no longer hangs indefinitely on pending approval / timeout edge cases introduced by the runtime bump.
- [ ] `P0 | PR #140 / Issue #15 |` Queue several messages, remove one queued message, and try immediate interruption of the active send. Expected: queue APIs from the upgraded runtime power per-item removal and interruption correctly.
- [ ] `P0 | PR #136 / Issue #129 |` Trigger a supervisor-driven continue push. Expected: a visible custom entry / card appears so the user can see the continue action happened.
- [ ] `P0 | PR #133 / Issue #128 |` Run two tools concurrently in one turn. Expected: each live tool execution card shows output independently and both final `toolResult` payloads render.
- [ ] `P0 | PR #116 / Issue #33 |` In composer, invoke the session mention picker and select a target session. Expected: the selected session reference is inserted correctly and follow-up navigation / reference behavior is correct.
- [ ] `P0 | PR #126 / Issue #87 |` Paste a long multi-line snippet or long plain text block. Expected: the UI compacts content into the intended attachment / placeholder representation and preserves enough context for send.
- [ ] `P0 | PR #92 / Issue #89 |` In an idle chat session, verify the reload button becomes visible, then click it. Expected: the RPC client reloads only when idle and does not duplicate or lose the session.
- [ ] `P0 | PR #105 / Issue #100 |` Leave a session inactive while events arrive elsewhere, then return. Expected: inactive-event buildup is cleaned up and returning to the session does not replay stale growth endlessly.
- [ ] `P0 | PR #115 / Issue #113 |` Create a new scoped session and immediately navigate around. Expected: the new session stays visible and active instead of snapping back to a previous session.
- [ ] `P0 | PR #125 / Issue #14 |` End a child / delegated agent run that is near completion. Expected: child end state is delivered to UI before cleanup removes internal state.
- [ ] `P0 | PR #122 / Issue #120 |` Open a cold session, refresh, and inspect the message list. Expected: session contents do not duplicate on refresh.
- [ ] `P0 | PR #123 / Issue #34 |` Send a delegate message to a known session, including a cross-session or cross-project path that used to fail. Expected: send succeeds when the session is known and errors are no longer misleading.
- [ ] `P0 | PR #124 / Issue #26 |` Start a delegated or subagent run with a non-default model / level, switch away, then restore. Expected: model / level selections and agent changes are preserved for inactive sessions.
- [ ] `P0 | PR #84 / related permission metadata work |` Change permission mode / profile on a session and inspect UI badges / stored metadata. Expected: displayed permission metadata matches the real runtime state after transitions.
- [ ] `P0 | PR #118 / Issue #57 |` Run a session with tool calls and read-heavy actions, then inspect observability stats. Expected: context duplication, tool frequency, or similar observability counters surface without obvious drift or empty states.
- [ ] `P0 | PR #109 / Issue #98 |` Send several turns with meaningful input / output and inspect per-session token totals. Expected: cumulative token usage updates correctly for input, output, and cached usage.
- [ ] `P0 | PR #117 / Issue #56 |` Trigger a behind-the-scenes operation such as model switch, approval mode change, or directory change. Expected: a recoverable system event entry exists for the session and survives reload.
- [ ] `P0 | PR #91 / Issue #88 |` Launch a bash command in background mode from chat. Expected: the action is recorded in the managed map and the chat card reflects real background process state.
- [ ] `P0 | PR #99 / Issue #27 |` Queue a steer action, let it begin execution, then clear the queue. Expected: active steer aborts cleanly instead of continuing due to race conditions.
- [ ] `P0 | PR #83 / Issue #15 |` Add multiple queued messages and remove one non-active item. Expected: only the selected queued message disappears and the rest keep correct order / state.

### P0: Preview, Overlay, UI Interaction

- [ ] `P0 | PR #148 / follow-up to Issue #93 |` Render markdown that contains an absolute file path link and click it. Expected: the correct local file preview opens and the markdown link remains clickable.
- [ ] `P0 | PR #146 / Issue #44 |` Open diff, file, markdown expand, code expand, and image preview flows after the ContentSurface refactor. Expected: shared surface chrome, close behavior, and safe-area handling are consistent.
- [ ] `P0 | PR #119 / Issue #44 |` Specifically verify the original shared ContentSurface implementation across chat-scoped previews. Expected: header actions, layout, and content stage behavior are consistent across preview types.
- [ ] `P0 | PR #111 / Issue #7 |` Trigger a pending request modal from different sources. Expected: source labeling is visible so the user knows where the permission request came from.
- [ ] `P0 | PR #107 / Issue #102 |` Open a permission request while navigating chats. Expected: the pending request panel is scoped to the active chat surface instead of acting like a global stray modal.
- [ ] `P0 | PR #106 / Issue #104 |` On mobile width, open a hook command popup / surface with long command text. Expected: the command remains readable without clipping or impossible wrapping.
- [ ] `P0 | PR #95 / Issue #93 |` Render markdown with a relative file path and click it. Expected: the app resolves the path against the project and opens preview / edit correctly.

### P1: Remote, Worktree, Agent Tooling

- [ ] `P1 | PR #145 / Issue #138 |` Run the remote bootstrap setup / verifier on a machine or simulated target with one good and one bad prerequisite. Expected: the verifier clearly reports success and actionable failure states.
- [ ] `P1 | PR #101 / Issue #25 |` Use the `issue-manager` agent on a fresh feedback item. Expected: it records validation session details and produces an issue-management oriented handoff instead of coding directly.
- [ ] `P1 | PR #139 / deployment + deps |` Fresh-install or CI-like install the repo after replacing yalc-linked deps with npm versions. Expected: install succeeds, expected deployment tooling is present, and app boots.
- [ ] `P1 | PR #130 / Issue #41 |` Create a managed worktree stack and inspect resulting directories and registry files. Expected: managed worktrees are isolated under `~/.pi/worktrees/` and stack metadata stays coherent.
- [ ] `P1 | PR #108 / Issue #36 |` Open an SSH session and observe tab state through connect, bootstrap, and ready phases. Expected: tab UI distinguishes SSH-connecting from agent-starting states.
- [ ] `P1 | PR #137 / desktop dev override |` Start desktop dev with a custom dev-server URL override. Expected: the desktop app points at the override URL instead of hard-coded default probing behavior.
- [ ] `P1 | PR #97 / Issue #65 |` Run the persistence path lint / verification command. Expected: disallowed persistence paths fail and allowed project-scoped paths pass.
- [ ] `P1 | PR #96 / yalc pi-tui resolution |` Install / run with yalc-linked local dependencies. Expected: `pi-tui` resolves from yalc correctly and the app starts without missing-module failures.
- [ ] `P1 | PR #127 / local yalc hydration |` Update the local yalc version and reinstall / restart. Expected: the local `pi-tui` package hydrates to the expected version without stale dependency state.

### P1: Settings, Stats, Misc UX

- [ ] `P1 | PR #114 / Issue #112 |` Open settings, find the cache display toggle, and flip it on and off. Expected: default is off, toggling changes the related display without breaking token stats.

### P2: Documentation / Process Closures

- [ ] `P2 | PR #144 / Issue #7 |` Open the permission pending workflow docs and confirm the final workflow / ownership model matches the implemented store + event architecture. Expected: docs are updated and not obviously stale versus current UI.
- [ ] `P2 | PR #143 / Issue #41 |` Open the issue orchestration workflow doc and verify the documented leader/worker/worktree flow matches current scripts and agent prompts. Expected: closure docs align with current implementation.

## Recent Issue-Oriented Checks Not Obvious From The PR Titles Alone

These issues were also updated on `2026-07-02` and are worth explicit spot checks even if the exact closing PR is not obvious from the first PR list:

- [ ] `Issue #4 |` Run an autopilot-like flow that previously raised approval modals. Expected: dangerous-command / path-boundary / review prompts follow the intended autopilot policy rather than appearing unexpectedly.
- [ ] `Issue #132 |` Force a tool execution failure in one turn. Expected: failure turns do not trigger memory extraction or skill distillation side effects.
- [ ] `Issue #135 |` Create a scenario with repeated supervisor intervention pressure. Expected: continue / stagnation logic is less aggressive and does not loop or over-fire.
- [ ] `Issue #10 |` Try read-only operations (`read`, `grep`, `glob`, `find`, `ls`) on a path outside cwd but still within the intended safe read boundary. Expected: the normal-mode permission behavior matches the new rule.
- [ ] `Issue #131 |` Trigger a tool execution failure that returns a verbose raw error. Expected: the full raw error is not blindly injected into LLM-visible context.

## Suggested Execution Order

- Phase 1: run the 12-item first sweep.
- Phase 2: run all `P0` cases.
- Phase 3: run `P1` remote / worktree / deps cases on a clean stack.
- Phase 4: run `P2` doc / workflow alignment checks.

## Evidence To Capture

- For UI regressions: screenshot or short screen recording.
- For runtime / queue / delegate regressions: session JSONL snippet or console / log excerpt.
- For remote / worktree checks: command output plus relevant manifest / registry path.
- For settings / stats checks: before-after screenshot with exact session state.

## Paste-Ready Prompts

Use these blocks directly with your issue / validation / test-case agent.

### Prompt A: First Sweep

```md
请基于下面这些最近改动，输出一份“可直接执行的测试 case 清单”。

要求：

1. 每条 case 都必须包含：
   - Title
   - Purpose
   - Setup
   - Steps
   - Expected
   - Evidence
   - Priority
2. 优先输出用户手测 case，不要只写单元测试建议。
3. 如果一个点需要区分 desktop / web / mobile，请拆开写。
4. 如果一个点有明显负向场景，也请补一条 negative case。
5. 输出格式请用 markdown checklist。

本轮先覆盖以下高风险回归面：

1. Session create / restore / refresh
   - create scoped session
   - switch away and back
   - refresh app
   - verify no jump back to old session
   - verify no duplicate render
   - verify agent changes and system events restore correctly

2. Queue + steer controls
   - queue multiple messages
   - remove one queued item
   - clear queue while one item is already executing
   - verify active steer aborts cleanly

3. Parallel tool output
   - trigger two tools in parallel
   - verify both live outputs stream
   - verify both final toolResult cards render

4. Pending modal / ask modal scope
   - trigger permission request from one chat
   - switch to another chat
   - verify pending panel stays scoped to originating chat
   - verify source label is visible

5. ContentSurface / file preview / markdown links
   - open image preview
   - open markdown expand
   - open code expand
   - open diff overlay
   - open file overlay
   - click relative file path in markdown
   - click absolute file path in markdown
   - verify surface chrome is consistent

6. Long paste handling
   - paste long multi-line text
   - paste code fence
   - verify content compacts into attachment / placeholder flow

7. Session mention picker
   - invoke mention picker in composer
   - select a session
   - verify inserted reference and follow-up behavior

8. Idle reload
   - verify reload button only appears when idle
   - click reload
   - verify RPC reconnect is clean

9. SSH status and bootstrap
   - open SSH project or remote attach flow
   - verify tab differentiates SSH connecting vs agent starting
   - run bootstrap verifier and verify pass/fail output

10. Worktree isolation

- create or inspect managed worktree stack
- verify worktrees are under ~/.pi/worktrees/
- verify registry / manifest consistency

11. Token / observability stats

- run session with model output and tool calls
- verify cumulative token usage
- verify cache display toggle behavior
- verify observability stats do not duplicate or stay empty unexpectedly

12. Hooks / background bash

- mobile width: verify hook command readability
- desktop: trigger background bash action
- verify action card reconciles with actual process state
```

### Prompt B: Core Runtime / Chat / Queue

```md
请围绕下面这些 PR / issue 输出详细测试 case。

要求：

1. 每个 PR / issue 至少 1 条 case，复杂项可拆多条。
2. 每条 case 必须包含：
   - Title
   - Related PR / Issue
   - Setup
   - Steps
   - Expected
   - Evidence
   - Priority
3. 优先手工回归 case。
4. 请特别注意 refresh-safe / reconnect-safe / restore-safe。

覆盖范围：

- PR #142 / Issue #100
  - app long-running memory behavior
  - inactive session cache cap
  - responsiveness after many session switches

- PR #141 / Issue #14
  - delegated child agent approval / wait path
  - timeout / pending edge cases after runtime bump

- PR #140 / Issue #15
  - queue APIs
  - remove queued item
  - interrupt active send

- PR #136 / Issue #129
  - supervisor continue push visible custom entry card

- PR #133 / Issue #128
  - parallel tools
  - missing tool output regression

- PR #116 / Issue #33
  - session mention picker

- PR #126 / Issue #87
  - long paste compacting
  - placeholder / attachment rendering

- PR #92 / Issue #89
  - idle reload button
  - no reload while busy

- PR #105 / Issue #100
  - inactive event buildup cleanup

- PR #115 / Issue #113
  - create new scoped session
  - visibility after creation
  - no snap back to old session

- PR #125 / Issue #14
  - child end arrives before cleanup

- PR #122 / Issue #120
  - cold session duplicate refresh regression

- PR #123 / Issue #34
  - session_delegate_send to known session
  - cross-session / cross-project behavior

- PR #124 / Issue #26
  - delegated / subagent restore
  - non-default model / level persistence

- PR #84
  - permission mode metadata sync

- PR #118 / Issue #57
  - observability stats
  - read-read-edit / tool frequency style signals

- PR #109 / Issue #98
  - cumulative token usage

- PR #117 / Issue #56
  - recover system event entries after reload / restore

- PR #91 / Issue #88
  - background bash action reconciliation

- PR #99 / Issue #27
  - clear queue while steer already started

- PR #83 / Issue #15
  - remove individual queued message
```

### Prompt C: Preview / Overlay / Pending UI

```md
请围绕下面这些 UI 改动输出详细测试 case。

要求：

1. 每项至少给 1 条正常 case，1 条回归或 negative case。
2. 每条 case 必须包含：
   - Title
   - Related PR / Issue
   - Setup
   - Steps
   - Expected
   - Evidence
   - Priority
3. 若涉及 desktop / web 差异，请拆开。
4. 若涉及 fullscreen / overlay，请检查 close 行为和 safe-area。

覆盖范围：

- PR #148 / follow-up to Issue #93
  - absolute markdown file path clickable
  - opens correct local preview

- PR #146 / Issue #44
  - content surface overlay refactor
  - diff / file / markdown / code / image preview consistency

- PR #119 / Issue #44
  - shared ContentSurface chrome baseline

- PR #111 / Issue #7
  - pending request source label

- PR #107 / Issue #102
  - pending request panel scoped to chat

- PR #106 / Issue #104
  - hook commands readable on mobile

- PR #95 / Issue #93
  - relative markdown file path clickable
  - resolves against project correctly
```

### Prompt D: Remote / Worktree / Deps / Tooling

```md
请围绕下面这些远程、worktree、依赖和工具链改动输出测试 case。

要求：

1. 每条 case 必须包含：
   - Title
   - Related PR / Issue
   - Setup
   - Steps
   - Expected
   - Evidence
   - Priority
2. 对于脚本 / 安装 / worktree / remote verifier，请同时给：
   - happy path
   - failure path
   - stale-state / retry case

覆盖范围：

- PR #145 / Issue #138
  - remote machine bootstrap
  - one-command setup
  - verification pass/fail reporting

- PR #101 / Issue #25
  - issue-manager agent flow
  - validation delegation
  - issue filing handoff quality

- PR #139
  - replace yalc-linked deps with npm versions
  - fresh install / CI-like boot

- PR #130 / Issue #41
  - managed worktree isolation under ~/.pi/worktrees/
  - registry / manifest consistency

- PR #108 / Issue #36
  - SSH tab connection state
  - connecting vs agent-starting distinction

- PR #137
  - desktop dev server URL override

- PR #97 / Issue #65
  - persistence path lint
  - allowed vs disallowed persistence locations

- PR #96
  - resolve pi-tui from yalc

- PR #127
  - hydrate pi-tui from local yalc version
```

### Prompt E: Recent Issue Spot Checks

```md
请针对下面这些最近更新的 issue，补一组“问题导向”的测试 case。

要求：

1. 每个 issue 至少输出 1 条主 case。
2. 如果 issue 明显涉及策略边界或错误处理，请补 1 条 negative case。
3. 输出格式：
   - Title
   - Related Issue
   - Setup
   - Steps
   - Expected
   - Evidence
   - Priority

覆盖 issue：

- Issue #4
  - autopilot mode unexpectedly showing approval modals

- Issue #132
  - failed tool turn should not trigger memory extraction / skill distillation

- Issue #135
  - supervisor misclassification / over-aggressive continue / weak stagnation detection

- Issue #10
  - read-only operations outside cwd permission behavior

- Issue #131
  - raw tool error should not be fully injected into LLM context
```
