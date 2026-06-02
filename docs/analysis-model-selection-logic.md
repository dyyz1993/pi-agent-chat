# Model Selection Logic Chain Analysis

## 1. File Paths of Key Components and Stores

### UI Components

- **ModelPicker**: `src/mainview/components/model-picker/ModelPickerButton.tsx`
- **SidebarBottomControls**: `src/mainview/components/left-sidebar/SidebarBottomControls.tsx`

### Frontend Stores

- **Session Store**: `src/mainview/stores/use-session-store.ts`
- **Tier Store**: `src/mainview/stores/use-tier-store.ts`

### Backend RPC Handlers

- **Agent Handler**: `src/shared/handlers/agent.ts`
- **Session Handler**: `src/shared/handlers/session.ts`
- **Process Manager**: `src/shared/agent/process-manager.ts`

### Type Definitions

- **Modules**: `src/shared/modules/agent.ts`, `src/shared/modules/session.ts`

---

## 2. Data Flow: Backend → Frontend Store → ModelPicker → currentModel

### 2.1 Initial Load Flow (Session Activation)

```
User opens/activates session
  ↓
SidebarBottomControls.tsx (line 121-127)
  - Calls fetchModelState(sessionId)
  - Calls fetchTierConfig(sessionId)
  ↓
fetchModelState() → use-session-store.ts:1643-1660
  - apiClient.call("agent.getAvailableModels")
  - Sets availableModels in store
  ↓
fetchTierConfig() → use-tier-store.ts:92-104
  - apiClient.call("agent.getTierModels")
  - Sets globalDefaults tier models
  ↓
Backend Chain:
  process-manager.ts:2024-2039 (getTierModels)
  → sandbox-rpc-client.ts (agent.getTierModels RPC)
  → CLI SandboxAgent (getTierModels)
```

### 2.2 Model Selection Flow (User Action)

```
User clicks model picker → SidebarBottomControls.tsx:267-288
  ↓
handleSelectModel(key)
  - Parse provider/modelId from "provider/modelId"
  ↓
apiClient.call("agent.setModel", { sessionId, provider, modelId })
  ↓
Backend Chain:
  process-manager.ts:1716-1727 (setModel)
  → sandbox-rpc-client.ts (agent.setModel RPC)
  → CLI SandboxAgent (setModel)
  ↓
Frontend Updates (on success):
  1. setCurrentModel(provider, modelId) → use-session-store.ts:1662-1663
     - Sets currentModel = { provider, id, modelManuallySet: true }
  2. useTierStore.getState().syncTierFromModel(sessionId, provider, modelId)
     - use-tier-store.ts:80-90
     - Checks if model matches a tier's configured model
     - If match: sets currentTier to that tier
     - If no match: sets currentTier to null
```

### 2.3 Model State Restoration Flow (Session Re-entry)

```
User re-enters session (hot/cold switch)
  ↓
fetchInitialState(sessionId) → use-session-store.ts:1157-1641
  ↓
Priority 1: agent.getState() → use-session-store.ts:1176-1229
  - Fetches backend state including current model
  - result.model = { provider, id, name, contextWindow }
  ↓
If result.model exists:
  - Sets currentModel = { provider, id, name }
  - Sets modelManuallySet = false (backend-supplied)
  - Unless user manually set before (line 1206-1221)
  ↓
Priority 2: agent.getAvailableModels() → use-session-store.ts:1245-1260
  - Sets availableModels array
  ↓
Priority 5: Restore persisted tier config → use-session-store.ts:1509-1546
  - session.loadTierConfig(sessionPath)
  - Loads tierModels and currentTier from session JSONL
  - useTierStore.setSessionTierModels(sessionId, tierModels)
  - useTierStore.setSessionCurrentTier(sessionId, currentTier)
  ↓
Then syncTierFromModel → use-session-store.ts:1536-1544
  - Calls useTierStore.syncTierFromModel(sessionId, provider, id)
  - Derives currentTier from currentModel
```

---

## 3. Fast/Medium/Thinking Levels Selection and Storage

### 3.1 Thinking Level UI Component

**Location**: `SidebarBottomControls.tsx:725-770`

