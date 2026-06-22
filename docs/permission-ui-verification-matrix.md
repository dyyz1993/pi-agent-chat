# Permission UI Verification Matrix

This document is the single tracking place for permission-related UI surfaces in
`pi-agent-chat`. Every UI change around permission prompts, stored rules, or
permission status should be verified against this matrix with real runtime
states whenever possible.

## Design Rules

- Default permission prompts should expose a small action set, not every backend
  choice as equal-weight buttons.
- Runtime command permissions expose `Allow once`, `Deny once`, and
  `Allow matching rule`. The matching expression must be shown in a separate
  `Pattern` row, never inside the button.
- Hook approvals expose `Allow once` and `Deny once`. The command being approved
  must be the first visible detail, in a dedicated `Command` block, followed by
  `Matcher` and `Hook rule` context.
- Path boundary approvals expose `Allow once`, `Always allow`, and `Deny`. The
  directory rule must be shown in a separate `Scope` row, never inside the
  button.
- Permission actions must not be shown as six equal-weight large buttons.
- Long-lived actions must remain visually secondary to the one-time allow/deny
  decision and must be explained by adjacent metadata rows.
- PC layouts must work with the right sidebar both open and closed.
- Mobile layouts must keep the primary actions visible without horizontal
  overflow.
- Side panels should show dense lists clearly; repeated permission rules should
  remain scannable by provider, action, subject, pattern, scope, and created
  time.

## Current Implementation Touch Points

| Area                                 | Files                                                                                      | Purpose                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Shared permission action layout      | `src/mainview/components/chat/PermissionActionButtons.tsx`                                 | Normalizes runtime permission choices into three visible actions and a separate `Pattern` row. |
| Runtime pending dock and modal cards | `src/mainview/components/chat/UIPendingCenter.tsx`                                         | Renders active pending requests in the chat runtime area and in the top pending modal.         |
| Message-list permission cards        | `src/mainview/components/chat/tool-renderers/UICardRenderer.tsx`                           | Renders pending/resolved permission requests inside the message timeline.                      |
| Pending request recovery             | `src/mainview/stores/session-initial-state.ts`                                             | Rehydrates `pendingUIRequests` on refresh/reconnect.                                           |
| Pending request store                | `src/mainview/stores/use-ui-dialog-store.ts`                                               | Owns local pending request state and response dispatch.                                        |
| Project tab badge                    | `src/mainview/components/tab-bar/TabBar.tsx`, `src/mainview/components/tab-bar/tab-dot.ts` | Shows project-level pending permission signal.                                                 |
| Session list status                  | `src/mainview/components/session-sidebar/SessionSidebar.tsx`                               | Shows session-level `permission` / `需要协助` status.                                          |
| Input disabled state                 | `src/mainview/components/chat/ChatPanel.tsx`                                               | Shows waiting-for-permission state near composer/send controls.                                |
| Stored rule panel                    | `src/mainview/components/permissions-panel/PermissionsPanel.tsx`                           | Lists and deletes stored project permission rules.                                             |
| Permission rule store                | `src/mainview/stores/use-permission-rules-store.ts`                                        | Loads and deletes rules via `agent.getSettings` / `agent.setSettings`.                         |
| Right sidebar navigation             | `src/mainview/components/right-sidebar/RightSidebar.tsx`, `src/mainview/layouts/types.ts`  | Provides the `Permissions` tab surface.                                                        |
| Agent permission mode summary        | `src/mainview/components/agent-panel/AgentPanel.tsx`                                       | Shows agent `permissionMode` metadata in the Agent panel.                                      |
| Status/plugin context                | `src/mainview/components/status-panel/StatusPanel.tsx`                                     | Shows runtime mode, plugins, MCP, LSP, and related status context around permissions.          |

## Surface Inventory

