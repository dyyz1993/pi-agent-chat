---
name: pi-agent-chat-design
description: Use this skill to generate well-branded interfaces for pi-agent-chat. Contains colors, type, fonts, assets, and UI kit for prototyping desktop-app UIs.
user-invocable: true
---

# pi-agent-chat Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts, copy assets out and create static HTML files. If working on production code, read the rules here to become an expert in designing with this brand.

## Quick map

- `README.md` — brand context, content fundamentals, visual foundations (read first)
- `css.json` — structured token understanding source
- `colors_and_type.css` — drop-in CSS variables for colors, type, radius, shadow, spacing (link it, do not read it to understand tokens when css.json exists)
- `components/index.json` — component index + cross-component patterns
- `uikit-plan.json` — component whitelist and UIKit planner output
- `library-consumption.json` — recommended downstream read order
- `preview/` — small HTML cards illustrating foundations and components (first source for DOM/CSS fidelity)
- `ui_kits/desktop-app/` — full click-thru recreation
- `components.css` — aggregated component CSS

## Essentials at a glance

- Brand primary `#246df3` (blue-500). Dark-first developer tool aesthetic — navy-black backgrounds (`#0b111a`) with cool blue/violet accent. Light accent `#246df3`, dark accent `#746cff`.
- Radius is **4 / 6 / 8 / 10** — sharp, compact. Pills (`9999px`) reserved for status tags only.
- Density-first: 28px input height, 28/32/40px button heights, 4px base spacing grid. High information density.
- Type: **Inter** for all UI (display/heading/body), **JetBrains Mono** for code and token counts. Display 56px, body 14px, caption 12px.
- Voice: zh-first developer tool UI. Professional, neutral, zero emoji. English labels for UI chrome ("Chat", "Session", "Tool Execution", "Memory", "Settings", "Model").
- Shadow: 5 layers, whisper-quiet at rest (`shadow-2: 0 2px 4px rgba(.08)` for cards). Dark mode doubles opacity. No decorative shadow.
- Semantic color coding for agent concepts: violet `#8b5cf6` (agent), cyan `#06b6d4` (tool), teal `#14b8a6` (memory), orange `#f97316` (notify) — used in status tags and icon headers.
- Dark mode is primary: `--bg #0b111a`, `--surface #131b27`, `--border #1e2a3a`. Light mode uses `--bg #edf1f6`, `--surface #ffffff`.

## Components

| Slug    | Name    | Key Insight                                                              |
| ------- | ------- | ------------------------------------------------------------------------ |
| button  | Button  | Compact heights (28/32/40px), blue accent primary, ghost/subtle variants |
| card    | Card    | Subtle border + shadow, tool execution variant with colored icon header  |
| input   | Input   | Chat-style multiline with focus ring, 28px compact height                |
| sidebar | Sidebar | Icon-only left rail with active indicator, resizable session panel       |
| tag     | Tag     | Semantic color-coded status tags for tool execution states               |
| modal   | Modal   | Dark overlay card with segmented control and iOS-style toggles           |
