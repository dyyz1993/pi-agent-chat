# Button and Icon Density Guidelines

This project has shared button primitives, but many panels still hand-roll icon buttons with `p-1`, `p-1.5`, `h-7 w-7`, or `h-11 w-11`. That makes dense toolbars feel inconsistent and can make desktop close buttons look visually oversized.

Use this document when adding or changing toolbar buttons, close buttons, preview-card actions, and dense panel controls.

## Current Primitives

| Primitive    | File                                                | Current sizes                    | Use for                                      |
| ------------ | --------------------------------------------------- | -------------------------------- | -------------------------------------------- |
| `Button`     | `src/mainview/components/primitives/Button.tsx`     | `sm` = min 32px, `md` = min 44px | Text buttons and icon+text command buttons   |
| `IconButton` | `src/mainview/components/primitives/IconButton.tsx` | `sm` = 32px, `md` = 44px         | Icon-only actions with accessible labels     |
| `CopyAction` | `src/mainview/components/primitives/CopyAction.tsx` | `xs` = 32px, `sm` = 36px         | Copy buttons with tooltip and feedback state |

Prefer these primitives over raw `<button>` for reusable actions. Raw buttons are acceptable only inside highly local controls when the primitive cannot express the density yet; if that pattern repeats, extend the primitive first.

## Density Scale

| Density         | Visual box | Icon size | Typical classes today             | Use for                                                                                   |
| --------------- | ---------- | --------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| Dense inline    | 24-28px    | 12-14px   | `h-7 w-7`, `p-1`                  | Preview-card action rows, diff view toggles, tiny row actions inside compact lists        |
| Toolbar compact | 32px       | 14-16px   | `IconButton size="sm"`            | Desktop panel headers, sidebar headers, secondary toolbar actions                         |
| Toolbar regular | 36-40px    | 16px      | `CopyAction size="sm"`, overrides | Larger desktop/fullscreen headers when there is enough vertical rhythm                    |
| Touch / mobile  | 44px       | 16-20px   | `IconButton size="md"`            | Mobile header close buttons, standalone floating actions, controls in touch-heavy regions |

Important distinction:

- **Visual size** controls perceived density.
- **Touch target** controls usability. Mobile and touch-first surfaces need at least 44px. Desktop dense toolbars should not visually default to 44px unless the row is designed around that height.

## Header and Toolbar Rules

- Desktop/panel toolbar icon buttons should default to `IconButton size="sm"` or an explicit 28-32px compact action.
- Mobile fullscreen and touch-first close buttons should use a 44px target.
- Do not use `IconButton size="md"` just because the action is important. Use it when the surrounding header is mobile/touch-sized or when the layout intentionally reserves 44px.
- When a fullscreen surface has responsive density, prefer a compact desktop visual size and a larger mobile hit target. Do not let a 44px close button dominate a 36-44px desktop header.
- Header gaps should usually be `gap-1` for dense action groups and `gap-2` for mixed title/action headers.
- Header horizontal padding should usually be `px-3` in dense panels, `px-4`/`px-5` in full-window surfaces, and should not be replaced by oversized buttons to create spacing.

## Close Button Rules

- Close buttons must have an accessible label.
- Use an `X` icon from `lucide-react`.
- For full-window mobile surfaces, keep a 44px target.
- For desktop chat-scoped previews, panel headers, and card-level overlays, prefer 32px visual close buttons unless the header itself is at least 56px tall.
- Do not place a close button inside content flow where it can resize or push title text; keep it in the header action group or an absolute overlay corner.

## Current Component Map

| Surface / component                       | Current pattern                                            | Notes                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ContentSurface` / `SurfaceHeader`        | Compact close by default; `closeButtonSize="touch"` opt-in | Shared content browser chrome for new preview/workspace surfaces.                          |
| `FullscreenOverlay`                       | Compact close by default; `closeButtonSize="touch"` opt-in | Chat-scoped overlays should not default to a visually oversized close button.              |
| `ImageViewerOverlay`                      | Uses `ContentSurface` with touch close                     | Fullscreen media preview keeps body portal behavior while sharing surface header chrome.   |
| `ModalDialog`                             | `IconButton size="md"` close                               | Acceptable for touch-sized modal headers; consider responsive density if used in desktops. |
| `SettingsPanel`                           | `IconButton size="md"` close                               | Full-window surface; 44px is acceptable on mobile, may be visually heavy on desktop.       |
| `SshProjectDialog`                        | `IconButton size="md"` close                               | Full-window workflow; same responsive-density consideration as settings.                   |
| `ProjectPickerDialog`                     | `IconButton size="md"` close                               | Mobile fullscreen close uses 44px; desktop may need compact header treatment.              |
| `chat/preview/CardHeader`                 | `IconButton size="sm"` + `h-7 w-7`                         | Dense card action pattern; acceptable but should be formalized if repeated.                |
| `DiffOverlay`                             | Dense 28px icon toggles with accent selected state         | Dense inline toggle pattern; should become a segmented/icon primitive if it grows.         |
| `ChangeReviewPanel`, `HooksPanel`, panels | Raw `p-1` / `p-1.5` icon buttons                           | Repeated dense action pattern; migrate gradually to shared compact icon primitives.        |
| `FileAttachment`, `QuickActionToolbar`    | Raw `p-1.5` icon buttons                                   | Input-adjacent controls; check touch target on mobile before compacting further.           |

## Migration Checklist

When touching a button-heavy component:

- Use `Button`, `IconButton`, or `CopyAction` first.
- Choose density from the table above before adding classes.
- Avoid one-off `p-1` / `p-1.5` buttons unless the component is genuinely local and unlikely to repeat.
- Keep labels/tooltips on icon-only actions.
- Verify at mobile width and desktop width, especially for close buttons in headers.
- Update this document and `AGENTS.md` if a new button density or reusable button pattern is introduced.
