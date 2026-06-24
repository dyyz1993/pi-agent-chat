# Learning Memory And Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build one user-facing Learning surface that manages both memory and skill distillation, with candidate approval, curator/dream visibility, unified file opening through Explorer/FileOverlay, and deterministic validation from harness tests through RPC JSONL and UI screenshots.

**Architecture:** Product UX exposes one `Learning` panel with sub-tabs for Overview, Memory, Skills, Candidates, Curator, and Settings. Runtime logic remains split by domain: memory owns recall/extraction/dream, skills own generated skill loading/distillation/usage/curation, and a shared learning core owns config, candidates, provenance, runs, and refresh-safe snapshots. No backward compatibility migration is required because this feature has not shipped.

**Tech Stack:** React 18, TypeScript, Zustand, Vite, Tailwind, pi-coding-agent extensions/channels, AgentSession harness with faux provider, WebSocket RPC JSONL tests, Playwright UI verification.

---

## Target Product Shape

The current right sidebar `Memory` entry becomes `Learning`.

Learning tabs:

- `Overview`: status, top-level switches, counts, pending badges, latest run summaries.
- `Memory`: memory files, memory extraction mode, recall history summary, and folded diagnostics.
- `Skills`: available/generated skills, usage, scope, state, and folded diagnostics.
- `Candidates`: all pending memory, skill, and curator candidates in one approval queue.
- `Curator`: dry-run and applied organization reports for memory dream and skill curator.
- `Settings`: project-scoped learning configuration.

Default UX:

- Show user-facing results first: counts, candidates, active memories, active skills.
- Fold diagnostics by default: prefetch details, skip/guard rules, raw custom entries, load diagnostics, curator reasoning.
- Display badges on folded diagnostic sections when there are warnings, failures, skipped recalls, load collisions, or curator actions.
- Every file reference opens through Explorer/FileOverlay. Learning must not implement a second full file preview/editor.

## Storage Target

Use project-scoped private state only for generated/private learning data.

```text
<PROJECT_USER_STATE_DIR>/learning/
  config.json
  events.jsonl
  candidates/
  runs/
  snapshots/

<PROJECT_USER_STATE_DIR>/memory/
  MEMORY.md
  *.md
  .archive/

<PROJECT_USER_STATE_DIR>/skills/
  <skill-name>/
    SKILL.md
    references/
    scripts/
    templates/
    assets/
  .usage.json
  .archive/
```

Promotion targets:

- Project-private generated memory/skills: `<PROJECT_USER_STATE_DIR>/memory` and `<PROJECT_USER_STATE_DIR>/skills`.
- Project-shared memory/skills: `<PROJECT_ROOT>/.pi/memory` and `<PROJECT_ROOT>/.pi/skills`, only after project trust and explicit user promotion.
- Global user skills: `<PI_AGENT_DIR>/skills`, only after explicit user promotion.

Do not store this in `~/.pi-agent-chat/config.json`; that file remains app-level UI indexes only.

## Acceptance Criteria

### Product

- The right sidebar has a single `Learning` entry instead of a top-level `Memory` entry.
- Learning has the six sub-tabs listed above.
- Memory and Skill are separate tabs under Learning, not separate top-level sidebar entries.
- Candidates are cross-domain and can contain memory candidates, skill candidates, and curator candidates.
- Diagnostics are present but folded by default.
- Diagnostics show a visible badge when there is a failure, warning, or action requiring attention.

### Memory

- Memory recall can be enabled independently from memory extraction.
- Memory extraction supports at least: `off`, `pending`, `auto`.
- In `pending`, extracted memory is listed in Candidates and no memory file is changed until approval.
- In `auto`, extracted memory is written under the project-scoped memory directory.
- Memory dream/curation supports `dry-run`, `pending`, and `auto`.
- Memory files and `MEMORY.md` are clickable file links that open Explorer/FileOverlay.
- Deleting or archiving memory updates list state and index state through a queryable snapshot.

### Skills

- Skill distillation supports at least: `off`, `pending`, `auto`.
- Default generated skill scope is project-private.
- Generated project-private skills are discoverable by the agent when enabled.
- Generated skills can be disabled without deleting their files.
- Skill candidates can be approved as new skills or merged into existing skills.
- Skill cards show: name, description, scope, source, state, usage count, last used, patch count.
- Skill files, `SKILL.md`, references, scripts, templates, and assets are clickable file links that open Explorer/FileOverlay.
- Skill curator supports `dry-run`, `pending`, and `auto`, with dry-run as the default.
- Skill curator handles the whole skill package, not only `SKILL.md`.
- Skill curator can be scheduled per project. Scheduled runs use the configured curator mode and are owned by the runtime extension, not the browser UI.