```typescript
const THINKING_LEVEL_VALUES = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const THINKING_LEVEL_KEYS = [
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXHigh",
] as const;

// Display mapping via i18n:
const thinkingDisplay = currentThinkingLevel
  ? (() => {
      const idx = THINKING_LEVEL_VALUES.indexOf(currentThinkingLevel);
      return idx >= 0 ? t(THINKING_LEVEL_KEYS[idx]) : currentThinkingLevel;
    })()
  : t("default");
```

### 3.2 Thinking Level Storage

**Location**: `use-session-store.ts:237, 148, 1664`

```typescript
interface SessionState {
  currentThinkingLevel: string;  // Default: "medium"
  setThinkingLevel: (level: string) => void;
}

// Initial state:
currentThinkingLevel: "medium",

// Action:
setThinkingLevel: (level) => set({ currentThinkingLevel: level }),
```

**NOTE**: `currentThinkingLevel` is **NOT persisted** to localStorage or session file. It's in-memory only.

### 3.3 Thinking Level Selection Handler

**Location**: `SidebarBottomControls.tsx:290-310`

```typescript
const handleSelectThinking = useCallback(
  async (level: ThinkingLevel) => {
    if (!activeSessionId || switching || currentThinkingLevel === level) {
      setThinkingOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await apiClient.call("agent.setThinkingLevel", {
        sessionId: activeSessionId,
        level,
      });
      setThinkingLevel(level);
    } catch (err) {
      console.warn("[SidebarControls] setThinkingLevel failed:", err);
    }
    setSwitching(false);
    setThinkingOpen(false);
  },
  [activeSessionId, switching, currentThinkingLevel, setThinkingLevel],
);
```

### 3.4 Backend RPC

**Handler**: `src/shared/handlers/agent.ts` (need to find setThinkingLevel registration)

**Backend**: `process-manager.ts:1748-1759`

```typescript
async setThinkingLevel(sessionId: string, level: string): Promise<void> {
  const managed = this.getActiveManaged(sessionId);
  if (!managed) return;
  await managed.client
    .setThinkingLevel(level as Parameters<typeof managed.client.setThinkingLevel>[0])
    .catch((err: unknown) => {
      log.warn("setThinkingLevel error", { sessionId, err });
    });
}
```

**Sandbox**: `src/sandbox/sandbox-agent.ts:231`

```typescript
set_thinking_level: ["level"],
```

---

## 4. Model Selection: How Models are Actually Selected

### 4.1 Model Selection Options

There are **TWO** ways to select models:

#### Option A: Direct Model Selection (via ModelPicker)

```
SidebarBottomControls → ModelPickerButton → handleSelectModel()
  ↓
apiClient.call("agent.setModel", { sessionId, provider, modelId })
  ↓
Frontend:
  - setCurrentModel(provider, modelId) → currentModel = { provider, id }
  - syncTierFromModel(sessionId, provider, modelId) → Derives currentTier from model
  - modelManuallySet = true (mark as user-selected)
```

#### Option B: Tier Selection (via fast/pro/max buttons)

```
SidebarBottomControls → handleSwitchTier(tier)
  ↓
useTierStore.switchToTier(tier, sessionId) → use-tier-store.ts:106-128
  ↓
apiClient.call("agent.setModel", { sessionId, provider: "", modelId: tier })
  ↓
Backend resolves tier to actual model (e.g., "fast" → "openai/gpt-4o-mini")
  ↓
Frontend:
  - setSessionCurrentTier(sessionId, tier)
  - setCurrentModel(provider, id) from resolved model
  - savePersistedConfigForSession(sessionId) → Persists tier config to session file
```

### 4.2 Tier Configuration Data Structure

**Location**: `use-tier-store.ts:8-14, 11-14`

```typescript
type TierKey = "fast" | "pro" | "max";

interface TierSessionData {
  tierModels: Record<string, string>; // { fast: "openai/gpt-4o-mini", pro: "...", max: "..." }
  currentTier: TierKey | null;
}

interface TierState {
  globalDefaults: Record<string, string>; // Default tier models from backend
  dataBySession: Record<string, TierSessionData>; // Per-session overrides
  getTierModels: (sessionId: string) => Record<string, string>;
  getCurrentTier: (sessionId: string) => TierKey | null;
}
```

### 4.3 Tier Sync from Model

**Location**: `use-tier-store.ts:80-90`

