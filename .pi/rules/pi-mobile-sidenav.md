---
description: Preserve mobile and tablet chat SideNav behavior while fixing performance.
severity: critical
globs:
  - "src/mainview/components/chat/**"
  - "src/mainview/stores/use-chat-store.ts"
  - "src/mainview/lib/message-mapper.ts"
---

# Pi Mobile SideNav

- Chat `SideNav` must render on mobile and tablet.
- Do not hide, remove, breakpoint-gate, disable, replace with a placeholder, or materially degrade mobile/tablet `SideNav` as a performance shortcut.
- When `SideNav` is slow or janky, fix performance through stable ids, bounded windows, virtualization, memoization, cache, throttled or RAF scroll sync, cheaper icon rendering, and scroll-anchor correctness.
- Message history loading must keep the right-side icon rail in sync with the same effective message window as the message list.