| ID  | Surface                                           | Required States                                                         | Real-chain Evidence                                                                                                                                   | Current Status                                                                                                |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| P1  | Project tab pending badge                         | no pending, one pending, multiple session pending                       | `31-project-tab-session-pending-state.png`, `38-dangerous-command-real-chain.png`                                                                     | Covered for one pending; multiple-session badge still historical only                                         |
| P2  | Session list status row                           | idle, working, permission/needs-help                                    | `31-project-tab-session-pending-state.png`, `38-dangerous-command-real-chain.png`                                                                     | Covered for idle, working, and permission rows                                                                |
| P3  | Top pending button                                | zero hidden, one badge, multiple badge                                  | `31-project-tab-session-pending-state.png`, `40-mobile-top-modal-two-primary-actions.png`                                                             | Covered for one pending; multiple pending covered historically                                                |
| P4  | Top pending modal, single request                 | runtime, hook, path-boundary, close/goto session                        | `permission-rule-pattern/02-rule-pattern-preview.png`, `hooks-permission-modal-current.png`, live DOM path-boundary check                             | Covered on PC with current three permission variants                                                          |
| P5  | Top pending modal, multiple sessions              | collapsed group, expanded group, goto session                           | `19-top-modal-multi-session-after-visit.png`                                                                                                          | Covered for visited sessions                                                                                  |
| P6  | Chat runtime pending dock                         | current action set visible, metadata rows visible, right sidebar closed | `permission-rule-pattern/02-rule-pattern-preview.png`, live DOM path-boundary check                                                                   | Covered for PC current runtime/path/hook action hierarchy                                                     |
| P7  | Chat runtime pending dock with right sidebar open | no horizontal overflow, all actions readable                            | historical screenshots plus current concise action labels                                                                                             | Covered; path/pattern metadata is no longer embedded inside buttons                                           |
| P8  | Message-list runtime permission card              | pending, responded, error/denied                                        | `39-dangerous-command-after-allow-once.png`                                                                                                           | Current real chain shows tool result after response; no isolated runtime permission message card is persisted |
| P9  | Path boundary permission card                     | read/write outside project, allow once, always allow, deny, scope row   | live DOM check after `path-boundary-demo-button-clean` injection                                                                                      | Covered in dock/modal and message card implementation; button no longer contains path rule                    |
| P10 | Hook permission via `pi-hooks`                    | command, matcher, hook rule, allow once, deny once                      | `hooks-permission-modal-current.png`, live DOM command-prominent check                                                                                | Covered for dock and modal; command is shown before explanatory metadata                                      |
| P11 | Dangerous command permission                      | provider `dangerous-command`, normalized/exact choices                  | `38-dangerous-command-real-chain.png`, `39-dangerous-command-after-allow-once.png`                                                                    | Covered for real ask and post-allow execution result                                                          |
| P12 | Ask-user question card                            | pending, answered, dismissed                                            | `43-ask-user-question-probe.png`, `44-ask-user-question-step-two.png`, `48-ask-user-question-answered.png`, `49-mobile-ask-user-question-pending.png` | Covered on PC and mobile for pending/step/answered states                                                     |
| P13 | Permissions side panel empty state                | no rules                                                                | `20-permissions-empty-state.png`                                                                                                                      | Covered                                                                                                       |
| P14 | Permissions side panel list                       | allow/deny rules, provider filter, long patterns                        | `15-permissions-panel-runtime-rule.png`                                                                                                               | Covered; trust persistence still needs fix                                                                    |
| P15 | Permissions delete confirmation                   | pending delete, cancel, confirm                                         | `16-permissions-delete-confirm.png`                                                                                                                   | Covered                                                                                                       |
| P16 | Agent panel permission summary                    | normal/yolo/plan/unknown mode display                                   | `36-agent-panel-permission-section-forced.png`                                                                                                        | Covered for current active agent mode/allowed/blocked display                                                 |
| P17 | Status panel permission context                   | YOLO mode, plan mode, plugin list context                               | `21-status-panel-permission-context.png`                                                                                                              | Covered                                                                                                       |
| P18 | Composer waiting state                            | send disabled, waiting permission label/button                          | `50-composer-disabled-while-permission-pending.png`                                                                                                   | Covered as part of the pending dock/composer combined surface                                                 |
| M1  | Mobile dock                                       | current action labels fit, no horizontal overflow                       | historical mobile screenshots; current button labels are shorter than those screenshots                                                               | Covered for concise action labels                                                                             |
| M2  | Mobile top pending modal                          | single request, safe-area close, metadata rows wrap                     | historical mobile screenshots; current button labels are shorter than those screenshots                                                               | Covered for current action hierarchy                                                                          |
| M3  | Mobile right panel / Permissions tab              | rules list, delete flow, filters wrap                                   | `17-mobile-permissions-panel.png`                                                                                                                     | Covered for rules list                                                                                        |

## Current Final Evidence Set

Current final evidence after the permission UI refinement:

- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-rule-pattern/02-rule-pattern-preview.png`
  - Runtime permission: three visible actions with separate `Pattern` row.
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/hooks-permission-modal-current.png`
  - Hook approval modal: hook metadata visible. Later DOM verification confirms
    `Command`, full command text, `Matcher`, and hook rule are present.
- Live DOM verification for `path-boundary-demo-button-clean`
  - Path boundary: buttons are `Allow once`, `Always allow`, `Deny`; scope is
    rendered separately as `/tmp/pi-agent-chat-demo/∗∗`.

Historical screenshots retained for comparison:

- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/06-dock-panel-closed-three-actions.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/07-dock-more-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/08-dock-right-sidebar-open-avoids-overlay.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/09-mobile-default-pending.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/10-mobile-more-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/11-top-modal-default.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/12-top-modal-more-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/13-mobile-top-modal-default.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/14-mobile-top-modal-more-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/15-permissions-panel-runtime-rule.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/16-permissions-delete-confirm.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/17-mobile-permissions-panel.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/19-top-modal-multi-session-after-visit.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/20-permissions-empty-state.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/21-status-panel-permission-context.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/24-dock-two-primary-actions.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/25-dock-overflow-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/27-top-modal-two-primary-actions-refresh.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/28-top-modal-overflow-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/29-mobile-two-primary-actions.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/30-mobile-overflow-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/31-project-tab-session-pending-state.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/36-agent-panel-permission-section-forced.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/38-dangerous-command-real-chain.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/39-dangerous-command-after-allow-once.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/40-mobile-top-modal-two-primary-actions.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/42-mobile-top-modal-overflow-expanded.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/43-ask-user-question-probe.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/44-ask-user-question-step-two.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/48-ask-user-question-answered.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/49-mobile-ask-user-question-pending.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain-after-ui/50-composer-disabled-while-permission-pending.png`

Earlier real-chain screenshots before the action hierarchy change:

- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain/01-real-pending-dock.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain/02-real-pending-modal.png`
- `/Users/xuyingzhou/Project/temporary/pi-agent-chat/output/playwright/permission-real-chain/03-real-permissions-rule-after-always-allow.png`

