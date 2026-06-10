# Notification Interaction Manual

This manual defines how status, notifications, retry state, and permission prompts should appear in the chat UI. The goal is to keep the user's path obvious: actionable work appears where the user can act, durable notifications live behind the bell, and short local feedback does not compete with either.

## Interaction Surfaces

| Surface | Component / Store | What It Is For | User Action | Persistence |
| --- | --- | --- | --- | --- |
| Notification bell | `NotificationCenter`, `useNotificationStore`, `notificationGateway` | Durable app events: agent notify, send failures, retry result, permission reminders, recoverable session problems | Open bell, inspect, dismiss, jump to related request when available | Stored in memory until dismissed; info items auto-dismiss after 5s |
| PWA system notification | `pwa-channel.ts` | Important events when the app is hidden, plus selected high-priority events while visible | Click browser/system notification to focus app | Browser-managed |
| Retry banner | `RetryNotification`, `useRetryStore` | Active auto-retry countdown for the current session | Observe countdown; retry lifecycle is automatic | Only while retry is active; stale cleanup after timeout |
| Runtime pending request card | `ProjectRuntimePendingRequests`, `UIPendingCenter`, `useUIDialogStore` | Actionable UI requests from the agent: confirm, select, input, editor, hooks permission | Respond directly in the chat action stack or open pending center | Until answered or dismissed |
| Pending center icon | `UIPendingCenter` | Cross-session queue of pending actionable requests in the current project | Open modal, jump to target session, respond | Until all pending requests are resolved |
| Message notify card | `NotifyCard` in `UICardRenderer` | Historical `ctx.ui.notify` events inside the message stream | Read as part of conversation history | Message/history scoped |
| Local ephemeral feedback | Local component state, or a dedicated primitive when needed | Tiny local confirmations such as "session created" in the sidebar | No action beyond observing | Very short-lived |
| Toast primitive | `ToastViewport` | Shared primitive only; not a global notification surface by default | Depends on owner component | Owner-controlled |

## Decision Rules

Use the notification bell for durable, app-level events that the user may need to find later. Examples: failed send, failed follow-up, agent notify, retry failed, stale session recovery guidance.

Use runtime pending request cards for anything that blocks the agent and needs a user response. Examples: hooks permission approval, `confirm`, `select`, `input`, `editor`. These should be close to the input path so the next click is obvious.

Use the retry banner only for an active retry countdown. It is a live state indicator, not a generic notification. Retry success or failure can also emit a bell notification if the event should remain discoverable.

Use message notify cards only for agent-authored notification events that belong to the transcript. They should not replace the bell for app-level errors, and they should not require immediate action.

Use PWA notifications for events that matter while the app is hidden or require strong attention. Visible-app PWA notifications should be limited to high-value events such as permission requests, session completion/error, and retry failure.

Use local ephemeral feedback only for small UI-local actions whose result is obvious and not worth preserving, such as a sidebar create-session confirmation.

Do not mount a global inline toast that mirrors `useNotificationStore`. The bell is the canonical in-app notification surface. Mirroring unread notifications as horizontal banners causes duplicate UI and steals attention from the chat path.

## Current Intentional Exceptions

`RetryNotification` is allowed to float because it represents an active countdown and progress state. It should not show ordinary notification text.

`ProjectRuntimePendingRequests` is allowed in the chat action stack because it is actionable and time-sensitive. It should stay above the input region, not behind the bell.

`ToastViewport` remains available as a primitive for tightly scoped local feedback, but using it globally requires a new product decision and a regression test proving it does not duplicate `NotificationCenter`.

`LeftSidebar` uses local fixed feedback for session creation. This is a local success/error affordance, not part of the global notification queue.

## Anti-Patterns

- Do not show the same event in both a horizontal toast and the notification bell.
- Do not put permission approvals behind the notification bell only; the user must be able to answer from the main action path.
- Do not use `RetryNotification` for non-retry errors.
- Do not emit PWA notifications for every info event while the app is visible.
- Do not make transient internal recovery messages user-visible unless the user has to do something.

## Implementation Checklist

When adding a new user-facing event:

1. Decide whether the event is actionable, durable, live state, transcript history, or local feedback.
2. Pick exactly one primary surface from the table above.
3. If the event is actionable, prefer `useUIDialogStore` and render it through the pending request flow.
4. If the event is durable but not blocking, emit through `notificationGateway` or `useNotificationStore`.
5. If the event is live retry state, use `useRetryStore`.
6. If the event belongs to transcript history, render it as a message card.
7. Add a regression test when changing global notification placement or adding a new surface.

## Known Code Paths

- `src/mainview/components/chat/NotificationCenter.tsx`
- `src/mainview/stores/use-notification-store.ts`
- `src/mainview/lib/notification-gateway.ts`
- `src/mainview/lib/channels/in-app-channel.ts`
- `src/mainview/lib/channels/pwa-channel.ts`
- `src/mainview/components/chat/RetryNotification.tsx`
- `src/mainview/stores/use-retry-store.ts`
- `src/mainview/components/chat/UIPendingCenter.tsx`
- `src/mainview/stores/use-ui-dialog-store.ts`
- `src/mainview/components/chat/tool-renderers/UICardRenderer.tsx`
- `src/mainview/components/primitives/ToastViewport.tsx`
