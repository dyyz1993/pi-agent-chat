# Session Resource Leak Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix WebSocket subscription and frontend data leaks when switching sessions/tabs, so resources from old sessions are properly released.

**Architecture:** Extract a unified `cleanupSession(sessionId)` function that unsubscribes all WebSocket subscriptions and clears all store data for a given session. Call it from every session-switch and tab-switch path. The backend agent instance stays running (only frontend resources are cleaned up).

**Tech Stack:** Zustand stores, WebSocket RPC subscriptions (`@dyyz1993/rpc-core`)

**Verification:** Use the Diagnostic Panel (`Ctrl+Shift+D`) + ui-tester subagent to confirm subscriptions stay at ~16 after switching.

---

### Task 1: Create `cleanupSession()` utility function

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:42-90` (add function near `setupSubscriptions`)

**Step 1: Add `cleanupSession` function after `setupSubscriptions`**

Insert after line 376 (after the closing `}` of `setupSubscriptions`):

```typescript
function cleanupSession(state: SessionState, sessionId: string): void {
  const allSubMaps: Array<Record<string, string>> = [
    state.agentSubscriptions,
    state.subagentSubscriptions,
    state.todoSubscriptions,
    state.bashSubscriptions,
    state.lspSubscriptions,
    state.rulesSubscriptions,
    state.notifySubscriptions,
  ];

  for (const map of allSubMaps) {
    const subId = map[sessionId];
    if (subId) {
      apiClient.unsubscribe(subId);
    }
  }

  const memSubIds = state.memorySubscriptions[sessionId];
  if (memSubIds && Array.isArray(memSubIds)) {
    for (const subId of memSubIds) {
      apiClient.unsubscribe(subId);
    }
  }
}

function cleanupSessionData(sessionId: string): void {
  useChatStore.getState().clearSessionMessages(sessionId);
  useTurnStore.getState().clearSessionUI(sessionId);
  useChatNavStore.getState().clearSessionUI(sessionId);
  useMemoryStore.getState().clearSession(sessionId);
  useRulesStore.getState().clearSession(sessionId);
  useBashStore.getState().clearSession(sessionId);
  useLspStore.getState().clearSession(sessionId);
  useSubagentStore.getState().setActiveSubsession(sessionId, null);
}
```

**Step 2: Add helper to clear subscription IDs from store state**

```typescript
function clearSubscriptionState(state: SessionState, sessionId: string): Partial<SessionState> {
  return {
    agentSubscriptions: (() => { const { [sessionId]: _, ...rest } = state.agentSubscriptions; return rest; })(),
    subagentSubscriptions: (() => { const [sessionId]: _, ...rest } = state.subagentSubscriptions; return rest; })(),
    todoSubscriptions: (() => { const { [sessionId]: _, ...rest } = state.todoSubscriptions; return rest; })(),
    bashSubscriptions: (() => { const { [sessionId]: _, ...rest } = state.bashSubscriptions; return rest; })(),
    lspSubscriptions: (() => { const { [sessionId]: _, ...rest } = state.lspSubscriptions; return rest; })(),
    rulesSubscriptions: (() => { const { [sessionId]: _, ...rest } = state.rulesSubscriptions; return rest; })(),
    notifySubscriptions: (() => { const { [sessionId]: _, ...rest } = state.notifySubscriptions; return rest; })(),
    memorySubscriptions: (() => { const { [sessionId]: _, ...rest } = state.memorySubscriptions; return rest; })(),
    sessionReady: (() => { const { [sessionId]: _, ...rest } = state.sessionReady; return rest; })(),
  };
}
```

NOTE: The destructuring above has a typo for `subagentSubscriptions` line — when implementing, use consistent pattern:
```typescript
const { [sessionId]: _agentSub, ...restAgent } = state.agentSubscriptions;
const { [sessionId]: _subagentSub, ...restSubagent } = state.subagentSubscriptions;
// ... etc
return { agentSubscriptions: restAgent, subagentSubscriptions: restSubagent, ... };
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "feat: add cleanupSession and cleanupSessionData utilities"
```

---

### Task 2: Fix `setActiveSession` — clean up OLD session before switching

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:488-501`

**Step 1: Replace the cleanup block in `setActiveSession`**

