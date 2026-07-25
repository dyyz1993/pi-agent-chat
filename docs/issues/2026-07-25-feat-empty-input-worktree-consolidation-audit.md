# feat-empty-input-MsBgZ0 Worktree Consolidation Audit

Date: 2026-07-25

Source worktree:
`/Users/xuyingzhou/.trae-cn/worktrees/pi-agent-chat/feat-empty-input-MsBgZ0`

Target app repo:
`/Users/xuyingzhou/Project/temporary/pi-agent-chat`

Paired fork:
`/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent`

## Purpose

This note records the consolidation decisions for the dirty
`feat-empty-input-MsBgZ0` worktree. The goal is to keep master safe by moving
only small, validated changes and by not treating every dirty file as a change
that should be merged.

The source worktree currently contains 41 modified files and 15 untracked files.
Several modified files are already byte-for-byte identical to master, and many
remaining diffs are comments, temporary diagnostics, or older versions of fixes
that master now implements more safely.

## Current Repository State

- App master: clean, `master...origin/master [ahead 34]`
- Paired fork: clean, `main...origin/main [ahead 56]`
- Source worktree: dirty by design; do not clean, reset, or delete it as part of
  this consolidation.

## Changes Already Consolidated Into Master

These commits were split out of the worktree or its surrounding recovery work
and committed on master as narrow, validated modules:

- `2bd8f24f fix(chat): order late memory events before assistant response`
- `5c331ce9 fix(git): bound local and ssh git command execution`
- `286b7b1b fix(chat): remove duplicate queued message insertion handler`
- `388159ac feat(chat): offer message-only rollback from file preview`
- `9d507128 fix(ui): sort favorite models before filtering`
- `997ebee0 fix(ui): avoid direct dev websocket on public hosts`
- `6b5b7b71 fix(ui): route desktop paste through bridge`
- `c9b6d502 fix(ui): reload after chunk load failures`
- `d96c151e fix(chat): load newer sidenav page at bottom`
- `eeaa7f50 fix(chat): page newer nav messages by cursor`
- `1fe93d8e fix(chat): bound side nav history window`
- `f4363c12 fix(chat): keep initial scroll fallback revealed`
- `301e7bb3 fix(chat): bound streaming memory merge pages`
- `e55ab33e fix(status): clear local supervisor goal optimistically`
- `7e7c15c8 fix(project): align hmr dev port`
- `fa359ae6 fix(session): resubscribe active session after reconnect`
- `d508d9dc fix(agent): abort active session before reload`
- `d5684213 fix(agent): allow longer compaction timeout`
- `1f4053ca fix(agent): clear lsp state on process eviction`
- `7d450698 fix(agent): recover managed clients from disk metadata`
- `afe1fefd fix(project): isolate quick create name generation`
- `d6bf051c fix(ui): route desktop edit menu through bridge`
- `47f45941 fix(status): persist supervisor goal fallback`
- `c4e78cb0 fix(project): return quick create plan`
- `6d6642ad fix(status): locate supervisor data by project path`
- `9a11a1a3 fix(agent): wait for idle before steer fallback`
- `99c4fa2f fix(agent): type message nav newer cursor`

## Files Already Equivalent To Master

The source worktree still reports these files as modified, but their current
contents match master:

- `src/bun/index.ts`
- `src/mainview/components/chat/CachedReactMarkdown.tsx`
- `src/mainview/components/chat/TextContentCard.tsx`
- `src/mainview/components/session-sidebar/SessionSidebar.tsx`
- `src/mainview/stores/use-supervisor-store.ts`
- `src/shared/modules/agent.ts`

These should not be re-committed or used as evidence of missing master work.

## Remaining Dirty Groups And Decisions

### Documentation Dumps

Files:

- `AGENTS.md`
- `docs/architecture/pi-expert-knowledge-map.md`
- `docs/architecture/pi-expert-appendix.md`

Decision: do not merge as-is.

Reason:

- The added `AGENTS.md` section is a point-in-time "Recent Commit Context" and
  "Plan TODOs" dump. It includes stale statements such as files that "still may
  need API adaptation" after master has tests covering those paths.
