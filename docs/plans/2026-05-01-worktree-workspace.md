# Worktree Workspace 交互功能 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在左侧边栏底部新增 Workspace 选择器，支持查看/切换/新建 worktree workspace，并在 session 列表中展示每个 session 所属的 workspace 标识。

**Architecture:** 分 5 个独立任务逐步增强：RPC 接口 → Store 层 → SidebarBottomControls 新增 Workspace 选择器 → SessionItem 展示 workspace 标识 → createNewSession 改用当前 workspace 路径。

**Tech Stack:** React 18, Zustand, TypeScript, Tailwind CSS, lucide-react, Bun

---

## Task 1: 新增 `git.worktreeAdd` RPC 接口与 Handler

**目标:** 提供创建 worktree 的后端能力。

**Files:**
- Modify: `src/shared/modules/git.ts`
- Modify: `src/shared/handlers/git.ts`

**Step 1: 在 `src/shared/modules/git.ts` 的 `GitMethods` 中添加类型定义**

在 `"git.worktreeList"` 定义之后（约 line 75）添加：

```ts
"git.worktreeAdd": {
  params: { repoPath: string; branch: string; sourceBranch?: string };
  result: { worktree: { path: string; branch: string; isMain: boolean } };
};
```

**Step 2: 在 `src/shared/handlers/git.ts` 的 `registerGitHandlers` 末尾（`git.worktreeList` 之后，约 line 304）添加 handler**

```ts
r("git.worktreeAdd", async (params) => {
  const repoRoot = getRepoRoot(params.repoPath);
  const repoDir = dirname(repoRoot);
  const newDir = join(repoDir, `${basename(repoRoot)}-${params.branch}`);
  const args = ["worktree", "add", newDir, "-b", params.branch];
  if (params.sourceBranch) {
    args.push(params.sourceBranch);
  }
  execGit(args, repoRoot);
  return {
    worktree: {
      path: newDir,
      branch: params.branch,
      isMain: false,
    },
  };
});
```

在文件顶部需要引入：
```ts
import { dirname, basename, join } from "path";
```

**Step 3: 验证**

启动 dev server，确认无编译错误。

**Step 4: Commit**

```bash
git add src/shared/modules/git.ts src/shared/handlers/git.ts
git commit -m "feat: add git.worktreeAdd RPC endpoint"
```

---

## Task 2: Store 层 — use-git-store 增加 `addWorktree` action

**目标:** 封装 `git.worktreeAdd` RPC 调用，创建成功后自动更新 `worktrees` 列表。

**Files:**
- Modify: `src/mainview/stores/use-git-store.ts`

**Step 1: 在 `GitState` interface 中添加 action 签名**

在 `fetchWorktrees` 声明之后（约 line 65）添加：

```ts
addWorktree: (repoPath: string, branch: string, sourceBranch?: string) => Promise<GitWorktree>;
```

**Step 2: 在 store 实现中添加 `addWorktree`**

在 `fetchWorktrees` 实现之后（约 line 293）添加：

```ts
addWorktree: async (repoPath, branch, sourceBranch) => {
  const addLog = useAppStore.getState().addLog;
  try {
    const res = await apiClient.call("git.worktreeAdd", { repoPath, branch, sourceBranch });
    set((s) => ({ worktrees: [...s.worktrees, res.worktree] }));
    return res.worktree;
  } catch (err) {
    addLog(`Git worktreeAdd error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
},
```

**Step 3: 验证编译通过**

**Step 4: Commit**

```bash
git add src/mainview/stores/use-git-store.ts
git commit -m "feat: add addWorktree action to git store"
```

---

## Task 3: SidebarBottomControls 新增 Workspace 选择器

**目标:** 在模型和思考选择器上方新增 Workspace 展示区，显示当前 session 所属的 workspace 名字和路径，支持下拉切换和新建。

**Files:**
- Modify: `src/mainview/components/left-sidebar/SidebarBottomControls.tsx`

**Step 1: 在组件中添加 Workspace 状态和数据获取**

在 `SidebarBottomControls` 组件内部（约 line 57-65 之间），添加：

```ts
const activeSessionId = useSessionStore((s) => s.activeSessionId);
const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
const projectTabs = useSessionStore((s) => s.projectTabs);
const activeProjectId = useSessionStore((s) => s.activeProjectId);
const addProjectTab = useSessionStore((s) => s.addProjectTab);
const createNewSession = useSessionStore((s) => s.createNewSession);

