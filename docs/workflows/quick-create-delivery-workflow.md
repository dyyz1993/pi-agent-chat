# Quick Create Delivery Workflow

Quick Create creates a project shell from a short user requirement. The first
development session must treat that shell as a change set with a delivery gate,
not as an informal demo.

## Created Project Artifacts

`project.confirmQuickCreate` writes two files into every new project:

- `README.md`: user-facing project summary, goal, suggested stack, steps, and
  a link to the delivery protocol.
- `QUICK_CREATE_DELIVERY.md`: the first-session delivery contract that
  Developer and QA agents must follow.

## Developer Rules

- Read `QUICK_CREATE_DELIVERY.md` before implementing.
- Keep dependency recovery non-destructive by default. If install fails or
  times out, inspect the error and retry with a safe command such as
  `npm install --no-fund --no-audit`.
- Do not use recursive destructive cleanup such as `rm -rf node_modules`,
  lockfile deletion, or project file deletion as the first recovery step.
- Ask the user before deleting generated files, dependency directories,
  lockfiles, git history, or anything outside the project.
- Do not declare the project ready until a validation packet is complete.

## Validation Packet

Every quick-create delivery must include:

- Automated checks: exact install, test, typecheck, and build commands with
  pass/fail results.
- Manual acceptance checks: setup, steps, expected result, evidence, and status.
- Browser/UI checks for web projects: open URL, happy path, negative or edge
  cases, refresh or persistence behavior when relevant, and mobile viewport
  behavior.
- Safety evidence: permission prompts, denied destructive commands, and why the
  final commands were safe.
- Residual risk: what was not tested and why.

## QA Role

Developer self-report is not enough for user-facing delivery. A QA pass should
independently verify the validation packet where practical:

1. Run the automated commands again or inspect fresh evidence.
2. Open the preview URL and exercise core workflows.
3. Verify at least one negative or edge case.
4. Check a mobile viewport for web UI work.
5. Mark the delivery as ready only when failures are fixed or explicitly waived.

## Preview URL Language

When a quick-created web project starts a local server, the response must call
it a temporary preview URL. The port is not a product feature and is not the
main `pi-agent-chat` frontend port.
