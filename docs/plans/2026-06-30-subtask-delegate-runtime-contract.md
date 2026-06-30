# Subtask And Delegate Runtime Contract

This document consolidates the runtime contract for subtasks and delegated
sessions. It is the architecture-level guide for permission, Ask, hooks, Review,
status, history, session switching, and refresh recovery.

## Design Principle

Use one rule everywhere:

> The session that produces state owns that state. Parent/source sessions only
> show projections and navigation entry points.

This keeps the UI understandable and avoids mixing parent Review, child Review,
delegate Review, and cross-project state into one unsafe bucket.

## Core Objects

| Object                      | Key                                      | Owns                                                                                                                   | Does not own                                                           |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Session runtime             | `sessionId + sessionPath + projectPath`  | messages, streaming status, pending UI requests, Review state, current permission profile, active model/agent snapshot | project trust, project path permission cache, execution sandbox config |
| Project runtime state       | `projectPath`                            | trust, path permission cache, execution sandbox mode, project-scoped private state                                     | per-session Review state, per-session messages                         |
| Parent/source projection    | parent/source `sessionId`                | child/delegate cards, counts, badges, jump targets                                                                     | child/delegate messages, Review baselines, approve/reject state        |
| Effective session selection | active parent plus optional active child | right panel target, Review target, message target                                                                      | RPC client ownership rebinding                                         |

## Relationship Semantics

| Relationship              | Subtask                                                             | Delegate                                                                                                      |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Product meaning           | A synchronized branch of the current parent turn.                   | An asynchronous background session sourced from another session.                                              |
| Binding strength          | Strongly bound to parent. Parent should surface important blockers. | Loosely bound to source. Source should expose status and return messages, but the delegate stays independent. |
| Default project           | Parent project by default.                                          | Source project by default, but may explicitly target another project.                                         |
| Cross-project expectation | Normally not cross-project.                                         | Must support cross-project without blindly carrying source project trust.                                     |
| Output return             | Result is part of the parent flow.                                  | Delegate explicitly sends output back with `session_delegate_send`.                                           |

## State Contract Matrix

| Area                        | Subtask contract                                                                                                                                                      | Delegate contract                                                                                                                                  | Current priority                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Permission profile          | Snapshot-inherit parent current profile at creation: `normal`, `autopilot`, `readonly`, or `yolo`. Later parent changes do not mutate existing subtasks.              | Snapshot-inherit source current profile for same-project creation. For cross-project delegates, do not treat source project trust as target trust. | P0 for subtask and same-project delegate. |
| Ask / user input            | Runtime request is owned by subtask, but parent shows the same pending request with child source label. Either parent or child can answer; first valid response wins. | Runtime request is owned by delegate, but source may show a pending request with delegate source label. Cross-project must show target project.    | P0 subtask, P1 delegate hardening.        |
| Hook approval               | Same as Ask, but label must show hook/tool/source subtask.                                                                                                            | Same as Ask, with delegate and target project when applicable.                                                                                     | P0 subtask, P1 delegate hardening.        |
| Permission runtime approval | Same identity as the owner session request. Parent is a projection, not a separate request.                                                                           | Same identity as the delegate request. Source projection must not create a second request.                                                         | P0 subtask.                               |
| Review visibility           | Parent shows a compact entry when subtask has pending Review.                                                                                                         | Source aggregation deferred; user handles Review inside delegate session for now.                                                                  | P0 subtask only.                          |
| Review handling             | Clicking parent entry switches to subtask Review context. Approve/reject targets subtask session.                                                                     | Direct delegate session Review works. Source-side proxy approve/reject is deferred.                                                                | P0 subtask only.                          |
| Review data ownership       | Subtask owns `review.pending`, approvals, baselines, approve/reject. Parent must not merge child files into parent Review list.                                       | Delegate owns its own Review state. Source must not merge delegate files into source Review list.                                                  | P0.                                       |
| Project trust               | Same project shares project-scoped trust by `projectPath`.                                                                                                            | Same project shares trust. Cross-project reads target project trust.                                                                               | P0.                                       |
| Path permission cache       | Same project shares project-scoped path permissions.                                                                                                                  | Same project shares path permissions. Cross-project reads target project path permissions.                                                         | P0.                                       |
| Execution sandbox           | Read by subtask `projectPath`; do not copy from parent session state.                                                                                                 | Read by delegate target `projectPath`; do not copy from source session state.                                                                      | P0.                                       |
| Hooks config                | Load by subtask runtime, agent, and project.                                                                                                                          | Load by delegate runtime, agent, and project.                                                                                                      | P1 validation.                            |
| Agent / role                | Creation may inherit parent default or use explicit agent parameter. Explicit agent failure must not fall back to `build`.                                            | Often explicit. Failure must not fall back to `build`.                                                                                             | P0 already important.                     |
| Model / tier / thinking     | Creation may snapshot parent defaults unless explicitly overridden. Child can diverge after creation.                                                                 | Same-project delegates may snapshot source defaults. Cross-project may use target defaults or explicit override.                                   | P1.                                       |
| Status display              | Parent card, sidebar, child page, and right panel must resolve from the same child session state.                                                                     | Source card, sidebar, delegate page, and right panel must resolve from delegate session state.                                                     | P0 subtask, P1 delegate.                  |
| Message history             | Card jump and sidebar jump must show the same child session history.                                                                                                  | Delegate jump and sidebar jump must show the same delegate history.                                                                                | P0 subtask, P1 delegate.                  |
| Right panel                 | Driven by effective session. Entering child switches right panel target to child resources/state. Leaving child restores parent.                                      | Entering delegate switches right panel target to delegate resources/state.                                                                         | P0.                                       |
| Refresh/reconnect           | Parent and child must recover child list, status, pending UI, Review entry, and history from queryable backend state.                                                 | Source and delegate should recover session card, status, history, and direct Review. Source Review aggregation deferred.                           | P0 subtask, P1 delegate.                  |
| Parent/source later changes | Later permission/model changes on parent do not automatically mutate existing child unless user explicitly syncs.                                                     | Later source changes do not mutate existing delegate.                                                                                              | P0.                                       |