const worktrees = useGitStore((s) => s.worktrees);
const fetchWorktrees = useGitStore((s) => s.fetchWorktrees);
const addWorktreeAction = useGitStore((s) => s.addWorktree);

const [workspaceOpen, setWorkspaceOpen] = useState(false);
const [showCreateDialog, setShowCreateDialog] = useState(false);
const [newBranch, setNewBranch] = useState("");
const [sourceBranch, setSourceBranch] = useState("");
const [creating, setCreating] = useState(false);
const workspaceRef = useRef<HTMLDivElement>(null);
```

注意：原有的 `activeSessionId` 声明需要合并/移除（因为上面已声明）。

**Step 2: 计算 currentWorkspace**

```ts
const currentTab = projectTabs.find((t) => t.id === activeProjectId);
const activeTabPath = currentTab?.path ?? "";

const currentSession = useMemo(() => {
  if (!activeSessionId) return null;
  for (const sessions of Object.values(sessionsByProject)) {
    const found = sessions.find((s) => s.sessionId === activeSessionId);
    if (found) return found;
  }
  return null;
}, [activeSessionId, sessionsByProject]);

const currentWorkspace = useMemo(() => {
  if (!currentSession) return worktrees[0] ?? null;
  return (
    worktrees.find((wt) => currentSession.projectPath.startsWith(wt.path)) ??
    worktrees[0] ??
    null
  );
}, [currentSession, worktrees]);

const workspaceName = currentWorkspace
  ? currentWorkspace.isMain
    ? basename(currentWorkspace.path)
    : currentWorkspace.branch
  : "未加载";
const workspacePath = currentWorkspace?.path ?? "";
```

**Step 3: 添加 worktrees 初始化加载和点击外部关闭逻辑**

在已有的 `useEffect` 块附近添加：

```ts
useEffect(() => {
  if (activeTabPath && worktrees.length === 0) {
    fetchWorktrees(activeTabPath);
  }
}, [activeTabPath, worktrees.length, fetchWorktrees]);

useEffect(() => {
  if (!workspaceOpen) return;
  const handleClick = (e: MouseEvent) => {
    if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) setWorkspaceOpen(false);
  };
  const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setWorkspaceOpen(false); };
  document.addEventListener("mousedown", handleClick);
  document.addEventListener("keydown", handleKey);
  return () => {
    document.removeEventListener("mousedown", handleClick);
    document.removeEventListener("keydown", handleKey);
  };
}, [workspaceOpen]);
```

**Step 4: 添加切换 workspace 和创建 workspace 的 handler**

```ts
const handleSwitchWorkspace = useCallback((wt: { path: string; branch: string }) => {
  const tab = projectTabs.find((t) => t.path === wt.path);
  if (tab) {
    useSessionStore.getState().setActiveProjectId(tab.id);
    const sessions = sessionsByProject[wt.path];
    if (sessions && sessions.length > 0) {
      useSessionStore.getState().setActiveSession(sessions[0].sessionId);
    }
  }
  setWorkspaceOpen(false);
}, [projectTabs, sessionsByProject]);

