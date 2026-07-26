---
name: pi-goal-writing
description: Create, review, and refine Pi goal drafts or Xcode-style targets. Use when the user asks to create/show/add a goal, target, objective, acceptance plan, or one-click goal card before committing it as an active goal.
---

# Pi Goal Writing

Use this skill when goal text must become a user-confirmable target, not an immediately active goal.

## Core Contract

- Create a draft first, then let the user confirm or click Add before it becomes an active goal.
- Keep the draft visible and inspectable. Do not hide the target behind a one-shot chat message.
- Preserve the user's wording, but normalize it into a target-shaped structure.
- If the request mentions Xcode-style targets, model the goal as a buildable target with scope, phases, dependencies, and validation.

## Target Draft Shape

Use this structure unless the user asks for another format:

```md
# Target: <short name>

## Target Manifest

- Target Name: <name>
- Target Type: Feature | Fix | Investigation | Workflow | Validation
- Project: <repo/app/module>
- Entry: <primary file, UI entry, command, or unknown>
- Scheme: Understand -> Implement -> Validate -> Deliver

## Scope

- <included work>

## Build Phases

1. Understand the current implementation and constraints.
2. Implement the smallest coherent slice.
3. Validate through the required core/RPC path.
4. Validate through UI or user-facing workflows when relevant.
5. Summarize evidence, risks, and remaining decisions.

## Acceptance

- <observable outcome>

## Risks

- <risk or "None identified yet">
```

## Creation Flow

1. Read local project rules before inventing a target shape.
2. Generate the target draft from the user's latest request and relevant project context.
3. Show the target draft to the user with actions for edit, regenerate, and add.
4. Only create the real active goal after an explicit add/confirm action.
5. If the draft is too broad, split it into small targets and ask the user which one should be active first.

## Quality Bar

- The target must say what is tracked, not only what to build.
- The target must include validation, not just implementation.
- The target must call out merge, commit, deletion, or migration risk when applicable.
- The draft must be short enough for the user to scan before accepting.
