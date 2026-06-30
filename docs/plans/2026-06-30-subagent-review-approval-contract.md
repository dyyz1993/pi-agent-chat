# Subtask Review Approval Contract

This note defines the small, near-term contract for Review approval in subtask
and delegated sessions.

Here, "approval" means **Change Review approval**: pending file changes,
approve, reject, approve all, and reject all. It does not mean interactive
Ask, hook approval, or permission prompts.

## Goal

Keep the main session review rhythm intact while making subtask review blockers
visible from the main session.

The main session may show that a child session needs Review, but the Review
state stays owned by the session that produced the file changes.

## Ownership Rule

| Rule              | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| State owner       | The session that produced the file changes owns `review.pending`, approvals, baselines, approve, and reject. |
| Main session role | The main session can show an entry point, count, and source label for child pending Review.                  |
| No state merging  | Child pending changes must not be mixed into the main session Review list.                                   |
| Action target     | Approve/reject must target the child session when reviewing child changes.                                   |

## Scope Matrix

| Area                      | Subtask                                                                                         | Delegated session                                      | Current slice                 |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| Pending Review visibility | Show an entry point in the parent session when a subtask has pending Review.                    | Do not add source-session Review aggregation yet.      | Do subtask only.              |
| Review list rendering     | Open the subtask's own Review context. Do not mix child files into parent files.                | Keep existing direct delegate session Review behavior. | Do subtask only.              |
| Approve/reject actions    | Execute against the subtask session.                                                            | Execute only when user is inside the delegate session. | Do subtask only.              |
| Cross-project behavior    | Not applicable for normal subtask; use the subtask's project/session metadata.                  | Cross-project Review aggregation is deferred.          | Defer delegate cross-project. |
| Refresh recovery          | Parent should recover the subtask Review entry after reload if child still has pending changes. | Deferred.                                              | Do subtask only.              |
| Status labels             | Parent entry must show it is from a subtask and include a readable subtask title.               | Existing delegate cards remain unchanged.              | Do subtask only.              |

## Issue Table

| Problem                                                                | Expected behavior                                                                | Do now                                                       | Do not do now                                           | Validation                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Parent cannot see subtask pending Review.                              | Parent shows a compact "Subtask needs Review" entry with count/source.           | Add parent-visible subtask Review entry.                     | Do not open a full modal automatically.                 | Create subtask that changes a file; parent shows the entry.                  |
| Parent Review list could become confusing if child files are mixed in. | Parent Review panel only shows parent changes.                                   | Keep parent and child Review lists separate.                 | Do not merge child pending files into parent `changes`. | Parent own Review list stays unchanged when child has pending files.         |
| User needs a quick path to handle child Review.                        | Clicking the entry switches to the child session and opens/fetches child Review. | Reuse the existing subtask session selection path.           | Do not proxy approve/reject from parent yet.            | Click entry; child Review context opens with child pending files.            |
| Review actions may target the wrong session.                           | Approve/reject acts on the effective child session.                              | Ensure Review fetch/actions use the active child session id. | Do not infer target from visible parent session.        | Approve one child file; it disappears from child pending Review, not parent. |
| Refresh loses child Review visibility.                                 | Reloading parent restores subtask list and pending Review entry.                 | Add refresh-safe discovery for child pending Review.         | Do not rely only on live events.                        | Reload after child creates pending change; entry returns.                    |
| Delegated cross-project Review is unsafe to aggregate casually.        | User handles delegate Review inside delegate session for now.                    | Leave delegate aggregation out of this slice.                | Do not inherit or proxy cross-project Review approval.  | Existing delegate direct Review still works.                                 |

## Implementation Notes

- Use session-scoped Review data as the source of truth.
- Prefer a small derived index such as "child session id -> pending Review count"
  rather than duplicating child `PendingChange` objects in the parent state.
- The parent entry should carry enough context for the user to trust the jump:
  subtask title, agent/session label when available, pending count, and session id
  in a tooltip or detail line.
- If child Review count is unknown, show no entry until a fetch or event proves
  there are pending changes.
- Keep the first implementation subtask-only. Delegate/source-session Review
  aggregation should be a separate follow-up because cross-project approval has
  a different safety boundary.

## Acceptance Cases

### Case 1: Parent Sees Subtask Review Entry

1. Start from a parent session.
2. Create a subtask that modifies or creates a file and leaves it pending Review.
3. Return to the parent session.
4. Expected: parent shows a subtask Review entry with the subtask title and count.
5. Expected: parent Review list does not include the child file directly.

### Case 2: Entry Opens Child Review

1. Click the subtask Review entry in the parent session.
2. Expected: UI switches to the subtask session.
3. Expected: Review panel shows the child session pending files.
4. Approve or reject one file.
5. Expected: the action updates the child Review state.

### Case 3: Refresh Recovery

1. Create a subtask with pending Review.
2. Reload the app.
3. Open the parent session.
4. Expected: the subtask Review entry is restored after child session metadata is loaded.

### Case 4: Delegate Is Not Aggregated Yet

1. Create a delegated session that produces pending Review.
2. Return to the source session.
3. Expected: no new source-session Review aggregation is required in this slice.
4. Open the delegated session directly.
5. Expected: direct Review behavior still works there.
