# Electrobun Voice Input Repro Handoff

This document defines how to handle the local `repro/` assets created during the macOS desktop voice-input investigation.

## Goal

Keep `pi-agent-chat` focused on product code, while preserving the standalone reproduction needed for:

- upstream Electrobun bug reports
- future desktop text-services regressions
- renderer boundary verification (`native` vs `cef`)

## Recommendation

Do not keep the full repro app in the main `pi-agent-chat` repository long term.

Published standalone repo:

- `https://github.com/dyyz1993/electrobun-voice-input-repro`

Preferred end state:

1. Publish the repro into a separate repository.
2. Keep only a lightweight reference in `pi-agent-chat`.
3. Remove the local `repro/` folder from this repository after the external repo is published and referenced.

## Current Local Repro Assets

Current local source paths:

- `repro/electrobun-voice-input/`
- `repro/electrobun-voice-input-cef/`

Important files:

- `repro/electrobun-voice-input/README.md`
- `repro/electrobun-voice-input/ISSUE_REPORT.md`
- `repro/electrobun-voice-input/ELECTROBUN_GITHUB_ISSUE.md`
- `repro/electrobun-voice-input/electrobun.config.ts`
- `repro/electrobun-voice-input/package.json`
- `repro/electrobun-voice-input-cef/electrobun.config.ts`
- `repro/electrobun-voice-input-cef/package.json`

## Suggested External Repo

Suggested repository name:

- `electrobun-voice-input-repro`

Suggested structure:

```text
electrobun-voice-input-repro/
  README.md
  ISSUE_REPORT.md
  ELECTROBUN_GITHUB_ISSUE.md
  native/
    electrobun.config.ts
    package.json
    src/...
  cef/
    electrobun.config.ts
    package.json
    src/...
```

If preserving the current layout is easier, that is also acceptable as long as the repo clearly exposes:

- native renderer repro
- CEF renderer repro
- browser control page
- issue summary and expected/actual behavior

## Publish Checklist

Before removing `repro/` from `pi-agent-chat`, make sure the external repro repo contains:

1. A one-page README with:
   - problem summary
   - environment
   - native vs CEF result
   - build/run commands
   - expected vs actual behavior
2. The issue-report markdown already prepared locally.
3. A note that the repro intentionally avoids app-level React/composer/RPC code.
4. Exact current conclusion:
   - browser works
   - Electrobun native renderer fails
   - Electrobun CEF renderer works

## Upstream Issue Usage

If filing against Electrobun, attach or link:

- the external repro repo
- `ELECTROBUN_GITHUB_ISSUE.md`
- the native vs CEF comparison result

The repro is valuable because it narrows the problem below `pi-agent-chat` UI code and into the renderer/runtime boundary.

## What To Keep In This Repo

After the external repro repo exists, keep only a short reference in `pi-agent-chat` docs.

Suggested reference content:

```md
Desktop third-party macOS voice input was isolated into a standalone Electrobun repro.

- External repro: https://github.com/dyyz1993/electrobun-voice-input-repro
- Scope: native renderer vs CEF renderer voice-input compatibility
- Current conclusion: browser works, CEF works, native renderer fails
```

Good places for that short reference:

- `AGENTS.md` if the boundary matters for future agent debugging
- or a small note under `docs/workflows/`

## Removal Checklist

Once the external repro repo is published and linked:

1. Verify the external repo can be cloned and run independently.
2. Add the short reference note to this repository.
3. Remove local `repro/` from `pi-agent-chat`.
4. Keep issue links and repro URL in the reference note.

## Important Boundary

Do not delete the repro before the external repo exists.

Without the standalone repro, future debugging may regress into repeatedly questioning whether the problem is:

- `pi-agent-chat` composer logic
- app-level shortcut handling
- focus management
- or Electrobun native renderer text-services integration

The repro is the artifact that proves the current boundary.