```typescript
syncTierFromModel: (sessionId, provider, modelId) => {
  const fullName = `${provider}/${modelId}`;
  const models = get().getTierModels(sessionId);
  for (const tier of TIER_KEYS) {  // ["fast", "pro", "max"]
    if (models[tier] && models[tier] === fullName) {
      get().setSessionCurrentTier(sessionId, tier);
      return;
    }
  }
  get().setSessionCurrentTier(sessionId, null);  // No matching tier
},
```

---

## 5. Model Restoration: How Models are Restored on Re-entry

### 5.1 Restoration Entry Points

There are **THREE** restoration paths:

#### Path A: Initial Session Load (Cold Start)

```
createNewSession() → use-session-store.ts:820-914
  ↓
If prevSessionId exists (creating new session from existing):
  - Copy prevTierModels to new session
  - Copy prevTier to new session
  - Call agent.setModel to apply the same model
  - Save tier config to new session file
```

#### Path B: Session Re-entry (Hot/Cold Switch)

```
fetchInitialState(sessionId) → use-session-store.ts:1157-1641
  ↓
Step 1: agent.getState() → Gets current model from backend (line 1206-1222)
  - Sets currentModel = { provider, id, name }
  - Sets modelManuallySet = false (backend-supplied)

Step 2: agent.getAvailableModels() → Loads model list (line 1245-1260)

Step 3: Restore persisted tier config (line 1509-1546)
  - session.loadTierConfig(sessionPath)
  - Sets tierModels and currentTier from session file
  - Then calls syncTierFromModel to sync currentTier with currentModel
```

#### Path C: App Reconnection (WebSocket Reconnect)

```
apiClient.onReconnect() → use-session-store.ts:1933-2035
  ↓
agent.start() → use-session-store.ts:1962-1966
  ↓
fetchInitialState(activeSessionId) → Same as Path B
```

### 5.2 Persistence Mechanism

**RPC**: `session.saveTierConfig` / `session.loadTierConfig`

**Handler**: `src/shared/handlers/session.ts:239-295`

```typescript
r("session.saveTierConfig", async (params) => {
  const { sessionPath, tierModels, currentTier, currentModel } = params;
  // Writes a special entry to JSONL session file
  // Entry type: "tier_config" (or similar)
});

r("session.loadTierConfig", async (params) => {
  const { sessionPath } = params;
  // Reads JSONL session file
  // Finds the last "tier_config" entry
  // Returns { tierModels, currentTier, currentModel }
});
```

### 5.3 Sync Order on Restoration

The restoration follows this **priority order**:

1. **Backend state** (`agent.getState`) - Source of truth for `currentModel`
2. **Persisted tier config** (`session.loadTierConfig`) - Restores `tierModels` and `currentTier`
3. **Sync step** (`syncTierFromModel`) - Aligns `currentTier` with `currentModel`

```typescript
// From use-session-store.ts:1515-1546
Promise.all([statePromise, tierPromise, persistedTierPromise]).then(
  ([rawState, rawTier, rawPersisted]) => {
    // 1. Load global tier defaults from backend
    const tierResult = rawTier as { models: Record<string, string> };
    if (tierResult?.models) {
      useTierStore.getState().setGlobalDefaults(tierResult.models);
    }

    // 2. Load persisted session-specific tier config
    const persisted = rawPersisted as {
      config: { tierModels: Record<string, string>; currentTier: string | null } | null;
    };
    if (persisted.config) {
      useTierStore.getState().setSessionTierModels(sessionId, persisted.config.tierModels);
      useTierStore.getState().setSessionCurrentTier(sessionId, persisted.config.currentTier);
    }

    // 3. Sync currentTier with currentModel from backend
    const stateResult = rawState as AgentStateResult;
    if (stateResult?.model) {
      useTierStore
        .getState()
        .syncTierFromModel(sessionId, stateResult.model.provider ?? "", stateResult.model.id ?? "");
    }
  },
);
```

---

## 6. Data Structures

### 6.1 ModelInfo Interface

**Location**: `use-session-store.ts:106-110`

```typescript
export interface ModelInfo {
  provider: string; // e.g., "openai", "anthropic"
  id: string; // e.g., "gpt-4o", "claude-3-5-sonnet"
  name?: string; // Display name (optional)
}
```

### 6.2 AvailableModels Array

**Location**: `use-session-store.ts:149-156`

```typescript
availableModels: Array<{
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
  input: ("text" | "image")[]; // Supported input types
}>;
```

