---
description: Require low-risk Pi validation order and evidence.
severity: high
---

# Pi Validation Order

- For interaction, permission, hook, RPC, or runtime work, validate the core/RPC path before UI automation.
- For UI behavior, validate the user-facing workflow after the core path is proven.
- For issue-sized work, produce a validation packet with automated tests, manual acceptance steps, evidence, negative/edge cases, and remaining risk.
- Do not mark manual UI acceptance as passed unless it was actually exercised or explicitly waived by the user.
