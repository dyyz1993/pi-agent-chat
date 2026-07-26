---
name: pi-rule-authoring
description: Create, inspect, or refine Pi rules. Use when writing .pi/rules or global rules, deciding whether behavior should be a rule or skill, tuning globs/severity, or making project guardrails enforceable.
---

# Pi Rule Authoring

Rules are guardrails. Skills are procedural guides. Use a rule when the behavior should be remembered and applied automatically across matching work.

## Rule Shape

- Put project rules in `.pi/rules`.
- Use short, enforceable language.
- Use `severity: critical` for destructive boundaries, secret handling, source-of-truth constraints, or user-confirmation requirements.
- Use `severity: high` for workflow requirements that prevent regressions.
- Add `globs` when the rule should only trigger for specific files.
- Omit `globs` only for rules that should apply to all work in the project.
- Use `skipInPrompt` only when a rule should be machine-visible but not prompt-visible.

## Good Rule Test

A good rule answers:

- What action is forbidden or required?
- When does it apply?
- What should the agent do instead?
- What validation or confirmation proves compliance?

## Avoid

- Vague values like "be careful" without concrete behavior.
- Duplicating long architecture docs into rules.
- Hiding product requirements in a rule when the UI, tests, or docs also need to change.
