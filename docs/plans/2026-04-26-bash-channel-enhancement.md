# Bash Channel UI Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完善 Bash Channel Extension 的前端实现，补齐文档中定义但 UI 缺失的功能。

**Architecture:** 分 8 个独立任务逐步增强：类型扩展 → 事件处理 → Tool Renderer 抽取 → Shell 面板增强 → 日志查看 → ANSI 渲染 → 前台恢复 → 集成测试。每个任务可独立提交，不依赖后续任务。

**Tech Stack:** React 18, Zustand, TypeScript, Tailwind CSS, lucide-react, Vite

---

## Task 1: 扩展 BashChannelCommand 和 BashProcess 类型

**目标:** 在类型层面补齐 `subscribe_output`、`unsubscribe_output` 命令支持，以及 `logPath` 字段和 `bash_background_exit` 自定义事件类型。

**Files:**
- Modify: `src/shared/modules/bash.ts`

**Step 1: 修改 BashChannelCommand 类型**

在 `src/shared/modules/bash.ts:24` 中，扩展 action 联合类型：

```ts
// 修改前
export interface BashChannelCommand {
  action: "list" | "kill" | "background";
  toolCallId?: string;
}

// 修改后
export interface BashChannelCommand {
  action: "list" | "kill" | "background" | "subscribe_output" | "unsubscribe_output";
  toolCallId?: string;
}
```

**Step 2: 扩展 BashProcess 增加 logPath**

在 `src/shared/modules/bash.ts:1-12` 的 `BashProcess` 接口中添加：

```ts
export interface BashProcess {
  toolCallId: string;
  command: string;
  cwd: string;
  pid?: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  output: string;
  status: "running" | "done" | "error" | "terminated" | "background";
  error?: string;
  logPath?: string;
}
```

**Step 3: 扩展 BashMethods 中 bash.command 的 action 类型**

在 `src/shared/modules/bash.ts:34` 中：

```ts
// 修改前
"bash.command": {
  params: { sessionId: string; action: "kill" | "background"; toolCallId?: string };
  result: { ok: boolean };
};

// 修改后
"bash.command": {
  params: { sessionId: string; action: "kill" | "background" | "subscribe_output" | "unsubscribe_output"; toolCallId?: string };
  result: { ok: boolean };
};
```

**Step 4: 添加 BashBackgroundExitEvent 类型**

在 `src/shared/modules/bash.ts` 文件末尾添加：

```ts
export interface BashBackgroundExitEvent {
  customType: "bash_background_exit";
  content: string;
  details: {
    pid?: number;
    command: string;
    exitCode: number | null;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    logPath?: string;
  };
  display: "info" | "warning";
}
```

**Step 5: Commit**

```bash
git add src/shared/modules/bash.ts
git commit -m "feat(bash): extend types for subscribe_output, logPath, and bash_background_exit"
```

---

## Task 2: 处理 bash_background_exit 事件

**目标:** 在 process-manager 和前端 store 中处理后台进程退出的 `custom_entry` 事件，更新 BashProcess 状态。

**Files:**
- Modify: `src/mainview/stores/use-session-store.ts` (custom_entry handler, ~line 796-825)
- Modify: `src/mainview/stores/use-bash-store.ts` (add backgroundExit handler)

**Step 1: 在 bash-store 中添加 handleBackgroundExit**

在 `src/mainview/stores/use-bash-store.ts` 的 `handleBashEvent` 函数后添加：

```ts
export function handleBackgroundExit(sessionId: string, data: import("../../shared/modules/bash").BashBackgroundExitEvent): void {
  const store = useBashStore.getState();
  const procs = store.processesBySession[sessionId] || [];
  const match = procs.find((p) =>
    p.status === "background" && data.details.command === p.command
    && Math.abs(p.startedAt - data.details.startedAt) < 5000,
  );
  if (!match) return;

  store.upsertProcess(sessionId, {
    ...match,
    status: data.details.exitCode === 0 ? "done" : "error",
    endedAt: data.details.endedAt,
    exitCode: data.details.exitCode,
    logPath: data.details.logPath,
    error: data.details.exitCode !== 0 ? data.content : undefined,
  });
}
```

**Step 2: 在 session-store 的 custom_entry handler 中路由 bash_background_exit**

在 `src/mainview/stores/use-session-store.ts:796` 的 `if (event.type === "custom_entry")` 分支中，在 `memoryStore.addEvent` 之后添加：