const handleCreateWorktree = useCallback(async () => {
  if (!newBranch.trim() || !activeTabPath || creating) return;
  setCreating(true);
  try {
    const wt = await addWorktreeAction(activeTabPath, newBranch.trim(), sourceBranch || undefined);
    addProjectTab({
      id: wt.path,
      name: wt.branch,
      path: wt.path,
      connected: false,
    });
    setShowCreateDialog(false);
    setNewBranch("");
    setSourceBranch("");
    setWorkspaceOpen(false);
    await createNewSession();
  } catch {
  }
  setCreating(false);
}, [newBranch, activeTabPath, sourceBranch, creating, addWorktreeAction, addProjectTab, createNewSession]);
```

注意：需要确认 `setActiveProjectId` 是否存在。如果不存在，需要改用 `addProjectTab` 或其他方式来切换。参见 Task 5。

**Step 5: 在 JSX 的 return 中，在模型选择器上方添加 Workspace 选择器 UI**

在 `<div className="shrink-0 border-t ...">` 内部、`modelRef` div 之前插入：

```tsx
<div className="relative" ref={workspaceRef}>
  <button
    onClick={() => { setWorkspaceOpen(!workspaceOpen); setModelOpen(false); setThinkingOpen(false); }}
    disabled={!activeSessionId}
    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-300 transition-colors disabled:opacity-40"
  >
    <FolderTree className="w-3 h-3 shrink-0 text-gray-500" />
    <div className="flex flex-col min-w-0 flex-1 text-left">
      <span className="truncate">{workspaceName}</span>
      <span className="text-[10px] text-gray-600 truncate">{workspacePath}</span>
    </div>
    <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${workspaceOpen ? "rotate-180" : ""}`} />
  </button>
  {workspaceOpen && (
    <div className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-64 overflow-hidden bg-gray-800 border border-gray-600 rounded-md shadow-xl flex flex-col">
      <div className="overflow-y-auto flex-1 py-1">
        {worktrees.map((wt) => {
          const isActive = currentWorkspace?.path === wt.path;
          const name = wt.isMain ? basename(wt.path) : wt.branch;
          return (
            <button
              key={wt.path}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                isActive ? "bg-indigo-500/15 text-indigo-300" : "text-gray-200 hover:bg-gray-700"
              }`}
              onClick={() => handleSwitchWorkspace(wt)}
            >
              {isActive ? <Check className="w-3 h-3 shrink-0 text-indigo-400" /> : <span className="w-3 shrink-0" />}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate">{name}</span>
                <span className="text-[10px] text-gray-500 truncate">{wt.path}</span>
              </div>
              {!wt.isMain && <GitBranch className="w-3 h-3 shrink-0 text-cyan-500/60" />}
            </button>
          );
        })}
      </div>
      <div className="border-t border-gray-700/60">
        <button
          className="w-full text-left px-3 py-1.5 text-xs text-cyan-400 hover:bg-gray-700 flex items-center gap-2 transition-colors"
          onClick={() => { setShowCreateDialog(true); setSourceBranch(currentWorkspace?.branch ?? ""); }}
        >
          <Plus className="w-3 h-3 shrink-0" />
          <span>新建 Workspace...</span>
        </button>
      </div>
    </div>
  )}
  {showCreateDialog && (
    <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-gray-800 border border-gray-600 rounded-md shadow-xl p-3 space-y-2">
      <div className="text-xs font-medium text-gray-200">新建 Workspace</div>
      <div className="space-y-1.5">
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">基于分支</label>
          <select
            value={sourceBranch}
            onChange={(e) => setSourceBranch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none"
          >
            {worktrees.map((wt) => (
              <option key={wt.path} value={wt.branch}>{wt.branch}{wt.isMain ? " (主)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">新分支名</label>
          <input
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="feature-xxx"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => { setShowCreateDialog(false); setNewBranch(""); }}
          className="px-2 py-1 rounded text-xs text-gray-400 hover:bg-gray-700"
        >取消</button>
        <button
          onClick={handleCreateWorktree}
          disabled={!newBranch.trim() || creating}
          className="px-2 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
        >{creating ? "创建中..." : "创建"}</button>
      </div>
    </div>
  )}
</div>
```

**Step 6: 添加必要的 import**

在文件顶部 import 中添加：

```ts
import { FolderTree, GitBranch, Plus } from "lucide-react";
import { useGitStore } from "../../stores/use-git-store";
```

同时确保 `ChevronDown`, `Check` 已在 import 中（`Check` 可能需要添加）。

**Step 7: 验证编译通过**

**Step 8: Commit**

```bash
git add src/mainview/components/left-sidebar/SidebarBottomControls.tsx
git commit -m "feat: add Workspace selector to sidebar bottom controls"
```

---

## Task 4: SessionItem 展示 workspace 标识

**目标:** 在每个 session item 的状态 badge 旁，显示其所属 workspace 的名字。非主 workspace 加小图标区分。

**Files:**
- Modify: `src/mainview/components/session-sidebar/SessionSidebar.tsx`

**Step 1: 修改 `WorktreeBranchBadge` 组件**

将现有的 `WorktreeBranchBadge`（约 line 208-215）改为展示 workspace 名字而非分支名：

```tsx
function WorkspaceBadge({ workspace }: { workspace: GitWorktree }) {
  const name = workspace.isMain ? basename(workspace.path) : workspace.branch;
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
      {!workspace.isMain && <GitBranch className="w-2.5 h-2.5" />}
      {name}
    </span>
  );
}
```

**Step 2: 更新 SessionItem 中的引用**

将 `SessionItem` 中的 `worktreeInfo` 逻辑（约 line 267-270）改为查找所有 worktree（包括主 worktree）：

```tsx
const workspaceInfo = useMemo(
  () => worktrees.find((wt) => session.projectPath.startsWith(wt.path)) ?? worktrees[0] ?? null,
  [worktrees, session.projectPath]
);
```

将 line 379 的引用从：
```tsx
{worktreeInfo && <WorktreeBranchBadge branch={worktreeInfo.branch} />}
```
改为：
```tsx
{workspaceInfo && !workspaceInfo.isMain && <WorkspaceBadge workspace={workspaceInfo} />}
```

只在非主 workspace 时显示 badge，主 workspace 不显示额外标识。

**Step 3: 验证编译通过**

**Step 4: Commit**

```bash
git add src/mainview/components/session-sidebar/SessionSidebar.tsx
git commit -m "feat: show workspace badge on session items"
```

---

## Task 5: createNewSession 基于当前 workspace 创建

**目标:** 点 `+` 新建会话时，基于当前选中 session 的 workspace 路径创建，而非固定用 `tab.path`。

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts`
- Modify: `src/mainview/components/left-sidebar/LeftSidebar.tsx`

**Step 1: 修改 `createNewSession` 接受可选的 projectPath 参数**

在 `src/mainview/stores/use-session-store.ts` 中，修改 `createNewSession` 签名（约 line 73 的 interface）：

```ts
// 修改前
createNewSession: () => Promise<void>;

// 修改后
createNewSession: (projectPath?: string) => Promise<void>;
```

修改实现（约 line 605）：

```ts
createNewSession: async (projectPath?: string) => {
  const { projectTabs, activeProjectId } = get();
  const tab = projectTabs.find((t) => t.id === activeProjectId);
  if (!tab) return;

  const targetPath = projectPath ?? tab.path;

  try {
    const result = await apiClient.call("session.create", { projectPath: targetPath });

    const now = Date.now();
    const newSession: SessionMeta = {
      sessionId: result.sessionId,
      name: "",
      sessionPath: result.sessionPath,
      projectPath: targetPath,
      parentSessionPath: null,
      messageCount: 0,
      firstMessage: "",
      createdAt: now,
      updatedAt: now,
      status: "idle",
    };

    set((s) => ({
      sessionsByProject: {
        ...s.sessionsByProject,
        [targetPath]: [newSession, ...(s.sessionsByProject[targetPath] || [])],
      },
    }));

    get().setActiveSession(result.sessionId);
  } catch {
    useAppStore.getState().addLog("Failed to create session");
  }
},
```

**Step 2: 在 LeftSidebar 的 `+` 按钮中传入当前 workspace 路径**

修改 `src/mainview/components/left-sidebar/LeftSidebar.tsx` 中 `+` 按钮的 onClick：

```tsx
// 修改前
onClick={(e) => { e.stopPropagation(); useSessionStore.getState().createNewSession(); }}

// 修改后
onClick={(e) => {
  e.stopPropagation();
  const state = useSessionStore.getState();
  const worktrees = useGitStore.getState().worktrees;
  const activeSession = state.activeSessionId
    ? Object.values(state.sessionsByProject)
        .flat()
        .find((s) => s.sessionId === state.activeSessionId)
    : null;
  const workspace = activeSession
    ? worktrees.find((wt) => activeSession.projectPath.startsWith(wt.path))
    : null;
  state.createNewSession(workspace?.path);
}}
```

添加 import：
```ts
import { useGitStore } from "../../stores/use-git-store";
```

**Step 3: 验证编译通过**

**Step 4: Commit**

```bash
git add src/mainview/stores/use-session-store.ts src/mainview/components/left-sidebar/LeftSidebar.tsx
git commit -m "feat: create session in current workspace context"
```

---

## 实现顺序与依赖

```
Task 1 (RPC) → Task 2 (Store) → Task 3 (UI: Workspace 选择器)
                             → Task 4 (UI: Session badge)
                             → Task 5 (createNewSession 改造)
```

Task 3、4、5 可以并行开发，但都依赖 Task 1 + Task 2。
