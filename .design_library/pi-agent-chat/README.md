# Pi Agent Chat Design System

Pi Agent Chat 是一款面向开发者的 AI 对话桌面工具（SaaS Desktop）。这套设计系统从产品实际界面中提取并重构，旨在为后续扩展、高保真原型和前端落地提供统一的视觉与交互规范。

## Source

- **Product type:** SaaS Desktop (developer tooling, dark-first)
- **Design tokens:** AI-generated from brand analysis, verified against product personality
- **Language:** zh (Chinese-first UI copy)

## What this design system covers

- **Foundations** -- brand color scales (blue primary / violet accent), Inter + JetBrains Mono type ramp, 4px spacing grid, 4/6/8/10px radius ladder, 5-level shadow elevation
- **Components** -- 6 documented components: Button, Card, Input, Sidebar, Tag, Modal
- **Preview pages** -- standalone HTML specimen cards for each component in `preview/`

## CONTENT FUNDAMENTALS

### Voice & tone

Pi Agent Chat 的界面语言风格极为克制、偏技术化。所有文案均使用英文术语，面向开发者心智模型：会话称为 "Session"，执行记录称为 "Tool Execution"，token 计量直称 "Input Token / Output Token"，分支操作是 "Fork"，回退是 "Rollback"。整体语气冷静、客观，零营销感，零 emoji 装饰。交互反馈依靠颜色与状态标签完成，而非冗余文案。这种风格与产品定位一致 -- 这是一个供工程师日常使用的工具，不是面向终端用户的消费品。

### Concrete copy examples (from product analysis)

- Navigation item: **"Chat"** -- 主入口，而非 "消息" 或 "对话"
- Entity name: **"Session"** -- 会话实体
- Action label: **"Fork"** -- 分叉当前会话分支
- Action label: **"Rollback"** -- 回退到历史节点
- Status label: **"Thinking"** -- AI 推理中状态
- Entity label: **"SubAgent"** -- 子代理
- Feature label: **"Bookmark"** -- 书签收藏
- Metric label: **"Input Token" / "Output Token"** -- token 用量统计

### When generating copy

- Use English technical terms for feature/entity names (Session, Fork, Rollback, SubAgent)
- Keep status labels concise and verb-free: "Thinking", "done", "error"
- Avoid descriptive helper text -- trust icon + color to convey meaning
- Metric labels use "Token" not "tokens" or "Tokens"

## VISUAL FOUNDATIONS

### Color

The brand's visual identity is anchored in a deep navy-black dark-mode environment, which is the product's primary operating context. The **brand primary** is `#246df3` (`--pi-blue-500`), a saturated mid-blue that reads as technical, trustworthy, and energetic without crossing into playfulness. In dark mode this inverts to `#4685ff`, a brighter blue that ensures adequate contrast on `#0b111a` backgrounds.

The **accent** sits in the violet family: `#746cff` (`--pi-violet-400`), used for hover states and secondary emphasis. It provides enough chromatic distance from primary to serve as a distinct signal while maintaining the cool-tone palette coherence. The hover alias `--accent-hover` maps to `#8e7eff` in dark mode, a lighter violet that feels like a natural lift.

Semantic colors follow conventional engineering-tool mappings. Success is a green at `#059669` (`--pi-success-600`), warning a warm amber at `#d97706` (`--pi-warning-600`), and error a decisive red at `#dc2626` (`--pi-error-600`). Each has a full 9-stop scale from 50 to 900, providing fine-grained control for fills, borders, and text. An additional set of domain-specific semantic tokens exists for agent tool states: `--pi-agent-600` (violet, for agent actions), `--pi-tool-600` (cyan, for tool execution), `--pi-memory-600` (teal, for memory operations), and `--pi-notify-600` (orange, for notifications).

The **neutral scale** runs 9 stops from `#edf1f6` to `#111827`, a cool-toned gray that avoids warm undertones. In dark mode the foreground shifts to `#e2e8f0` against a `#0b111a` base, with surface layers at `#131b27` and `#1c2737` creating subtle depth without obvious borders. The overall color philosophy: cool, dense, low-contrast hierarchy. Nothing pops unless it needs to.

### Typography

The type system is built on **Inter** for all Latin/heading/body text, loaded via Google Fonts with weights 400, 500, 600, 700. Inter provides excellent readability at small sizes and pairs well with monospace in a developer-tool context. For code, token labels, and technical output, **JetBrains Mono** (weights 400, 500) handles all monospace rendering at 13px (`--font-size-mono`).

The type ramp spans 8 levels. At the top, display text sits at 56px/700 weight with a tight 1.1 line-height and -0.02em letter-spacing -- used sparingly, likely only in marketing or splash contexts. The H1 comes down to 32px/600, H2 at 24px/600, H3 at 20px/500. Body text is 14px/400 with a generous 1.6 line-height for comfortable reading in dense information layouts. Lead text (16px/400, line-height 1.7) provides slightly more breathing room for introductory paragraphs. Caption at 12px/400 handles metadata and secondary labels, while eyebrow -- the smallest tier at 11px/600 with 0.08em letter-spacing and uppercase transform -- serves as section headers, category labels, and badge text.

The approach is compact-first. A developer tool running on desktop can afford small text, and the 14px body / 12px caption pairing creates a dense but scannable information hierarchy.

### Spacing

The spacing system is a straightforward 4px base grid with 8 tokens: `--space-1` (4px) through `--space-8` (64px), covering the range from inline micro-gaps to section-level breathing room. Default input height is 28px, compact by general SaaS standards, reinforcing the density-first philosophy. Button heights follow three tiers: small (28px), medium (32px), and large (40px). Icon sizes map to 16/20/24px for small/medium/large contexts. This is a tight system -- the product expects users to be comfortable with information-dense interfaces.

