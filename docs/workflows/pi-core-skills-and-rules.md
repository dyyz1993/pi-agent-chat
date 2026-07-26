# Pi Core Skills And Rules

This project keeps Pi-specific operational knowledge in `.pi/skills` and `.pi/rules` so local agents can load it while working in this repository.

## Skills

- `pi-goal-writing`: create and show Xcode-style target drafts before adding them as goals.
- `pi-hooks-authoring`: design hooks with deterministic behavior, clear failure modes, and RPC-first validation.
- `pi-agent-authoring`: create and review Pi agent definitions without unsupported frontmatter or accidental tool restrictions.
- `pi-rule-authoring`: write concise project guardrails with correct severity and matching scope.
- `pi-validation-packet`: produce merge-ready evidence for automated tests, manual acceptance, edge cases, and residual risk.
- `pi-worktree-dev`: operate paired app/fork worktrees, ports, yalc, and validation without guessing state.
- `pi-session-context`: protect unified history and compaction semantics.
- `pi-asset-preview`: keep file preview and visual input work behind AssetStore/FileResolver boundaries.

## Rules

- `pi-source-boundaries`: edit fork source, not generated package output; keep dirty worktree state separate.
- `pi-validation-order`: validate core/RPC paths before UI automation and produce evidence.
- `pi-git-safety`: block accidental destructive git, merge, publish, deletion, and unrelated commits.
- `pi-mobile-sidenav`: mobile/tablet chat SideNav is required; performance fixes must preserve it.
- `pi-session-context`: context and compaction changes must share effective-history semantics.
- `pi-remote-resource-sync`: SSH resource sync must not leak local paths or secrets.
- `pi-project-state-paths`: project-private state belongs in project-scoped agent state.
- `pi-ui-acceptance`: UI changes need executable acceptance coverage.

## Built-In Status

These resources are project-level defaults today. They are loaded from `.pi` for this repository, but they are not yet runtime-packaged, non-removable built-ins. To make them non-removable, migrate the same content into the lower-level runtime resource packaging layer and add parser/loader tests there.