### 6.3 Session State (Model-related fields)

**Location**: `use-session-store.ts:145-158`

```typescript
interface SessionState {
  currentModel: ModelInfo | null; // Currently selected model
  modelManuallySet: boolean; // User manually selected vs backend default
  currentThinkingLevel: string; // Thinking level (not persisted)
  availableModels: Array<ModelItem>; // List of available models
  modelFavorites: Set<string>; // Favorite model keys

  // Actions
  setCurrentModel: (provider: string, modelId: string) => void;
  setThinkingLevel: (level: string) => void;
  fetchModelState: (sessionId: string) => void;
  toggleModelFavorite: (modelKey: string) => void;
}
```

### 6.4 Tier State

**Location**: `use-tier-store.ts:8-34`

```typescript
type TierKey = "fast" | "pro" | "max";

interface TierSessionData {
  tierModels: Record<string, string>; // { fast: "openai/gpt-4o-mini", ... }
  currentTier: TierKey | null;
}

interface TierState {
  globalDefaults: Record<string, string>; // Backend defaults
  dataBySession: Record<string, TierSessionData>; // Per-session overrides

  // Actions
  getTierModels: (sessionId: string) => Record<string, string>;
  getCurrentTier: (sessionId: string) => TierKey | null;
  setSessionTierModels: (sessionId: string, models: Record<string, string>) => void;
  setSessionCurrentTier: (sessionId: string, tier: TierKey | null) => void;
  syncTierFromModel: (sessionId: string, provider: string, modelId: string) => void;
  switchToTier: (tier: TierKey, sessionId: string) => Promise<void>;
  fetchTierConfig: (sessionId: string) => Promise<void>;
}
```

---

## 7. Key Code Snippets

### 7.1 Model Selection Handler (SidebarBottomControls.tsx:267-288)

```typescript
const handleSelectModel = useCallback(
  async (key: string) => {
    if (!activeSessionId || switching) return;
    const [provider, ...rest] = key.split("/");
    const modelId = rest.join("/");
    if (currentModel?.id === modelId && currentModel?.provider === provider) return;

    setSwitching(true);
    try {
      // RPC call to backend
      await apiClient.call("agent.setModel", {
        sessionId: activeSessionId,
        provider,
        modelId,
      });

      // Update frontend store
      setCurrentModel(provider, modelId);

      // Derive currentTier from selected model
      useTierStore.getState().syncTierFromModel(activeSessionId ?? "", provider, modelId);
    } catch (err) {
      console.warn("[SidebarControls] setModel failed:", err);
    }
    setSwitching(false);
  },
  [activeSessionId, switching, currentModel, setCurrentModel],
);
```

### 7.2 Tier Switch Handler (use-tier-store.ts:106-128)

```typescript
switchToTier: async (tier, sessionId) => {
  set({ switching: true });
  try {
    // RPC call with tier name (backend resolves to actual model)
    const result = await apiClient.call("agent.setModel", {
      sessionId,
      provider: "",
      modelId: tier,
    });

    // Update currentTier
    get().setSessionCurrentTier(sessionId, tier);

    // Update currentModel from resolved result
    const model = result as { provider: string; id: string };
    useSessionStore.getState().setCurrentModel(
      model.provider ?? "",
      model.id ?? "",
    );

    // Persist to session file
    get().savePersistedConfigForSession(sessionId);
  } catch (err) {
    log.warn("tier switch failed, staying on current model", { tier, error: err });
  } finally {
    set({ switching: false });
  }
},
```

### 7.3 State Restoration (use-session-store.ts:1206-1222)

```typescript
statePromise.then((rawResult) => {
  const result = rawResult as AgentStateResult;
  if (!result) return;

  const cw = result.model?.contextWindow ?? 0;
  if (cw > 0) {
    get().updateSessionContext(sessionId, { contextWindow: cw });
  }

  if (result.model) {
    const manuallySet = get().modelManuallySet;
    set({
      currentModel: {
        provider: result.model.provider ?? "",
        id: result.model.id,
        name: result.model.name,
      },
      modelManuallySet: false,  // Reset: now backend-supplied
    });

    if (manuallySet) {
      log.info("skipped model overwrite (user manually switched)", {
        sessionId,
        manualModel: `${result.model.provider}/${result.model.id}`,
      });
    }
  }
}),
```