```ts
if (event.customType === "bash_background_exit") {
  handleBackgroundExit(sessionId, event.data as import("../../shared/modules/bash").BashBackgroundExitEvent);
}
```

同时确保在文件顶部 `import { handleBackgroundExit } from "./use-bash-store";` 已和现有的 `handleBashEvent` 一起导入（如果未导入则添加）。

**Step 3: 验证 import**

确认 `src/mainview/stores/use-session-store.ts` 顶部有：

```ts
import { handleBashEvent, handleBackgroundExit } from "./use-bash-store";
```

**Step 4: Commit**

```bash
git add src/mainview/stores/use-bash-store.ts src/mainview/stores/use-session-store.ts
git commit -m "feat(bash): handle bash_background_exit event to update process status"
```

---

## Task 3: 抽取 Bash Tool Renderer

**目标:** 将 MessageBubble.tsx 中硬编码的 bash 渲染逻辑抽取为独立的 `BashRenderer.tsx`，通过 tool-renderer 注册表注册。

**Files:**
- Create: `src/mainview/components/chat/tool-renderers/BashRenderer.tsx`
- Modify: `src/mainview/components/chat/tool-renderers/index.ts`
- Modify: `src/mainview/components/chat/MessageBubble.tsx`

**Step 1: 创建 BashRenderer.tsx**

创建 `src/mainview/components/chat/tool-renderers/BashRenderer.tsx`：

```tsx
import { memo, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, X } from "lucide-react";
import type { ContentBlock } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";
import { apiClient } from "../../../lib/api-client";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

interface BashDetails {
  background?: {
    pid: number;
    command: string;
    startedAt: number;
    durationMs: number;
    output?: string;
    detached: boolean;
  };
  terminated?: {
    pid?: number;
    command: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    output?: string;
  };
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

export const BashExecutionCard = memo(function BashExecutionCard({ block }: { block: Block }) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  const bashDetails = (block.details as BashDetails | undefined);
  const isBackground = !!bashDetails?.background;
  const isTerminated = !!bashDetails?.terminated;

  useEffect(() => {
    if (!isRunning) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const showBackground = elapsed > 5000 && isRunning;

  async function sendAction(action: "kill" | "background") {
    const sid = useSessionStore.getState().activeSessionId;
    if (!sid) return;
    await apiClient.call("bash.command", { sessionId: sid, action, toolCallId: block.toolCallId });
  }

  let borderBg: string;
  let statusLabel: React.ReactNode = null;

  if (isBackground) {
    borderBg = "border-yellow-500/30 bg-yellow-950/10";
    statusLabel = <span className="text-yellow-400 text-[10px]">已后台运行</span>;
  } else if (isTerminated) {
    borderBg = "border-red-500/20 bg-red-950/10";
    statusLabel = <span className="text-red-400 text-[10px]">已取消</span>;
  } else if (isRunning) {
    borderBg = "border-blue-500/30 bg-blue-950/15";
  } else if (isError) {
    borderBg = "border-red-500/20 bg-red-950/10";
  } else {
    borderBg = "border-gray-700/40 bg-gray-800/20";
  }

  return (
    <div className={`my-1.5 -mx-3 rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}>
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <span className={`font-medium ${isBackground ? "text-yellow-400" : isTerminated ? "text-red-400" : isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-gray-300"}`}>{block.toolName}</span>
        {isRunning && !statusLabel && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}
        {statusLabel}
        {bashDetails?.background && <span className="text-[10px] text-gray-500">PID: {bashDetails.background.pid}</span>}
        {bashDetails?.background && <span className="text-[10px] text-gray-500">{formatDuration(bashDetails.background.durationMs)}</span>}
        {bashDetails?.terminated && <span className="text-[10px] text-gray-500">{formatDuration(bashDetails.terminated.durationMs)}</span>}
      </div>

      <details className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
          <span>Input</span>
        </summary>
        <div className="px-3 pb-2">
          {block.args ? (
            <pre className="text-[11px] text-yellow-300/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">{block.args}</pre>
          ) : null}
        </div>
      </details>

      <details open className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
          <span>Output</span>
          {isRunning && <span className="ml-auto text-blue-400/70 animate-pulse text-[10px]">streaming</span>}
        </summary>
        <div className="px-3 pb-2">
          {block.output ? (
            <pre className="text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">{block.output}</pre>
          ) : isRunning ? (
            <div className="text-[11px] text-gray-600 italic py-1">waiting...</div>
          ) : null}
        </div>
      </details>

      {isRunning && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-gray-700/30">
          {showBackground && (
            <button
              onClick={() => sendAction("background")}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border border-yellow-600/40 text-[10px] text-yellow-400 hover:bg-yellow-600/15 transition-colors"
              title="转为后台运行"
            >
              <ArrowDownToLine className="w-3 h-3" />
              <span>后台运行</span>
            </button>
          )}
          {!showBackground && <div className="flex-1" />}
          <button
            onClick={() => sendAction("kill")}
            className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-red-600/30 text-[10px] text-red-400 hover:bg-red-600/10 transition-colors"
            title="取消执行"
          >
            <X className="w-3 h-3" />
            <span>取消</span>
          </button>
        </div>
      )}
    </div>
  );
});
```

**Step 2: 注册 BashRenderer**

在 `src/mainview/components/chat/tool-renderers/index.ts` 中添加：

```ts
import { BashExecutionCard } from "./BashRenderer";