## Implementation Phases

| Phase | Scope                         | Do                                                                                                                                                                                                                | Do not do                                                                                            |
| ----- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P0    | Subtask strong consistency    | Fix effective session selection, right panel target, subtask permission snapshot inheritance, parent-visible Ask/Hook request projection, subtask Review entry, same history from card/sidebar, refresh recovery. | Do not merge child Review files into parent Review list. Do not proxy cross-project delegate Review. |
| P1    | Delegate baseline consistency | Keep delegate status/history/right-panel consistent. Preserve same-project permission profile inheritance. Ensure direct delegate Review works.                                                                   | Do not build source-side cross-project Review approve/reject yet.                                    |
| P2    | Delegate blocker projection   | Add source-visible delegate Ask/Hook/Review blockers with clear source and target project labels.                                                                                                                 | Do not let source project trust approve target project operations.                                   |
| P3    | Optional proxy actions        | Consider parent/source-side direct proxy approve/reject only after owner-session routing is proven.                                                                                                               | Do not ship proxy actions without owner session id, session path, project path, and source labels.   |

## Required Architecture Rules

| Rule                                                             | Reason                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Never use RPC client `switchSession` for UI session selection.   | Session switching is a UI/service active-selection problem, not client ownership rebinding. |
| Every blocker must have one owner request id.                    | Parent/source projections must close when the owner request resolves.                       |
| Review panel must render backend `review.pending` data directly. | Baselines and added/deleted counts are backend truth.                                       |
| Project-scoped state must stay under project-scoped storage.     | Trust, path permission caches, and sandbox settings are not app-global session guesses.     |
| Refresh/reconnect is part of acceptance.                         | Live events are not enough for runtime-visible state.                                       |

## Acceptance Checklist

| Case                                           | Expected                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Parent full access then create subtask         | Subtask permission profile is full access at creation.                                  |
| Parent changes permission after subtask starts | Existing subtask does not mutate automatically.                                         |
| Subtask asks for user input                    | Parent and child show one shared pending request with source label.                     |
| Subtask hits hook approval                     | Parent and child show one shared pending request with hook/source label.                |
| Subtask creates pending Review                 | Parent shows a compact subtask Review entry; parent Review list remains parent-only.    |
| Open subtask Review entry                      | UI switches to subtask; Review actions target child session.                            |
| Jump by card vs sidebar                        | Both show the same child history, status, and right panel state.                        |
| Refresh parent session                         | Child list, status, pending request projection, and Review entry recover.               |
| Delegate same-project created                  | Delegate may inherit source permission profile, but remains independent after creation. |
| Delegate cross-project created                 | Target project trust/path/sandbox are read from target project, not source project.     |

## Current Slice Link

The first implemented Review slice is documented in:

```text
docs/plans/2026-06-30-subagent-review-approval-contract.md
```

That slice covers parent-visible subtask Review entry only. It intentionally
does not implement delegate/source-session Review aggregation.
