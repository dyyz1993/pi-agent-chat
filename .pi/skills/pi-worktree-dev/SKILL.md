---
name: pi-worktree-dev
description: Run pi-agent-chat paired worktree development with its local pi-coding-agent fork. Use when creating, starting, diagnosing, validating, or reporting app/fork worktrees, yalc updates, ports, env, or isolated issue development.
---

# Pi Worktree Development

Use the project scripts for paired app and fork worktrees. Do not guess ports or pairings.

## Startup And Discovery

- List stacks with `scripts/worktree-dev.sh list`.
- Read the stack manifest under `~/.pi/chat/worktrees/<worktree-id>/manifest.json`.
- Read registry env files under `~/.pi/chat/worktrees/registry/`.
- Start or repair existing stacks with `scripts/worktree-dev.sh <app-worktree> --with-agent-fork --agent-path <paired-fork> --agent-build`.
- Create new paired stacks with `scripts/worktree-create.sh <slug> --dev --start --with-agent-fork`.

## Fork Boundary

- Edit runtime source in the paired fork, not `node_modules` or generated `dist`.
- Build the fork before using it.
- Use `yalc push` only when the app imports package API/type changes or the linked package needs to update the consumer.
- Restart or reload already-running Agent sessions when fork runtime code changes.

## Reporting

Always report:

- app worktree path
- paired fork path
- API port
- Vite port
- `PI_CLI_PATH`
- `PI_CODING_AGENT_DIR`
- validation commands and results

## Safety

- Do not merge, delete worktrees, reset branches, or stage unrelated files without explicit user approval.
- Keep each issue or slice in its own coherent change set.