registerToolRenderer("bash", { renderExecution: BashExecutionCard });
```

**Step 3: 简化 MessageBubble.tsx**

在 `src/mainview/components/chat/MessageBubble.tsx` 中：

1. 删除 `BashDetails` 接口定义（line 242-259）
2. 删除 `formatDuration` 函数（line 261-266）
3. 简化 `ToolExecutionCard`：移除所有 bash 特定逻辑（`isBash` 判断、`bashDetails`、`sendAction`、后台/取消按钮等），使其只保留通用渲染
4. 删除 `ArrowDownToLine`, `X` 的 import（如果 `ToolExecutionCard` 不再使用）

简化后的 `ToolExecutionCard`：

```tsx
export const ToolExecutionCard = memo(function ToolExecutionCard({ block }: { block: Extract<ContentBlock, { type: "toolExecution" }> }) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";

  let borderBg: string;
  if (isRunning) {
    borderBg = "border-blue-500/30 bg-blue-950/15";
  } else if (isError) {
    borderBg = "border-red-500/20 bg-red-950/10";
  } else {
    borderBg = "border-gray-700/40 bg-gray-800/20";
  }

  return (
    <div className={`my-1.5 -mx-3 rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}>
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <span className={`font-medium ${isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-gray-300"}`}>{block.toolName}</span>
        {isRunning && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}
      </div>

      <details className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
          <span>Input</span>
        </summary>
        <div className="px-3 pb-2">
          {block.args ? (
            <pre className="text-[11px] text-yellow-300/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">{block.args}</pre>
          ) : null}
        </div>
      </details>

      <details open className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
          <span>Output</span>
          {isRunning && <span className="ml-auto text-blue-400/70 animate-pulse text-[10px]">streaming</span>}
        </summary>
        <div className="px-3 pb-2">
          {block.output ? (
            <pre className="text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">{block.output}</pre>
          ) : isRunning ? (
            <div className="text-[11px] text-gray-600 italic py-1">waiting...</div>
          ) : null}
        </div>
      </details>
    </div>
  );
});
```

**Step 4: Commit**

```bash
git add src/mainview/components/chat/tool-renderers/BashRenderer.tsx src/mainview/components/chat/tool-renderers/index.ts src/mainview/components/chat/MessageBubble.tsx
git commit -m "refactor(bash): extract bash renderer from MessageBubble into tool-renderers registry"
```

---

## Task 4: Shell 面板增加已完成进程展示 + 输出查看

**目标:** Shell 面板增加已完成/错误/已终止进程的展示，后台进程卡片可展开查看实时输出。

**Files:**
- Modify: `src/mainview/components/bash-panel/BashPanel.tsx`
- Modify: `src/mainview/stores/use-bash-store.ts` (add subscribe/unsubscribe output actions)

**Step 1: 在 bash-store 添加 subscribe/unsubscribe output actions**

在 `src/mainview/stores/use-bash-store.ts` 的 `BashState` 接口和实现中添加：

```ts
// 在 BashState interface 中添加
subscribedOutputs: Set<string>;

subscribeOutput: (sessionId: string, toolCallId: string) => Promise<void>;
unsubscribeOutput: (sessionId: string, toolCallId: string) => Promise<void>;
```

实现：

```ts
subscribeOutput: async (sessionId, toolCallId) => {
  await apiClient.call("bash.command", { sessionId, action: "subscribe_output", toolCallId });
  set((s) => {
    const next = new Set(s.subscribedOutputs);
    next.add(toolCallId);
    return { ...s, subscribedOutputs: next };
  });
},

unsubscribeOutput: async (sessionId, toolCallId) => {
  await apiClient.call("bash.command", { sessionId, action: "unsubscribe_output", toolCallId });
  set((s) => {
    const next = new Set(s.subscribedOutputs);
    next.delete(toolCallId);
    return { ...s, subscribedOutputs: next };
  });
},
```

初始值添加 `subscribedOutputs: new Set<string>()`。

**Step 2: 增强 BashPanel 展示已完成进程**

在 `src/mainview/components/bash-panel/BashPanel.tsx` 中：

1. 添加 Tab 切换：「运行中」和「历史」
2. 「运行中」tab 显示 running + background 进程（现有逻辑）
3. 「历史」tab 显示 done + error + terminated 进程
4. 后台进程卡片增加可展开的输出区域

关键修改：

```tsx
const [tab, setTab] = useState<"active" | "history">("active");

const activeProcesses = allProcesses?.filter((p) =>
  p.status === "running" || p.status === "background",
) ?? [];

const historyProcesses = allProcesses?.filter((p) =>
  p.status === "done" || p.status === "error" || p.status === "terminated",
) ?? [];

// 当没有活跃进程时，如果有历史进程，自动切到历史 tab
useEffect(() => {
  if (activeProcesses.length === 0 && historyProcesses.length > 0) {
    setTab("history");
  }
}, [activeProcesses.length, historyProcesses.length]);

// 面板始终显示（如果有任何进程）
if (allProcesses?.length === 0) return null;
```

面板顶部增加 Tab：

```tsx
<div className="flex items-center gap-2">
  <button
    onClick={() => setTab("active")}
    className={`text-[11px] px-2 py-0.5 rounded ${tab === "active" ? "bg-gray-700 text-white" : "text-gray-500"}`}
  >
    运行中 {activeProcesses.length > 0 && `(${activeProcesses.length})`}
  </button>
  <button
    onClick={() => setTab("history")}
    className={`text-[11px] px-2 py-0.5 rounded ${tab === "history" ? "bg-gray-700 text-white" : "text-gray-500"}`}
  >
    历史 {historyProcesses.length > 0 && `(${historyProcesses.length})`}
  </button>
</div>
```

**Step 3: 后台进程卡片增加可展开输出 + subscribe/unsubscribe**

在 `BashProcessCard` 中，当 `isBackground` 时增加展开按钮，展开后：
- 如果已订阅 output，显示实时输出
- 提供「订阅输出」/「取消订阅」按钮
- 如果有 `logPath`，显示「查看日志」按钮（Task 5 实现）

```tsx
{isBackground && (
  <details className="group">
    <summary className="text-[9px] text-gray-500 cursor-pointer hover:text-gray-400 flex items-center gap-1">
      <svg className="w-2.5 h-2.5 transition-transform group-open:rotate-90" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
      <span>输出</span>
    </summary>
    <div className="mt-1 space-y-1">
      {p.output ? (
        <pre className="text-[9px] text-gray-400 font-mono max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-gray-800/50 px-1.5 py-1">
          {p.output.slice(-2000)}
        </pre>
      ) : (
        <div className="text-[9px] text-gray-600 italic">无输出（后台模式默认不推送输出）</div>
      )}
      <div className="flex gap-1">
        {isSubscribed ? (
          <button onClick={() => handleUnsubscribe()} className="text-[9px] text-gray-400 hover:text-white">
            取消订阅
          </button>
        ) : (
          <button onClick={() => handleSubscribe()} className="text-[9px] text-blue-400 hover:text-blue-300">
            订阅输出
          </button>
        )}
        {p.logPath && (
          <button onClick={() => handleViewLog(p.logPath!)} className="text-[9px] text-cyan-400 hover:text-cyan-300">
            查看日志
          </button>
        )}
      </div>
    </div>
  </details>
)}
```

**Step 4: Commit**

```bash
git add src/mainview/components/bash-panel/BashPanel.tsx src/mainview/stores/use-bash-store.ts
git commit -m "feat(bash): add history tab, expandable output, and subscribe_output support in Shell panel"
```

---

## Task 5: logPath 日志文件查看

**目标:** 在 Shell 面板中提供「查看日志」按钮，点击后读取日志文件内容并展示。

**Files:**
- Modify: `src/shared/modules/file.ts` 或利用现有 file.read RPC 方法
- Modify: `src/mainview/components/bash-panel/BashPanel.tsx`

**Step 1: 在 BashPanel 中添加日志查看状态和弹窗**

在 `BashPanel.tsx` 中添加状态：

```ts
const [viewingLog, setViewingLog] = useState<{ toolCallId: string; logPath: string; content: string | null } | null>(null);
```

日志查看弹窗组件：

```tsx
function LogViewerModal({ logPath, content, onClose }: { logPath: string; content: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[80vw] max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">{logPath}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-sm">✕</button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-[11px] text-gray-300 font-mono whitespace-pre-wrap">
          {content ?? "无法读取日志文件"}
        </pre>
      </div>
    </div>
  );
}
```

在 `BashProcessCard` 中点击「查看日志」时，调用 file.read 或直接 fetch：

```ts
async function handleViewLog(logPath: string) {
  try {
    const result = await apiClient.call("file.read", { path: logPath });
    setViewingLog({ toolCallId: p.toolCallId, logPath, content: (result as { content: string }).content });
  } catch {
    setViewingLog({ toolCallId: p.toolCallId, logPath, content: null });
  }
}
```

**Step 2: 在 BashPanel 底部渲染 LogViewerModal**

```tsx
{viewingLog && (
  <LogViewerModal
    logPath={viewingLog.logPath}
    content={viewingLog.content}
    onClose={() => setViewingLog(null)}
  />
)}
```

> 注意: 如果项目没有 `file.read` RPC 方法，需要检查 `src/shared/modules/file.ts` 确认可用的文件读取 API。也可考虑用 `bash.command` 执行 `cat` 命令读取。

**Step 3: Commit**

```bash
git add src/mainview/components/bash-panel/BashPanel.tsx
git commit -m "feat(bash): add log file viewer for background processes"
```

---

## Task 6: ANSI 颜色渲染

**目标:** Bash 输出中的 ANSI escape code（颜色、粗体等）被正确渲染为彩色文本，而非原文显示。

**Files:**
- Create: `src/mainview/components/chat/primitives/AnsiText.tsx`
- Modify: `src/mainview/components/chat/tool-renderers/BashRenderer.tsx`
- Modify: `src/mainview/components/bash-panel/BashPanel.tsx`

**Step 1: 创建 AnsiText 组件**

创建 `src/mainview/components/chat/primitives/AnsiText.tsx`：

```tsx
import { useMemo } from "react";

const ANSI_REGEX = /\x1b\[([0-9;]*)m/g;

const COLOR_MAP: Record<string, string> = {
  "30": "text-gray-800",
  "31": "text-red-400",
  "32": "text-green-400",
  "33": "text-yellow-400",
  "34": "text-blue-400",
  "35": "text-purple-400",
  "36": "text-cyan-400",
  "37": "text-gray-200",
  "90": "text-gray-500",
  "91": "text-red-300",
  "92": "text-green-300",
  "93": "text-yellow-300",
  "94": "text-blue-300",
  "95": "text-purple-300",
  "96": "text-cyan-300",
  "97": "text-gray-100",
};

interface AnsiSpan {
  text: string;
  className: string;
}

export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  const parts = input.split(ANSI_REGEX);
  let currentClass = "text-gray-300";

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const codes = parts[i].split(";");
      const reset = codes.includes("0") || parts[i] === "";
      if (reset) {
        currentClass = "text-gray-300";
      }
      for (const code of codes) {
        if (code === "1") {
          currentClass += " font-bold";
        } else if (COLOR_MAP[code]) {
          currentClass = COLOR_MAP[code]!;
        }
      }
    } else if (parts[i]) {
      spans.push({ text: parts[i], className: currentClass });
    }
  }

  return spans;
}