### Candidates And Provenance

- Every candidate records source session id, source message ids when available, created time, proposed action, target domain, confidence, and human decision.
- Candidate approval/rejection is refresh-safe and reconnect-safe.
- Approved candidates emit or persist an event visible in Learning runs/history.
- Rejected candidates remain auditable in run history, but no longer block the main candidate queue.

### File Opening

- Learning uses one reusable file-link component for all file paths.
- Clicking a persisted file calls the existing Explorer open path flow and opens the existing FileOverlay.
- Clicking a missing file shows a stale/missing state with `rescan` and `remove from list` actions.
- Clicking a not-yet-persisted candidate opens the candidate details, not FileOverlay.

## Implementation Tasks

### Task 1: Define Learning Contracts

**Files:**

- Create or modify in fork: `packages/coding-agent/extensions/learning/contract.ts`
- Create or modify in app: `src/shared/modules/learning.ts`
- Create or modify in app: `src/shared/constants/channel-methods.ts`

**Steps:**

1. Define `LearningConfig`, `LearningOverview`, `LearningCandidate`, `LearningRun`, `LearningFileRef`, `LearningSkillSummary`, and `LearningMemorySummary`.
2. Define channel methods for `learning.getSnapshot`, `learning.setConfig`, `learning.listCandidates`, `learning.approveCandidate`, `learning.rejectCandidate`, `learning.runCurator`, and file/ref metadata.
3. Add separate domain fields for `memory` and `skills`, but keep shared candidate/run structures.
4. Include `version` fields in persisted documents even though no backward migration is needed yet.

### Task 2: Implement Project-Scoped Learning Store

**Files:**

- Create in fork: `packages/coding-agent/extensions/learning/store.ts`
- Modify or replace relevant memory path helpers in fork extension code.
- Mirror app path expectations in `src/shared/lib/pi-agent-paths.ts` only if the app needs direct fallback access.

**Steps:**

1. Resolve project-private state from the canonical project identity.
2. Persist config, events, candidates, runs, memory, and skills under project-scoped paths.
3. Avoid cwd-keyed global JSON stores.
4. Add deterministic write helpers for JSON and JSONL.
5. Add path guards for all delete/archive/read operations.

### Task 3: Memory Provider

**Files:**

- Move or refactor from: `packages/coding-agent/extensions/auto-memory/*`
- Create or modify: `packages/coding-agent/extensions/learning/memory-provider.ts`

**Steps:**

1. Keep recall/injection behavior separate from extraction.
2. Gate extraction on `memory.extractMode`.
3. In pending mode, write a candidate only.
4. In auto mode, write memory files directly.
5. Keep dream/curator dry-run output as a run report before applying changes.

### Task 4: Skill Provider

**Files:**

- Create: `packages/coding-agent/extensions/learning/skill-provider.ts`
- Create: `packages/coding-agent/extensions/learning/skill-curator.ts`
- Modify skill discovery only as needed in `packages/coding-agent/src/core/package-manager.ts` or `src/core/resource-loader.ts`

**Steps:**

1. Add project-private generated skills directory to discovery when learning skills are enabled.
2. Track generated skill usage and patch metadata in `.usage.json`.
3. Generate skill candidates from reusable workflows, debug paths, tool steps, or repeated patterns.
4. Support approve-as-new, merge-into-existing, reject, archive, restore, disable, and promote.
5. Ensure generated skill package operations include `SKILL.md` plus references, scripts, templates, and assets.

### Task 5: App RPC And Stores

**Files:**

- Create: `src/shared/handlers/learning.ts`
- Modify: `src/shared/handlers/index.ts`
- Create: `src/mainview/stores/use-learning-store.ts`
- Create or modify: `src/mainview/components/learning-panel/*`

**Steps:**

1. Register Learning RPC handlers backed by the learning channel.
2. Store snapshots by session/project and rebuild on active session/project changes.
3. Subscribe to learning events and merge them into the snapshot.
4. Keep snapshots queryable so refresh/reconnect can rebuild UI before live events resume.

### Task 6: Learning UI