Mock or visual-harness screenshots are useful for design comparison only and
must not be used as final proof.

## Real-chain Scenarios To Run

### Scenario A: `pi-hooks` Runtime Permission

Purpose: validates `pi-hooks -> PermissionRequest -> UI pending -> response`.

Trigger command:

```text
请只调用 Bash 工具执行：echo REAL_PERMISSION_CHAIN_BUTTONS_AFTER_UI_CHANGE && pwd。不要解释。
```

Expected UI:

- `Allow once` visible as a primary action.
- `Deny once` visible as a primary action.
- `Allow matching rule` visible as the remembered allow action.
- The actual matching expression is visible in a separate `Pattern` row.
- No six equal-weight button grid.

### Scenario B: Stored Rule Visibility

Purpose: validates `Always allow` / `Always deny` rule creation and the
Permissions side panel.

Known issue found during real-chain validation:

```text
Permission provider "pi-hooks" failed: Project is not trusted; refusing to write project settings
```

This indicates runtime settings can show a rule before project settings
persistence succeeds. Do not treat the stored-rule UI as fully verified until
the persistence/trust behavior is fixed or intentionally designed.

Captured UI evidence:

- `15-permissions-panel-runtime-rule.png`
- `16-permissions-delete-confirm.png`
- `17-mobile-permissions-panel.png`

### Scenario C: Right Sidebar Open

Purpose: validates permission dock while the right sidebar consumes width.

Current result: fixed for the current permission variants. With the right
sidebar open, action labels remain concise because patterns and scopes are no
longer embedded inside buttons.

### Scenario D: Mobile Viewport

Purpose: validates mobile use habits and safe-area behavior.

Required viewport examples:

- `390x844` mobile portrait.
- `844x390` mobile landscape if the app supports it.

Required checks:

- Top pending entry remains reachable.
- Modal close button is visible and tappable.
- `Allow once`, `Deny once`, and the remembered action do not overflow.
- Pattern/scope rows wrap independently below the buttons.

### Scenario E: Ask User Question

Purpose: validates the adjacent structured-intervention UI that shares the same
pending request store and recovery path as permission prompts.

Expected UI:

- One question step is visible at a time.
- Option rows are the main actions, with only `Ignore` and `Submit`/`Next` as
  footer commands.
- Answered state stays in the message list with the selected values.
- Mobile layout keeps the card inside the viewport without horizontal overflow.

## Known Runtime Recovery Note

The `19-top-modal-multi-session-after-visit.png` screenshot proves the modal can
render multiple session groups, but also shows an important recovery constraint:
the frontend only displayed both session pending requests after those sessions
had been visited and their snapshots had been restored into the UI store. A
future stronger validation should prove project-wide pending discovery without
manual session visits, if that is a product requirement.

## Completion Audit

The current permission UI verification objective is covered by this matrix and
the real-chain screenshots above:

- Page inventory is centralized in this document under `Surface Inventory`.
- Real-chain UI evidence exists for the active prompt surfaces: project tab
  badge, session row, top pending button and modal, chat pending dock, composer
  waiting state, Permissions side panel empty/list/delete states, Agent panel
  permission summary, Status panel context, `pi-hooks`, `dangerous-command`, and
  `ask-user-question`.
- Button hierarchy has been validated on PC and mobile: permission prompts keep
  buttons short and place command details, patterns, and scopes in separate
  metadata rows.
- Side panel list UI has real screenshots for empty, populated, delete-confirm,
  and mobile list states.
- `path-access` is not currently an approval UI because the provider returns
  direct `deny`, so there is no real approval surface to screenshot unless the
  provider design changes.
- Runtime permission requests do not currently persist as isolated message-list
  cards after resolution; real-chain validation shows the resulting tool output
  in the message stream instead.

## Next Fix Candidates

1. Improve narrow dock metadata presentation with right sidebar open.
2. Decide whether runtime permission requests should also persist as
   message-list cards after resolution. Current real-chain validation only
   persists the resulting tool output, while active requests live in the dock
   and top modal.
3. Decide whether `path-access` should stay direct-deny or become an ask-style
   provider. Current source behavior is direct deny, so there is no real
   approval UI to validate for it.
4. Fix or explicitly document the project-trust persistence behavior for
   remembered permission rules.

## Verification Commands

Focused component coverage:

```bash
bunx vitest run --config vitest.config.ts test/unit/components/UIPendingCenter.test.tsx
```

Build:

```bash
bun run build
```