### 7.4 Thinking Level Selection (SidebarBottomControls.tsx:290-310)

```typescript
const handleSelectThinking = useCallback(
  async (level: ThinkingLevel) => {
    if (!activeSessionId || switching || currentThinkingLevel === level) {
      setThinkingOpen(false);
      return;
    }
    setSwitching(true);
    try {
      // RPC call to backend
      await apiClient.call("agent.setThinkingLevel", {
        sessionId: activeSessionId,
        level,
      });

      // Update frontend store (in-memory only)
      setThinkingLevel(level);
    } catch (err) {
      console.warn("[SidebarControls] setThinkingLevel failed:", err);
    }
    setSwitching(false);
    setThinkingOpen(false);
  },
  [activeSessionId, switching, currentThinkingLevel, setThinkingLevel],
);
```

---

## 8. Summary: Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  SidebarBottomControls (UI)                                      │
│  ├─ ModelPickerButton → Select specific model                  │
│  ├─ Tier Buttons (Fast/Pro/Max) → Select tier                  │
│  └─ Thinking Level Dropdown → Select thinking level            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND STORE LAYER                        │
├─────────────────────────────────────────────────────────────────┤
│  use-session-store.ts                                            │
│  ├─ currentModel: { provider, id, name }                        │
│  ├─ modelManuallySet: boolean                                   │
│  ├─ currentThinkingLevel: string (in-memory)                   │
│  ├─ availableModels: Array<{provider, id, name, ...}>          │
│  └─ Actions: setCurrentModel, setThinkingLevel, fetchModelState│
│                                                                  │
│  use-tier-store.ts                                               │
│  ├─ tierModels: { fast, pro, max }                              │
│  ├─ currentTier: "fast" | "pro" | "max" | null                 │
│  └─ Actions: switchToTier, syncTierFromModel                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      RPC HANDLER LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│  src/shared/handlers/agent.ts                                     │
│  ├─ agent.getAvailableModels → process-manager.getAvailableModels│
│  ├─ agent.getModel → process-manager.getModel                   │
│  ├─ agent.setModel → process-manager.setModel                   │
│  ├─ agent.setThinkingLevel → process-manager.setThinkingLevel   │
│  └─ agent.getTierModels → process-manager.getTierModels         │
│                                                                  │
│  src/shared/handlers/session.ts                                   │
│  ├─ session.saveTierConfig → Persist tier config to JSONL       │
│  └─ session.loadTierConfig → Load tier config from JSONL        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND PROCESS LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│  src/shared/agent/process-manager.ts                              │
│  ├─ getAvailableModels() → SandboxRpcClient.getAvailableModels()│
│  ├─ setModel(provider, modelId) → SandboxRpcClient.setModel()    │
│  ├─ setThinkingLevel(level) → SandboxRpcClient.setThinkingLevel()│
│  └─ getTierModels() → Returns { models: { fast, pro, max } }    │
│                                                                  │
│  src/sandbox/sandbox-rpc-client.ts                                │
│  └── RPC client that talks to CLI SandboxAgent                   │
│                                                                  │
│  src/sandbox/sandbox-agent.ts                                    │
│  └── CLI-side agent (get_available_models, set_model, ...)       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│  Session JSONL File                                              │
│  ├─ Normal message entries (user/assistant/...)                 │
│  └─ Special tier_config entry (tierModels, currentTier, ...)     │
│                                                                  │
│  Backend Memory                                                  │
│  └─ Agent process maintains current model in memory              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Key Findings

1. **Thinking Level is NOT persisted**: `currentThinkingLevel` is only in-memory and resets to "medium" on app restart
2. **Model Selection has dual paths**: Direct model selection vs tier selection
3. **Tier config is persisted**: Tier models and current tier are saved to session JSONL file
4. **Restoration order matters**: Backend state → Persisted tier config → Sync step
5. **Manual selection flag**: `modelManuallySet` prevents backend from overwriting user-selected models
6. **Fast/Medium/Thinking levels are different concepts**:
   - **Fast/Pro/Max**: Tiers (model selection presets)
   - **Thinking levels**: Fine-grained reasoning depth (off/minimal/low/medium/high/xhigh)
7. **Model-to-tier sync**: When you select a model directly, the system checks if it matches a configured tier and updates currentTier accordingly