**Files:**

- Replace or wrap: `src/mainview/components/memory-panel/MemoryPanel.tsx`
- Create: `src/mainview/components/learning-panel/LearningPanel.tsx`
- Create: `src/mainview/components/learning-panel/LearningTabs.tsx`
- Create: `src/mainview/components/learning-panel/FileLink.tsx`
- Modify: `src/mainview/components/right-sidebar/RightSidebar.tsx`
- Modify: `src/mainview/layouts/types.ts`
- Modify locales under `src/mainview/locales/*`

**Steps:**

1. Rename top-level right-sidebar entry from Memory to Learning.
2. Add Overview, Memory, Skills, Candidates, Curator, Settings tabs.
3. Keep diagnostics folded with badges.
4. Use the reusable `FileLink` for all file paths.
5. `FileLink` must call the existing Explorer open file flow; do not implement inline file editing in Learning.

## Required Test Order

Validation order is mandatory:

1. Fork harness and plugin tests first.
2. App unit/integration RPC tests next.
3. RPC JSONL/protocol tests next.
4. UI/Playwright tests last, with screenshots.

This order is intentional: prove runtime behavior before UI clicks.

## Test Plan

### Phase 1: Fork Harness And Plugin Tests

Run from `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent`.

Use harness for all extension lifecycle and context behavior. The harness must use the faux provider only, no real API keys.

Add or update tests:

- `test/suite/learning-memory-skill.test.ts`
  - `learning.getSnapshot` returns config, candidates, memory summaries, skill summaries, and run summaries.
  - `memory.extractMode=off` does not call extraction LLM and does not write candidates.
  - `memory.extractMode=pending` writes a memory candidate and does not write a memory file.
  - `skills.distillMode=pending` writes a skill candidate and does not write `SKILL.md`.
  - Approving a memory candidate writes memory and emits an approved event.
  - Approving a skill candidate writes a project-private skill package and emits an approved event.
  - Candidate state survives simulated session restart by reading persisted snapshot.

- `test/suite/learning-skill-curator.test.ts`
  - dry-run reports stale/generated skills without modifying files.
  - pending mode creates curator candidates.
  - archive moves the whole generated skill package.
  - pinned skills are not archived.
  - merge candidates include affected files beyond `SKILL.md`.

- `test/suite/learning-scheduler.test.ts`
  - enabled skill curator schedule registers a timer and emits a run plus refreshed snapshot.
  - scheduled skill curator runs use the configured mode, e.g. `pending`.
  - disabled schedules do not emit runs or create candidates.

- Existing related tests to keep passing:
  - `test/auto-memory-ext/memory-xml-harness.test.ts`
  - `extensions/auto-memory/__tests__/extract-result.test.ts`
  - `extensions/auto-memory/__tests__/prompts.test.ts`
  - `test/suite/skill-tool.test.ts`
  - `test/skills.test.ts`
  - `test/sdk-skills.test.ts`

Commands:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/learning-memory-skill.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/learning-skill-curator.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/learning-scheduler.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/auto-memory-ext/memory-xml-harness.test.ts
node ../../node_modules/vitest/dist/cli.js --run extensions/auto-memory/__tests__/extract-result.test.ts extensions/auto-memory/__tests__/prompts.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/skill-tool.test.ts test/skills.test.ts test/sdk-skills.test.ts
```

Expected:

- All commands pass.
- No real provider/API/network calls.
- No generated test data escapes the temp dirs or project-scoped test dirs.

### Phase 2: Build And Yalc Push

Run only after Phase 1 passes.

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm run build
yalc push
```

Expected:

- Build succeeds.
- `yalc push` updates `pi-agent-chat/.yalc` and `node_modules`.
- Existing running agent processes are restarted/reloaded before manual or UI verification.

### Phase 3: App Unit And Integration Tests

Run from `/Users/xuyingzhou/Project/temporary/pi-agent-chat`.

Add or update tests:

- `test/unit/handlers/learning.test.ts`
  - handler forwards snapshot/config/candidate/curator calls to channel.
  - fallback returns safe empty snapshot when no agent process exists.
  - schedule switches persist in project-private Learning config.
  - file path operations reject paths outside learning/memory/skill roots.

- `test/unit/stores/learning.test.ts`
  - loads snapshot into state.
  - applies live events idempotently.
  - preserves folded diagnostics state.
  - rebuilds from snapshot after clear/reload.

