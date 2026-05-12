# Project: pi-agent-chat

AI-powered coding agent with chat interface. Runs on macOS (Electrobun), web, and mobile browsers. Built with React 18 + TypeScript + Vite + Tailwind CSS + Zustand.

## Theme & Design System

### Token Location

All design tokens are defined as CSS custom properties in `src/mainview/index.css` under `:root` (light) and `html.dark` (dark).

### Token Categories

| Category   | Prefix                               | Example                                          |
| ---------- | ------------------------------------ | ------------------------------------------------ |
| Background | `--color-bg-*`                       | `--color-bg-primary`, `--color-bg-elevated`      |
| Text       | `--color-text-*`                     | `--color-text-primary`, `--color-text-secondary` |
| Border     | `--color-border-*`                   | `--color-border-primary`, `--color-border-focus` |
| Accent     | `--color-accent*`                    | `--color-accent`, `--color-accent-muted`         |
| Status     | `--color-success/warning/error/info` | `--color-success`                                |
| Safe Area  | `--safe-area-*`                      | `--safe-area-top`, `--safe-area-bottom`          |
| Spacing    | `--spacing-*`                        | `--spacing-sm`, `--spacing-lg`                   |
| Radius     | `--radius-*`                         | `--radius-sm`, `--radius-xl`                     |
| Shadow     | `--shadow-*`                         | `--shadow-sm`, `--shadow-lg`                     |
| Z-index    | `--z-*`                              | `--z-overlay`, `--z-modal`                       |
| Touch      | `--touch-target-min`                 | `44px` (Apple HIG minimum)                       |
| Transition | `--transition-*`                     | `--transition-fast`, `--transition-normal`       |

### Theme Store

`src/mainview/stores/use-theme-store.ts` — Manages `light`/`dark`/`system` mode, toggles `dark`/`light` class on `<html>`, persisted to localStorage key `pi-theme`.

### Tailwind Integration

`tailwind.config.js` extends spacing with `safe-top`, `safe-bottom`, `safe-left`, `safe-right` using CSS variables. Use `p-safe-top`, `m-safe-bottom` etc. in Tailwind classes.

## Responsive Design

### Breakpoints

| Name    | Width       | Store              |
| ------- | ----------- | ------------------ |
| mobile  | < 640px     | `use-layout-store` |
| tablet  | 640–1024px  | `use-layout-store` |
| desktop | 1024–1440px | `use-layout-store` |
| wide    | >= 1440px   | `use-layout-store` |

### Mobile Conventions

- Sidebars become 85% width overlays with `bg-black/50` backdrop
- Pin/collapse buttons hidden (`max-sm:hidden`)
- QuickActionToolbar only renders on mobile/tablet
- Tab close buttons always visible on mobile (no hover needed)
- Touch targets minimum 44px on all interactive elements
- `viewport-fit=cover` is set, so `env(safe-area-inset-*)` works

### Safe-Area Rules for Fullscreen Overlays

ALL `fixed inset-0` fullscreen components MUST:

1. Add `paddingTop: "calc(<base-padding>rem + env(safe-area-inset-top, 0px))"` on the header
2. Add `paddingBottom: "env(safe-area-inset-bottom, 0px)"` on the container or footer
3. Close buttons must be minimum 44px touch target (`p-2` + `w-4 h-4` icon = ~40px)
4. Every fullscreen page MUST have a visible close/exit button

Files that implement this pattern:

- `src/mainview/components/tab-bar/TabBar.tsx` — top safe-area
- `src/mainview/components/chat/ChatPanel.tsx` — bottom safe-area
- `src/mainview/components/bash-panel/BashPanel.tsx` — both
- `src/mainview/components/chat/preview/UrlCard.tsx` — fullscreen header
- `src/mainview/components/chat/preview/HtmlCard.tsx` — fullscreen header
- `src/mainview/components/chat/preview/PdfCard.tsx` — fullscreen header
- `src/mainview/components/chat/mermaid/MermaidFullscreen.tsx` — fullscreen header
- `src/mainview/components/project-picker/ProjectPickerDialog.tsx` — mobile view

## Project Structure

```
src/mainview/
  index.css              # Design tokens + global styles
  layouts/               # MainLayout, breakpoint logic
  components/
    tab-bar/             # Top project tabs
    chat/                # Chat UI, messages, previews
    left-sidebar/        # Session list
    right-sidebar/       # Status panel
    project-picker/      # Project selection dialog
    bash-panel/          # Terminal output
    settings/            # Settings modal
    diff/                # Diff viewer
    file-preview/        # File preview overlay
  stores/                # Zustand stores (28 files)
  hooks/                 # Custom hooks
  lib/                   # API client, i18n, logger
```

## Testing

- Unit: `vitest` + `@testing-library/react`
- E2E: `@playwright/test` with `workers: 3`, `headless: true`
- Config: `vitest.config.ts`, `playwright.config.ts`

## Code Style

- No `any` type, use `unknown` with narrowing
- No `/* eslint-disable */` comments — fix the root cause
- Use `createLogger` from `src/shared/lib/logger.ts` instead of `console.log`
- Function components only, hooks prefixed with `use`
- Tailwind utility classes for styling, design tokens for theming