- The pi-expert documents include feature-worktree absolute paths such as
  `.trae-cn/worktrees/pi-agent-chat/feat-empty-input-MsBgZ0`.
- The appendix includes volatile generated counts, for example store and RPC
  method totals. Those counts need a separate documentation maintenance pass if
  they are to become durable docs.

### Runtime Performance Monitor

Files:

- `src/mainview/App.tsx`
- `src/mainview/lib/runtime-perf-monitor.ts`
- `src/shared/handlers/system.ts`
- `src/shared/modules/system.ts`
- `package.json`
- `bun.lock`
- `src/mainview/stores/use-chat-store.ts`

Decision: do not merge as-is.

Reason:

- The worktree adds an always-on 5-second runtime monitor that samples DOM,
  heap, long tasks, and message counters.
- It adds a backend `system.logPerfReport` RPC only for warning reports.
- It adds `gpt-tokenizer`, but the runtime monitor diff does not use it.
- The lockfile also removes `@anthropic-ai/sandbox-runtime` entries while
  `package.json` does not intentionally remove that dependency. This is an
  unrelated lockfile risk.

If performance diagnostics are needed, implement them later behind an explicit
diagnostic flag, with tests around the RPC contract and dependency changes.

### Chunk Load Recovery

Files:

- `src/mainview/components/ErrorBoundary.tsx`
- `src/mainview/lib/safe-lazy.tsx`

Decision: do not merge.

Reason:

- Master already has `src/mainview/lib/safe-lazy.ts` with shared chunk error
  detection and reload cooldown helpers.
- Master has `test/unit/lib/safe-lazy.test.ts`.
- The worktree version inlines similar logic back into `ErrorBoundary` and adds
  an untracked alternate component, which would regress the current abstraction.

### Dev WebSocket And Proxy Routing

Files:

- `src/mainview/lib/api-client.ts`
- `src/mainview/lib/proxy.ts`

Decision: do not merge.

Reason:

- Master keeps testable helpers:
  `resolveDevApiTarget`, `resolveDevWebSocketTarget`, and
  `parseProxyServerHost`.
- The worktree removes those helpers and inlines environment parsing, reducing
  testability.
- Master has targeted tests for both dev target resolution and proxy host
  parsing.

### Message Pagination And JSONL Reading

Files:

- `src/shared/agent/agent-client-api-adapter.ts`
- `src/shared/agent/agent-client-message-operations.ts`
- `src/shared/agent/session-branch-filter.ts`
- `src/shared/agent/session-jsonl-messages.ts`
- `src/shared/agent/session-message-reader.ts`
- `src/shared/handlers/agent.ts`

Decision: do not merge the remaining dirty diff.

Reason:

- Master moved `beforeEntryId` to the real `agent.getMessageNavPage` path.
  The remaining worktree diff moves it back toward `agent.getFullMessages`.
- Master keeps merge-after-pagination corrections for `hasMore`, `nextCursor`,
  and `customEntries`. The worktree diff removes or weakens those updates.
- This area affects historical message windows and custom entry ordering, so
  regressions here could look like lost history.

### Agent Send Recovery And Supervisor Goal Fallback

Files:

- `src/shared/agent/process-manager.ts`
- `src/shared/handlers/supervisor.ts`

Decision: keep only the already extracted safe commits.

Already kept:

- `9a11a1a3`: wait briefly for idle before falling back to steer.
- `47f45941`: persist supervisor goal fallback.
- `6d6642ad`: locate supervisor data by project path before scanning buckets.

Do not merge the remaining dirty diff:

- It forcibly changes a managed client's streaming status to idle and resends a
  prompt after a timeout.
- It schedules background `setGoal` retries that could run after the user has
  cleared or changed the goal.

These behaviors need a separate design and stronger runtime tests before they
are safe.

### Rollback Auto-Abort

File:

- `src/mainview/components/chat/RollbackOverlay.tsx`

Decision: do not merge as-is.

Reason:

- The remaining diff automatically calls `agent.abort` when rollback is blocked
  by streaming, then retries navigation.
- That changes an active running session from inside rollback UI. It needs an
  explicit user-confirmed product decision before merging.

### Quick Create Project Flow

Files:

