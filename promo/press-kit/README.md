# Pi Agent Chat Press Kit

This folder contains public launch materials for Pi Agent Chat. Everything here is safe to use in posts, release notes, project pages, and announcement graphics.

## Product Positioning

**One-liner**

Pi Agent Chat is an open-source agent workbench for coding, review, goals, and remote projects.

**Short description**

Pi Agent Chat gives coding agents a real workspace: streaming chat, tool timelines, review flows, goal tracking, message history, desktop/web support, and local project control in one interface.

**Long description**

Pi Agent Chat is a desktop and web UI for AI coding agents. It is built for developers who want more than a single chat box: it keeps agent work visible through message history, tool activity, review surfaces, goals, remote project workflows, and high-performance scrolling. The project is open source under AGPL-3.0 and is designed for local development workflows where visibility and control matter.

## Asset Inventory

### Logo and Icon

- `assets/pi-agent-chat-logo.svg`
- `assets/pi-agent-chat-logo-512.png`
- `assets/pi-agent-chat-logo-1024.png`
- `assets/pi-agent-chat-app-icon-512.png`

### Posters

- `posters/pi-agent-chat-og-1600x900.png` - GitHub social preview, blog cover, launch page hero
- `posters/pi-agent-chat-square-1080.png` - square social post
- `posters/pi-agent-chat-story-1080x1920.png` - mobile story / vertical poster

### Clean Product Visual

- `screenshots/clean-workbench-mock-1600x1000.png`

This is a generated product mock. It does not contain private project names, session IDs, file paths, URLs, token counts, or real chat content.

### Video

- `videos/pi-agent-chat-teaser-16x9.mp4` - privacy-safe 12s teaser video
- `videos/pi-agent-chat-teaser-voiceover.txt` - voiceover script
- `site/assets/desktop-ui-hero-preview.mp4` - tracked desktop UI preview used by the promo site
- `site/assets/mobile-ui-panel-preview.mp4` - tracked mobile UI preview used by the promo site
- `videos/raw/pi-agent-chat-live-ui-recording.mp4` - optional live UI recording, if generated
- `videos/raw/pi-agent-chat-public-demo-ui-recording.mp4` - reviewed real-UI desktop public demo, kept local and ignored
- `videos/raw/pi-agent-chat-public-demo-mobile-ui-recording.mp4` - reviewed real-UI mobile public demo, kept local and ignored

### Promo Site

- `site/index.html` - standalone launch page combining the logo, generated background, reviewed screenshots, posters, and tracked desktop/mobile UI preview videos

Preview it from the press-kit root:

```bash
python3 -m http.server 4174 --directory promo/press-kit
```

Then open `http://localhost:4174/site/`.

## Copy

- `copy/launch-copy.md` - launch announcement, README intro, and release copy
- `copy/social-posts.md` - short social posts in English and Chinese
- `copy/faq.md` - public FAQ for launch replies

## Regenerate Images

Run this from the repository root:

```bash
node scripts/generate-press-kit.js
```

The generated posters use the current app icon in `resources/app-icon.png` and keep the visual direction aligned with the app icon.

## Generate Video

Generate the privacy-safe teaser:

```bash
node scripts/generate-promo-video.js
```

Record the live app for future editing:

```bash
PROMO_APP_URL=http://localhost:5173/ node scripts/record-promo-video.js
```

Review live recordings before publishing because they can include local session content.

Record the public demo flow from the real browser UI:

```bash
PROMO_APP_URL=http://localhost:5173/ \
PROMO_DEMO_NAME=pi-agent-chat-launch-demo \
node scripts/record-public-demo-video.js
```

The public flow creates a disposable project through the UI, directly creates a Goal, waits for real completion, and then demonstrates chat, status/permission controls, and the right-side panels. Set `PROMO_DEVICE=mobile` to record the mobile layout; its right-side icon rail remains part of the flow. The recorder outputs are local review artifacts, not release assets: verify the complete MP4s and keep the raw directory ignored.

## Launch Safety Notes

- Do not publish old `brand/kordiq-*` assets from the broader branding branch.
- Do not use raw screenshots from local development unless they are reviewed and redacted.
- Keep release posts focused on open-source positioning, local control, desktop/web workflow, and agent work visibility.
- The current public name in this clean branch is still `Pi Agent Chat`.