Current code (lines 488-501):
```typescript
setActiveSession: (id, force) => {
  const prevId = get().activeSessionId;
  if (!force && prevId === id) return;

  const sid = id ?? "";
  useRulesStore.getState().clearSession(sid);
  useMemoryStore.getState().clearSession(sid);
  useBashStore.getState().clearSession(sid);
  useLspStore.getState().clearSession(sid);

  set({
    activeSessionId: id,
    sessionReady: id ? { ...get().sessionReady, [id]: false } : get().sessionReady,
  });
  if (!id) return;
```

Replace with:
```typescript
setActiveSession: (id, force) => {
  const prevId = get().activeSessionId;
  if (!force && prevId === id) return;

  if (prevId && prevId !== id) {
    cleanupSession(get(), prevId);
    cleanupSessionData(prevId);
    set((s) => clearSubscriptionState(s, prevId));
  }

  set({
    activeSessionId: id,
    sessionReady: id ? { ...get().sessionReady, [id]: false } : get().sessionReady,
  });
  if (!id) return;
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "fix: release old session subscriptions and data on session switch"
```

---

### Task 3: Fix `setActiveProject` — clean up old project's session before switching tabs

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:439-469`

**Step 1: Add cleanup at the start of `setActiveProject`**

Current code starts at line 439:
```typescript
setActiveProject: (id) => {
  const version = get()._projectVersion + 1;
  set({ activeProjectId: id, _projectVersion: version });
  const tabs = get().projectTabs;
  // ...
```

Replace with:
```typescript
setActiveProject: (id) => {
  const prevProjectId = get().activeProjectId;
  const prevSessionId = get().activeSessionId;

  if (prevProjectId && prevProjectId !== id && prevSessionId) {
    cleanupSession(get(), prevSessionId);
    cleanupSessionData(prevSessionId);
    set((s) => clearSubscriptionState(s, prevSessionId));
  }

  const version = get()._projectVersion + 1;
  set({ activeProjectId: id, _projectVersion: version });
  const tabs = get().projectTabs;
  // ... rest unchanged
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "fix: release old session resources on project tab switch"
```

---

### Task 4: Fix `removeProjectTab` — clean up closed tab's sessions

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:425-437`

**Step 1: Add cleanup before removing the tab**

Current code:
```typescript
removeProjectTab: (id) =>
  set((s) => {
    const filtered = s.projectTabs.filter((t) => t.id !== id);
    const newActiveId =
      s.activeProjectId === id
        ? filtered[filtered.length - 1]?.id ?? null
        : s.activeProjectId;
    syncTabsToBackend(filtered, newActiveId);
    return {
      projectTabs: filtered,
      activeProjectId: newActiveId,
    };
  }),
```

Replace with:
```typescript
removeProjectTab: (id) => {
  const state = get();
  if (state.activeProjectId === id && state.activeSessionId) {
    cleanupSession(state, state.activeSessionId);
    cleanupSessionData(state.activeSessionId);
    set((s) => clearSubscriptionState(s, state.activeSessionId!));
  }

  set((s) => {
    const filtered = s.projectTabs.filter((t) => t.id !== id);
    const newActiveId =
      s.activeProjectId === id
        ? filtered[filtered.length - 1]?.id ?? null
        : s.activeProjectId;
    syncTabsToBackend(filtered, newActiveId);
    return {
      projectTabs: filtered,
      activeProjectId: newActiveId,
    };
  });
},
```

NOTE: This changes from arrow function returning `set()` to a regular function body. Make sure the method signature in the interface stays `removeProjectTab: (id: string) => void;`.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "fix: release session resources when closing project tab"
```

---

### Task 5: Fix `deleteSession` — unsubscribe before deleting

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:675-703`

**Step 1: Add cleanup call in `deleteSession`**

Current code starts:
```typescript
deleteSession: (sessionId) => {
  const { sessionsByProject, activeSessionId } = get();
```

Replace with:
```typescript
deleteSession: (sessionId) => {
  cleanupSession(get(), sessionId);
  cleanupSessionData(sessionId);
  set((s) => clearSubscriptionState(s, sessionId));

  const { sessionsByProject, activeSessionId } = get();
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "fix: unsubscribe and clean up data when deleting a session"
```

---

### Task 6: Fix `handleSelectProject` in App.tsx — also unsubscribe

**Files:**
- Modify: `src/mainview/App.tsx:140-153`

**Step 1: Add `cleanupSession` call before the existing cleanup block**

Current:
```typescript
const prevSessionId = useSessionStore.getState().activeSessionId;
if (prevSessionId) {
  useChatStore.getState().clearSessionMessages(prevSessionId);
  // ... 7 more cleanup lines
}
```

Replace with:
```typescript
const prevSessionId = useSessionStore.getState().activeSessionId;
if (prevSessionId) {
  cleanupSession(useSessionStore.getState(), prevSessionId);
  set((s) => clearSubscriptionState(s, prevSessionId));
  cleanupSessionData(prevSessionId);
}
```

NOTE: This requires importing the functions. Add to imports at the top of `use-session-store.ts` — but since they're module-level functions (not exported), we need a different approach. **Instead, expose a single public method on the store:**

Add to the `SessionState` interface (around line 70):
```typescript
cleanupActiveSession: (sessionId: string) => void;
```

Add the implementation in the store:
```typescript
cleanupActiveSession: (sessionId: string) => {
  cleanupSession(get(), sessionId);
  cleanupSessionData(sessionId);
  set((s) => clearSubscriptionState(s, sessionId));
},
```

Then in `App.tsx`, replace the block with:
```typescript
const prevSessionId = useSessionStore.getState().activeSessionId;
if (prevSessionId) {
  useSessionStore.getState().cleanupActiveSession(prevSessionId);
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts src/mainview/App.tsx
git commit -m "fix: use unified cleanup in handleSelectProject"
```

---

### Task 7: Fix `onReconnect` — unsubscribe old subscriptions before resetting

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:940-954`

**Step 1: Add cleanup before resetting subscription maps**

Current:
```typescript
apiClient.onReconnect(() => {
  const state = useSessionStore.getState();
  // ...
  useSessionStore.setState({
    agentSubscriptions: {},
    // ...
  });
```

Replace the reset block with:
```typescript
apiClient.onReconnect(() => {
  const state = useSessionStore.getState();

  for (const [sessionId] of Object.entries(state.agentSubscriptions)) {
    cleanupSession(state, sessionId);
  }

  useSessionStore.setState({
    agentSubscriptions: {},
    // ... rest unchanged
  });
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "fix: unsubscribe stale subscriptions on WebSocket reconnect"
```

---

### Task 8: Fix `toolCallNameMap` unbounded growth

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:42`

**Step 1: Clear toolCallNameMap when cleaning up a session**

In the `cleanupSession` function from Task 1, add at the end:

```typescript
function cleanupSession(state: SessionState, sessionId: string): void {
  // ... existing unsubscribe logic ...

  // Clean up toolCallNameMap entries that belong to this session's messages
  const msgs = useChatStore.getState().messagesBySession[sessionId] || [];
  const knownToolCallIds = new Set<string>();
  for (const msg of msgs) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolExecution" || block.type === "toolCall") {
          knownToolCallIds.add(block.toolCallId || block.id);
        }
      }
    }
  }
  for (const id of knownToolCallIds) {
    delete toolCallNameMap[id];
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "fix: clean up toolCallNameMap entries on session cleanup"
```

---

### Task 9: Add stale request guard for `setActiveSession`

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts:516-589` (the async chain in `setActiveSession`)

**Step 1: Add a version check after `ensureSession` resolves**

Inside the `.then((session) => {` callback (around line 517), add at the very start:

```typescript
ensureSession().then((session) => {
  if (get().activeSessionId !== id) return;
  if (!session) {
    // ... existing error handling
```

This prevents stale responses from overwriting the state if the user has already switched to another session.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mainview/stores/use-session-store.ts
git commit -m "fix: guard against stale session startup responses"
```

---

### Task 10: Verify fix with ui-tester

**No code changes — verification only**

**Step 1: Start the dev server (if not running)**

Run: `bun run dev:web`

**Step 2: Run ui-tester to verify the fix**

Use the ui-tester subagent with the same test plan as before:
1. Open http://localhost:5173
2. Open diagnostic panel (Ctrl+Shift+D)
3. Record baseline subscriptions
4. Switch to session 2 → verify subs stay ~16 (not 32)
5. Switch to session 3 → verify subs stay ~16 (not 48)
6. Switch back to session 1 → verify subs stay ~16
7. LeakDetector should show "No leaks detected" (green)

**Expected result:**
- Subscriptions stay constant at ~16 regardless of how many sessions are visited
- Data size stays constant (only current session loaded)
- LeakDetector shows green "No leaks detected"
- JS heap doesn't grow linearly

**Step 3: If verification passes, final commit**

```bash
git add -A
git commit -m "chore: session resource leak fix verified with diagnostic panel"
```