export function AnsiText({ content, className }: { content: string; className?: string }) {
  const spans = useMemo(() => parseAnsi(content), [content]);

  return (
    <pre className={`whitespace-pre-wrap font-mono ${className ?? ""}`}>
      {spans.map((span, i) => (
        <span key={i} className={span.className}>{span.text}</span>
      ))}
    </pre>
  );
}
```

**Step 2: 在 BashRenderer 中使用 AnsiText**

在 `src/mainview/components/chat/tool-renderers/BashRenderer.tsx` 中，将 output 的 `<pre>` 替换为 `<AnsiText>`：

```tsx
import { AnsiText } from "../primitives/AnsiText";

// 替换原来的 <pre> 输出区域
// 修改前:
// <pre className="text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">{block.output}</pre>

// 修改后:
<AnsiText
  content={block.output ?? ""}
  className="text-[11px] overflow-x-auto leading-relaxed max-h-72 overflow-y-auto"
/>
```

**Step 3: 在 BashPanel 的展开输出中使用 AnsiText**

在 `BashPanel.tsx` 中同样替换后台进程展开区域的 `<pre>` 为 `<AnsiText>`。

**Step 4: Commit**

```bash
git add src/mainview/components/chat/primitives/AnsiText.tsx src/mainview/components/chat/tool-renderers/BashRenderer.tsx src/mainview/components/bash-panel/BashPanel.tsx
git commit -m "feat(bash): add ANSI color rendering for bash output"
```

---

## Task 7: 前台恢复（foreground）操作

**目标:** 将后台运行的进程恢复到前台（即前端重新订阅输出，并在 chat 中高亮提示）。

> 注意: 根据 Bash Channel Extension 文档，并没有定义 `foreground` action。这个功能实际是前端侧的组合操作：subscribe_output + 在 Shell 面板中标记为"正在查看"。

**Files:**
- Modify: `src/mainview/components/chat/tool-renderers/BashRenderer.tsx` (background 状态卡片增加恢复按钮)
- Modify: `src/mainview/components/bash-panel/BashPanel.tsx` (background 进程卡片增加恢复按钮)

**Step 1: 在 BashRenderer 中添加背景进程的"恢复前台查看"按钮**

在 `BashRenderer.tsx` 的 `BashExecutionCard` 中，当处于 background 状态时，在 status label 旁添加按钮：

```tsx
{isBackground && (
  <button
    onClick={async () => {
      const sid = useSessionStore.getState().activeSessionId;
      if (!sid) return;
      await apiClient.call("bash.command", { sessionId: sid, action: "subscribe_output", toolCallId: block.toolCallId });
    }}
    className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
    title="订阅实时输出"
  >
    查看输出
  </button>
)}
```

**Step 2: 在 BashPanel 中添加类似的恢复操作**

在后台进程卡片区域添加「查看输出」按钮（复用 Task 4 的 subscribe_output 逻辑）。

**Step 3: Commit**

```bash
git add src/mainview/components/chat/tool-renderers/BashRenderer.tsx src/mainview/components/bash-panel/BashPanel.tsx
git commit -m "feat(bash): add foreground/resume output viewing for background processes"
```

---

## Task 8: 集成验证

**目标:** 运行 lint 和构建，确保所有改动无编译错误。

**Step 1: 运行 lint**

```bash
npm run lint
```

如果有 lint 错误，修复之。

**Step 2: 运行 Vite 构建**

```bash
npx vite build
```

确认构建成功无 TypeScript 错误。

**Step 3: 手动功能验证清单**

- [ ] 启动 app，创建一个 session，让 agent 执行 `sleep 30` 或类似长命令
- [ ] 验证 Shell 面板出现 running 进程
- [ ] 5 秒后「后台运行」按钮出现
- [ ] 点击「后台运行」，验证进程状态变为 background，Chat 中卡片显示「已后台运行」
- [ ] Shell 面板历史 tab 可查看已完成进程
- [ ] 后台进程展开可看到输出区域 + 「订阅输出」按钮
- [ ] 点击「查看日志」可弹出日志查看器（如果有 logPath）
- [ ] bash 输出中的 ANSI 颜色被正确渲染
- [ ] 进程退出后 Shell 面板自动更新状态

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify bash channel enhancement integration"
```

---

## 任务依赖关系

```
Task 1 (类型扩展)
  ├── Task 2 (bash_background_exit 处理)
  ├── Task 3 (BashRenderer 抽取)
  ├── Task 4 (Shell 面板增强) ← depends on Task 1
  ├── Task 5 (日志查看) ← depends on Task 4
  ├── Task 6 (ANSI 渲染) ← depends on Task 3
  └── Task 7 (前台恢复) ← depends on Task 4
Task 8 (集成验证) ← depends on all
```

推荐执行顺序: **1 → 3 → 2 → 4 → 5 → 6 → 7 → 8**

Task 3、2、4 可以在一定程度上并行，但建议按此顺序串行以避免冲突。