- `src/shared/handlers/project.ts`
- `src/shared/modules/project.ts`
- `src/mainview/locales/en/sidebar.json`
- `src/mainview/locales/zh-CN/sidebar.json`

Decision: keep master.

Reason:

- Master already has the structured quick-create plan, sanitization helpers,
  README rendering, isolated pi config directory, and focused tests.
- The worktree version inlines types, rewrites temp directory naming, and only
  adds a small cleanup wrapper.
- The locale-only `picker.qc.setDir` key has no corresponding master caller.

### UI Comments And Formatting Only

Files:

- `src/mainview/components/model-picker/ModelPickerButton.tsx`
- `src/mainview/components/primitives/AnchoredPopover.tsx`
- `src/mainview/components/chat/SideNav.tsx`
- `src/mainview/lib/desktop-edit-commands.ts`
- `src/mainview/stores/use-session-store.ts`
- `src/shared/agent/agent-client-session-operations.ts`
- `src/shared/agent/event-handler.ts`
- `src/shared/handlers/git.ts`
- `src/mainview/lib/agent-event-handler.ts`
- `test/unit/handlers/agent-event.test.ts`

Decision: do not merge comment-only or formatting-only changes.

Reason:

- The relevant behavior is already in master with tests.
- Merging comments from a dirty worktree would create churn without improving
  the target state.

### Temporary And Scratch Files

Files:

- `MERGE_CONFLICT_DECISIONS.md`
- `cleanup-target.sh`
- `scripts/debug-getfullmessages.ts`
- `scripts/debug-list-sizes.ts`
- `scripts/debug-sidenav-items.ts`
- `test/unit/extension-context-getsettings.test.ts`
- `test/unit/pi-hooks-getsettings-verification.test.ts`
- `test/unit/pi-hooks-getsettings.test.ts`
- `test/unit/simple-getsettings.test.ts`

Decision: do not merge.

Reason:

- `MERGE_CONFLICT_DECISIONS.md` is a scratch conflict-resolution note for the
  feature worktree.
- `cleanup-target.sh` is a destructive cleanup script and should not enter
  master as part of consolidation.
- The debug scripts start local servers and inspect real local session data;
  they are not stable repository tests.
- The getSettings tests are ad-hoc app-side checks for a fork runtime API. The
  fork already has formal tests and implementation coverage.

### Already Present In Master

Files:

- `eslint-plugin-no-hardcoded-port/`
- `src/shared/lib/native-open-external.ts`
- `test/unit/components/ModelPickerButton.test.tsx`

Decision: do not merge duplicate worktree copies.

Reason:

- Master already contains the relevant plugin, native open helper, and model
  picker tests.
- The worktree version mostly differs by comments or broader test style.

## Validation Evidence

App-side focused tests:

```sh
bun run test -- \
  test/unit/utils/api-client-dev-target.test.ts \
  test/unit/utils/proxy.test.ts \
  test/unit/lib/safe-lazy.test.ts \
  test/unit/components/ModelPickerButton.test.tsx \
  test/unit/components/SideNav.test.tsx \
  test/unit/handlers/project.test.ts \
  test/unit/handlers/supervisor.test.ts \
  test/integration/agent/process-manager-send-recovery.test.ts
```

Result: 8 test files passed, 165 tests passed.

Fork-side focused tests:

```sh
npm test -- \
  test/extension-api-contract.test.ts \
  test/extensions-runner.test.ts \
  extensions/output-guard/__tests__/loadConfig.test.ts
```

Result: 3 test files passed, 113 tests passed.

Known non-blocking warnings:

- App tests emit existing `--localstorage-file` warnings.
- `test/unit/handlers/project.test.ts` currently has duplicate mock-key warnings.
- Fork tests emit existing root `tsconfig.json` duplicate path-key warnings.

## Merge Guidance

Do not attempt to "clean" the source worktree by committing all dirty files.
Future work should continue only in small, validated slices:

1. Identify one remaining behavior that master truly lacks.
2. Write or locate a focused test proving the behavior.
3. Apply the minimal change in master or the paired fork source, not in
   generated build output or `node_modules`.
4. Run the focused test and the relevant lint/build gate.
5. Commit only that slice.

As of this audit, no additional dirty worktree file has enough evidence to be
merged as-is.
