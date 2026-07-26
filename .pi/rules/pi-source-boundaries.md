---
description: Preserve pi-agent-chat and pi-coding-agent source boundaries.
severity: critical
---

# Pi Source Boundaries

- Edit `@dyyz1993/pi-coding-agent` source only in `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src` or its `extensions` directory.
- Do not manually edit `node_modules/@dyyz1993/pi-coding-agent/dist` or `pi-agent-chat/.yalc/@dyyz1993/pi-coding-agent` as the source of truth.
- After fork source changes, build the fork and push through yalc when the app consumes the package output.
- Treat unrelated dirty files as user-owned. Do not revert, stage, or mix them into a change set without explicit approval.