### Radius

Radius values are deliberately restrained: 4px for subtle rounding (small badges, code blocks), 6px as the default for most controls (buttons, inputs, toggles), 8px for cards and larger containers, and 10px for modal-level surfaces. The `--radius-full` (9999px) is reserved exclusively for pill-shaped elements -- specifically status tags, badges, and toggle switches. This creates a clear visual distinction: interactive controls are slightly rounded, containers are gently rounded, and status indicators are fully pill-shaped. Nothing is aggressively rounded; the system favors a precise, technical aesthetic.

### Shadow / Elevation

Five shadow levels provide depth progression without heavy-handed effects. Level 1 (`0 1px 2px rgba(17,24,39,.06)`) is near-invisible -- used only for tooltips and subtle popovers. Level 2 (`0 2px 4px rgba(17,24,39,.08)`) lifts cards slightly off the surface. Level 3 (`0 4px 12px rgba(17,24,39,.12)`) handles dropdowns and flyouts. Level 4 (`0 8px 24px rgba(17,24,39,.16)`) is reserved for modals, and level 5 (`0 16px 48px rgba(17,24,39,.24)`) for full overlays. In dark mode these shift to pure black-based shadows with higher opacity (0.20 through 0.60), which reads more naturally on dark surfaces. The philosophy: shadows exist for functional layering, not decoration. At rest, most elements sit flat.

### Borders

Borders are 1px, using `--color-border` (`--pi-neutral-200` in light mode, `#1e2a3a` in dark mode). Cards carry a 1px border plus shadow-2 elevation. Dividers within cards use `--color-outline-variant` for subtlety. The border approach is minimal -- most separation is achieved through background contrast rather than heavy line work.

### Animation

Transitions are uniformly short at 0.15s, applied to background-color and border-color changes on interactive elements. No transform-based animations or spring physics in the token set. This keeps interactions feeling immediate and responsive -- appropriate for a tool where users expect fast, predictable feedback.

### Iconography

Icons use Lucide (via CDN SVGs), rendered at the three standard sizes (16/20/24px) matching the icon sizing tokens. The icon style is outline-based (stroke-width 2), consistent with the overall technical-minimal aesthetic.

## Component Patterns

| Component | Preview                          | Contract                  | CSS Source                       | Key Facts                                                                           | Key Insight                                                                        |
| --------- | -------------------------------- | ------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Button    | `preview/component-button.html`  | `components/button.json`  | `components.css` section Button  | 3 variants (primary/ghost/subtle), 3 sizes (28/32/40px), disabled state             | Ghost variant uses outline border; subtle is surface-tinted fill                   |
| Card      | `preview/component-card.html`    | `components/card.json`    | `components.css` section Card    | Tool/memory icon headers, meta footer, sectioned body with code blocks              | Colored icon backgrounds (`--pi-tool-50`, `--pi-memory-50`) distinguish card types |
| Input     | `preview/component-input.html`   | `components/input.json`   | `components.css` section Input   | Single-line (28px) and chat multiline (56px min) variants, prefix icon slot         | Chat input includes toolbar row with model selector and send button                |
| Sidebar   | `preview/component-sidebar.html` | `components/sidebar.json` | `components.css` section Sidebar | 52px icon rail + 240px session panel, search input, session list                    | Active states use `--color-primary-container` tinting, not bold color fill         |
| Tag       | `preview/component-tag.html`     | `components/tag.json`     | `components.css` section Tag     | Filled and outline styles, 4 semantic colors (success/warning/error/info) + neutral | Uppercase eyebrow-style text with 0.04em tracking for scanability                  |
| Modal     | `preview/component-modal.html`   | `components/modal.json`   | `components.css` section Modal   | 400px max-width, segmented control, iOS-style toggle, ghost + danger buttons        | Includes domain-specific Settings content (theme toggle, model selection)          |

## Index

- `README.md` -- this file; brand narrative and visual foundations
- `SKILL.md` -- AI agent skill manifest with quick-reference essentials
- `colors_and_type.css` -- single drop-in CSS file with all design tokens (link, do not parse)
- `components.css` -- aggregated component CSS extracted from preview specimens
- `css.json` -- structured JSON token representation for programmatic consumption
- `components/index.json` -- component index with slugs, categories, and insight seeds
- `preview/` -- standalone HTML specimen cards for Button, Card, Input, Sidebar, Tag, Modal

## Caveats / known substitutions

1. **Inter** is loaded via Google Fonts CDN (`@import url`). This introduces a network dependency. For offline or air-gapped environments, self-host the font files (WOFF2 recommended) and update the `@import` to a local `@font-face` declaration. System fallback is `sans-serif`.

2. **JetBrains Mono** is similarly CDN-sourced. In restricted environments, substitute with the system monospace stack (`Menlo, Monaco, Consolas, monospace`). Kerning and character widths will differ slightly, affecting code block alignment.

3. **Lucide icons** are loaded inline as SVGs from jsDelivr CDN in preview pages. For production, bundle the required SVGs locally or use the `lucide-react` package if working in React. The `components.css` file does not bundle icon assets -- only their container sizing rules.

4. **No dark-mode media query** is used. Dark mode is activated by adding the `.dark` class to a parent element (class-based toggling). Ensure the application's theme toggle adds/removes this class on `<html>` or `<body>`.

5. **Component contracts** are `from-scratch` with `schemaVersion: 2`. Sizes and states are inferred from the product's observed patterns (e.g., 28px input height, 32px button medium). These have high confidence but should be validated against any live product screenshots or Figma source if available.

6. **No `assets/` directory** is present. Icon SVGs are CDN-referenced in previews. If a local icon library is needed, export from Lucide and place under `assets/icons/`.
