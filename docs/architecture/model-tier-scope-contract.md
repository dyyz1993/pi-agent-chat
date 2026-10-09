# Model Tier Scope Contract

This document defines how Fast / Pro / Max model tiers are scoped in the chat UI.

## Scope Model

Tier mappings have exactly two product scopes:

1. Global defaults
2. Session overrides

There is no project-level tier mapping. Projects, new project tabs, and new sessions without a session override read the global defaults.

## Global Defaults

Global defaults are edited only from the global settings model panel. Saving a session-level tier mapping must not overwrite global defaults after global defaults already exist.

If global defaults are empty, the first session-level save may seed global defaults once. This preserves the product behavior where a fresh install gets a useful baseline without creating a hidden project scope.

## Session Overrides

Each session may store its own tier mapping and selected tier. Session overrides are persisted with the session and are loaded before global defaults during session restore.

When a new session or fork is created from an existing active session, the new session may copy the source session's tier mapping and selected tier for convenience. This copy is still a session override on the new session; it is not a project-level setting.

## Runtime Hydration

The runtime agent process receives the effective session tier mapping:

1. Load session tier config from the session JSONL metadata.
2. If missing, fall back to global defaults.
3. Hydrate the active agent process with `agent.setTierModels`.
4. Match the restored current model against the effective mapping to restore the selected Fast / Pro / Max pill.

The global settings panel must read and write global defaults only. The sidebar model controls must read and write the active session override.

## Unconfigured Tier Chip UX

When the effective mapping has no model for a tier, clicking that tier chip in the sidebar must not fall through to a silent backend failure (`switchTier` errors only surface in the notification bell). The chip click opens the tier config popover directly and shows a "not configured" tooltip (`tierNotConfiguredHint`), giving the user a visible next step. Configured chips keep their normal label tooltip.

Backend adapters must invalidate any cached tier-model reads after `setTierModels` succeeds, so a save → switch sequence immediately sees the new mapping (ion adapter busts its `tier_models` read cache; regression test in `test/unit/utils/ion-backend.test.ts`).

## Non-Goals

Project-level tier mappings are intentionally unsupported. Do not add `projectPath -> tierModels` state to the frontend store, even as a cache. If a future product requirement needs project defaults, it should be introduced as a new explicit scope with migration, UI wording, and tests.

## Test Expectations

Changes touching tier selection should include tests for:

- Session overrides surviving refresh.
- Global defaults not changing when an existing global config is present.
- First session save seeding global defaults only when global defaults are empty.
- New session / fork copying the source session override.
- No project-scoped tier APIs or store state being exposed.
- Unconfigured tier chips opening the config popover instead of silently failing.
- Backend tier-model read caches being invalidated after `setTierModels`.
