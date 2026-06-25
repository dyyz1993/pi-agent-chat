# Popover and Menu Guidelines

This project has two overlay families:

- Anchored popovers rendered through a portal for menus that must stay attached to a trigger across panel boundaries, scroll containers, and viewport edges.
- Local popovers positioned inside a nearby `relative` container when the trigger and menu share the same unclipped layout context.

## Default Primitive

Use `src/mainview/components/primitives/AnchoredPopover.tsx` for dropdowns, select menus, command menus, and any floating panel that can cross a sidebar, scroll pane, modal, or right panel boundary.

`AnchoredPopover` owns:

- fixed portal positioning against an `anchorRef`
- viewport clamping
- max-height clamping
- resize and scroll repositioning
- outside-click close behavior that keeps the trigger and popover as one interaction group
- Escape close behavior
- `z-popover`

Use it like this:

```tsx
<AnchoredPopover
  anchorRef={buttonRef}
  open={open}
  onClose={() => setOpen(false)}
  placement="bottom"
  align="start"
  minWidth={224}
  maxHeight={256}
>
  <MenuContent />
</AnchoredPopover>
```

## When Local Positioning Is Allowed

Local `absolute bottom-full` / `top-full` positioning is acceptable only when all of these are true:

- The popover is visually scoped to a compact control group.
- The trigger and panel live in the same `relative` wrapper.
- No ancestor can clip the menu unexpectedly, or clipping is intentional.
- The menu does not need to stay aligned while the page or panel scrolls.
- The menu width is intentionally tied to the local container.

Examples that can remain local: small left-sidebar bottom controls, compact theme menus, and chat input toolbars that are deliberately bounded by the input area.

## Anti-Patterns

Avoid these patterns:

- Wrapping a `fixed` popover inside an `absolute` parent and expecting the parent `top/left` to position it.
- Manually calling `getBoundingClientRect()` in JSX render.
- Hard-coding viewport coordinates like `top: 80, left: 48` for reusable menus.
- Giving each menu its own outside-click and Escape implementation when `AnchoredPopover` can own the interaction.
- Using `z-modal` for dropdowns. Menus should use `z-popover`; dialogs and fullscreen overlays use `z-modal` or above.

## Current Component Map

| Surface                     | Component                            | Pattern           | Notes                                                                                 |
| --------------------------- | ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------- |
| Git branch selector         | `GitPanel` + `GitBranchSelector`     | `AnchoredPopover` | Portal anchored to branch button.                                                     |
| Model picker                | `ModelPickerButton`                  | `AnchoredPopover` | Shared by sidebar, settings, tier config.                                             |
| Explorer/Git context menus  | `ContextMenu`                        | fixed by pointer  | Pointer menus are not anchor-triggered, but must clamp to viewport if expanded later. |
| Left sidebar bottom menus   | `SidebarBottomControls`, `ThemeMenu` | local absolute    | Acceptable while bounded by the bottom control group.                                 |
| Notification center         | `NotificationCenter`                 | local absolute    | Header-scoped; consider `AnchoredPopover` if it appears in clipped panels.            |
| Command/quick action popups | `CommandPopup`, `QuickActionToolbar` | local absolute    | Input-area scoped and intentionally bounded.                                          |

## Checklist for UI Changes

When adding or changing a popover/menu:

- Choose `AnchoredPopover` unless the local-positioning rules above clearly apply.
- Keep trigger and popover in one outside-click group.
- Support Escape to close.
- Clamp to viewport and set a bounded `maxHeight`.
- Use design tokens: `bg-bg-elevated` or `bg-surface-dim`, `border-border-secondary`, `shadow-xl`/`shadow-floating`, and `z-popover`.
- Verify at narrow mobile width, desktop width, and inside the relevant sidebar/panel.
- Update this document and the component map if a new overlay pattern is introduced.