- `test/unit/components/LearningPanel.test.tsx`
  - renders top-level tabs.
  - keeps diagnostics collapsed by default.
  - shows warning badges for failed runs or diagnostics.
  - renders file references through `FileLink`.
  - settings page can update skill curator schedule through `learning.setConfig`.

- `test/integration/memory/learning-snapshot.test.ts`
  - verifies refresh/reconnect style recovery by loading snapshot first, then events.

Commands:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bun run test:memory
bun run test:settings
bunx vitest run --config vitest.config.ts test/unit/handlers/learning.test.ts test/unit/stores/learning.test.ts test/unit/components/LearningPanel.test.tsx
bunx vitest run --config vitest.config.ts test/integration/memory/learning-snapshot.test.ts
```

Expected:

- All commands pass.
- Snapshot recovery test proves UI state is not dependent only on one-shot events.

### Phase 4: RPC JSONL / Protocol Tests

Run after app unit/integration and after fork build/yalc.

Fork package:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/rpc-jsonl.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-rpc-protocol.test.ts
```

App side:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bunx vitest run --config vitest.config.e2e.ts test/e2e-llm/rpc/client.test.ts
```

If the app e2e RPC test requires real provider credentials and they are unavailable, record it as skipped with the exact missing env reason. Do not substitute UI tests for this gate.

Expected:

- RPC JSONL framing stays valid.
- Learning channel calls do not break existing RPC request/response semantics.
- Event payloads are JSON-serializable and include enough data to rebuild Learning UI state from snapshot plus events.

### Phase 5: UI / Playwright Verification

Run last.

Add or update tests:

- `e2e/learning-panel.spec.ts`
  - right sidebar shows `Learning`.
  - Learning opens with Overview.
  - Memory tab shows memory summary and folded diagnostics.
  - Skills tab shows generated skill summary and folded diagnostics.
  - Candidates tab shows pending memory and skill candidates.
  - Clicking any persisted file reference opens Explorer/FileOverlay.
  - Missing file references render stale/missing state.

Commands:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bunx playwright test e2e/learning-panel.spec.ts --project=chromium
```

Required screenshots:

- Memory tab with diagnostics folded.
- Skills tab with generated skill card and diagnostics folded.
- Candidates tab with both memory and skill candidates.
- Curator tab with recent scheduled/curator run.
- Settings tab with memory and skill schedule controls.
- Diagnostics expanded state.
- File reference click showing Explorer/FileOverlay opened.
- Mobile Learning settings state.

Store screenshots under:

```text
test-results/learning-acceptance/
```

Expected:

- Playwright passes.
- Screenshots show no overlapping UI, no clipped controls, and no duplicate file preview implementation inside Learning.

## Final Acceptance Checklist

- [ ] One top-level Learning entry exists.
- [ ] Memory and Skills are separate tabs inside Learning.
- [ ] Candidates and Curator are shared cross-domain tabs.
- [ ] Diagnostics are folded by default with attention badges.
- [ ] All file references open through Explorer/FileOverlay.
- [ ] Project-private generated state is stored under project-scoped paths.
- [ ] No backward compatibility migration code was added for the unshipped legacy Learning UI.
- [ ] Fork harness/plugin tests pass.
- [ ] Fork build and yalc push pass.
- [ ] App unit/integration tests pass.
- [ ] RPC JSONL/protocol tests pass or real-provider e2e skip is documented with exact reason.
- [ ] UI Playwright test passes.
- [ ] UI screenshots are captured and linked in the final verification report.

## 2026-06-24 Supplemental Verification Notes

Additional coverage added after review:

- Fork: `test/suite/learning-scheduler.test.ts` covers scheduled skill curator ticks with fake timers and disabled schedules.
- App: `test/unit/handlers/learning.test.ts` persists schedule config in project-private storage.
- App: `test/unit/components/LearningPanel.test.tsx` verifies the skill schedule toggle calls `learning.setConfig`.
- UI evidence expanded to eight screenshots under `test-results/learning-acceptance/`.

Captured screenshots:

- `01-memory-tab.png`
- `02-skills-tab.png`
- `03-candidates-tab.png`
- `04-curator-tab.png`
- `05-settings-schedule-collapsed.png`
- `06-settings-diagnostics-expanded.png`
- `07-file-overlay-skill.png`
- `08-mobile-learning-settings.png`
