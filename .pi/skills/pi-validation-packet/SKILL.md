---
name: pi-validation-packet
description: Produce validation packets for Pi issues, PR-style change sets, UI changes, runtime fixes, and delegated work. Use when summarizing tests, acceptance cases, evidence, edge cases, or merge readiness.
---

# Pi Validation Packet

Every issue-sized or PR-style change set needs a validation packet before merge readiness.

## Required Sections

```md
## Automated Validation

- Command:
- Result:
- Evidence:

## Manual Acceptance

- Setup:
- Steps:
- Expected:
- Evidence:
- Status: pending | passed | failed | waived

## Negative And Edge Cases

- Case:
- Result:

## Risk And Gaps

- Untested:
- Known risk:
- Follow-up:
```

## Rules

- Do not call UI acceptance passed unless the UI was actually exercised or the user explicitly waived it.
- For interaction work, validate core/RPC first, then UI automation.
- For mobile or responsive behavior, include at least one mobile viewport case.
- For merge-sensitive work, list unrelated dirty files and confirm they were not staged.
- Evidence can be command output, screenshot, browser observation, log line, or user-confirmed result.
