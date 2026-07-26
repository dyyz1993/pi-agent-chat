---
description: Require real UI acceptance coverage for user-facing Pi changes.
severity: high
globs:
  - "src/mainview/**"
  - "test/**/components/**"
  - "test/regression/**"
---

# Pi UI Acceptance

- User-facing UI changes need executable manual acceptance cases with setup, steps, expected result, evidence, and status.
- Browser automation or screenshots can support evidence, but do not replace user acceptance unless the user authorizes it.
- Check desktop and mobile or tablet interaction differences when the surface is responsive.
- Avoid adding visible in-app instructional text that explains implementation details, keyboard shortcuts, visual design, or internal behavior unless the product explicitly requires it.
