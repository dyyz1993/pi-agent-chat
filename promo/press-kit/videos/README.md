# Pi Agent Chat Promo Videos

This directory contains generated video assets for launch and social promotion.

## Generated Assets

| File                                                    | Use                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pi-agent-chat-teaser-16x9.mp4`                         | Privacy-safe 12s teaser for GitHub, README, websites, and social posts |
| `pi-agent-chat-teaser-cover.png`                        | Cover image / thumbnail for the teaser                                 |
| `pi-agent-chat-teaser-voiceover.txt`                    | Voiceover script for the teaser                                        |
| `../site/assets/desktop-ui-hero-preview.mp4`            | Tracked desktop UI preview used by the promo site                      |
| `../site/assets/mobile-ui-panel-preview.mp4`            | Tracked mobile UI preview used by the promo site                       |
| `live-ui-recording-notes.md`                            | Safety notes for live UI recordings                                    |
| `raw/pi-agent-chat-live-ui-recording.mp4`               | Optional live UI recording from the local app, if generated            |
| `raw/pi-agent-chat-public-demo-ui-recording.mp4`        | Reviewed real-UI desktop public demo; local/ignored review artifact    |
| `raw/pi-agent-chat-public-demo-mobile-ui-recording.mp4` | Reviewed real-UI mobile public demo; local/ignored review artifact     |

## Generate The Teaser

```bash
node scripts/generate-promo-video.js
```

The teaser is generated from local brand assets and synthetic product UI, so it is safe for public release.

## Record The Live App

```bash
PROMO_APP_URL=http://localhost:5173/ node scripts/record-promo-video.js
```

The live recorder opens the app in Chromium, performs a short scroll/click tour, and writes an MP4 recording under `promo/press-kit/videos/raw/`.

Always review live UI recordings before publishing. They may contain local project names, sessions, messages, or other private content from the running app.

## Record The Public Demo Flow

```bash
PROMO_APP_URL=http://localhost:5173/ \
PROMO_DEMO_NAME=pi-agent-chat-launch-demo \
node scripts/record-public-demo-video.js
```

This flow uses the real 5173 browser UI to create a disposable demo project, directly create a Goal, wait for its real completion, send a read-only chat, show plan/permission state, and tour the right-side panels. The default capture is desktop. For the mobile capture, use `PROMO_DEVICE=mobile`; the mobile right-side icon rail remains visible and the status panel is exercised as an overlay:

```bash
PROMO_APP_URL=http://localhost:5173/ \
PROMO_DEVICE=mobile \
PROMO_DEMO_NAME=pi-agent-chat-launch-demo-mobile \
node scripts/record-public-demo-video.js
```

The recorder masks existing project chrome and scrubs local paths at the recorder layer. Review the resulting local MP4 before any public release; raw recordings are intentionally ignored by Git.
