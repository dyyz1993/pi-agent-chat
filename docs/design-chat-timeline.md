# Chat Timeline 组件架构设计

> 目标：重构 `components/chat/` 目录，支撑 Timeline 混排、Activity 系统和 icon 动态映射。

---

## 1. 当前结构 vs 目标结构

### 1.1 当前

```
components/chat/
├── ChatPanel.tsx          # 主面板 + TokenBar + MessagesArea + InputBar（全塞一起）
├── MessageBubble.tsx      # 消息气泡 + 所有 ContentBlock 渲染逻辑
├── MessageList.tsx         # 会话列表（mock，后续移走）
├── InputBar.tsx
├── ActionButtons.tsx
├── ToolIconList.tsx        # 右侧工具图标硬编码
├── SplitPanel.tsx
└── mock-data.ts
```

**问题：**
- ChatPanel 承载了 TokenBar、MessagesArea 等多个子组件，文件过长
- MessageBubble 内的 ContentBlockRenderer 是 switch-case 单体，新增 block type 必须改这个文件
- ToolIconList 硬编码 6 个工具，无法动态扩展
- 没有 Activity 系统的位置

### 1.2 目标

```
components/chat/
├── ChatPanel.tsx                    # 容器，只做布局编排
├── InputBar.tsx                     # 输入框（不变）
├── ActionButtons.tsx                # 消息操作按钮（不变）
├── SplitPanel.tsx                   # 分屏（不变）
│
├── toolbar/                         # ── 顶部/侧边工具栏 ──
│   ├── TokenBar.tsx                 # 顶部 token/模型/状态栏（从 ChatPanel 提取）
│   └── ToolSidebar.tsx             # 右侧工具图标窄栏（原 ToolIconList，接入 icon 映射）
│
├── timeline/                        # ── 时间线主区域 ──
│   ├── TimelineView.tsx             # 替代 MessagesArea，渲染 TimelineItem[]
│   ├── TimelineItem.tsx             # 统一分发：message / activity
│   └── ActivityRow.tsx              # 单条 Activity 条目（icon + 文字 + 可展开详情）
│
├── message/                         # ── 消息渲染 ──
│   ├── MessageBubble.tsx            # 消息气泡外壳（布局 + 流式光标 + 嵌套 Activity）
│   └── blocks/                      # 每个 ContentBlock 一个文件
│       ├── index.ts                 # ContentBlockRenderer 分发器
│       ├── TextBlock.tsx
│       ├── ThinkingBlock.tsx
│       ├── ToolCallBlock.tsx        # 查 toolRendererRegistry → 定制 / fallback
│       ├── ToolResultBlock.tsx      # 查 toolRendererRegistry → 定制 / fallback
│       ├── ToolExecutionBlock.tsx   # 查 toolRendererRegistry → 定制 / fallback
│       └── tool-renderers/          # 工具定制渲染器（按工具名注册）
│           ├── registry.ts          # Map<toolName, ToolRenderer>（三阶段）
│           ├── fallback.tsx         # 通用 FallbackRenderer
│           ├── FileReadRenderer.tsx
│           ├── FileEditRenderer.tsx
│           ├── BashRenderer.tsx
│           ├── SearchRenderer.tsx
│           └── GlobRenderer.tsx
│
├── primitives/                      # ── 基础 UI 原语（跨组件复用） ──
│   ├── CollapsibleCard.tsx          # 可折叠卡片容器（替代重复的 <details>）
│   ├── StatusBadge.tsx              # 状态指示（running/done/error/idle）
│   ├── CodeBlock.tsx                # 代码输出块（带复制、语法高亮）
│   ├── IconLabel.tsx                # icon + 文字行
│   └── StreamingCursor.tsx          # 流式闪烁光标
│
└── activity/                        # ── Activity 系统核心 ──
    ├── types.ts                     # 类型定义
    ├── registry.ts                  # 注册表（Map + register/get helpers）
    ├── builtins.ts                  # 内置 activity types（compaction, retry, model_change...）
    └── tool-icon-map.ts            # toolName → { icon, color } 映射配置

# 新增 store
stores/
└── use-activity-store.ts            # Activity entries 状态管理

# 类型扩展
types/
└── index.ts                         # 新增 ActivityTypeConfig, ActivityEntry, TimelineItem
```

---

## 2. 布局与组件摆放

### 2.1 整体布局（MainLayout 不变）

```
┌─ TabBar ─────────────────────────────────────────────────────┐
├── LeftSidebar ──┬── ChatPanel ──────────────┬─ RightSidebar ─┤
│                  │                            │                │
│  SessionSidebar  │  ┌─ TokenBar ───────────┐ │  StatusPanel   │
│                  │  │ tokens | model | toggles│ │                │
│                  │  └───────────────────────-┘ │                │
│                  │                              │                │
│                  │  ┌──────────────┬──────────┐ │                │
│                  │  │              │ Tool      │ │                │
│                  │  │ TimelineView │ Sidebar   │ │                │
│                  │  │              │           │ │                │
│                  │  │  [User msg]  │ 📄 ✏️ 🔍  │ │                │
│                  │  │  [Activity]  │ 💻 🖼️    │ │                │
│                  │  │  [Asst msg]  │           │ │                │
│                  │  │    ├ block   │           │ │                │
│                  │  │    ├ block   │           │ │                │
│                  │  │    ├ activity│           │ │                │
│                  │  │    └ block   │           │ │                │
│                  │  │  [Activity]  │           │ │                │
│                  │  │              │           │ │                │
│                  │  └──────────────┴──────────┘ │                │
│                  │                              │                │
│                  │  ┌─ InputBar ───────────────┐│                │
│                  │  │📎 🖼️  [textarea...]  ➤/■││                │
│                  │  └──────────────────────────-┘│                │
└──────────────────┴──────────────────────────────┴────────────────┘
```

### 2.2 ChatPanel 内部组件树

```
ChatPanel
├── <TokenBar />                          ← toolbar/TokenBar.tsx
├── <div flex> 主区域
│   ├── <TimelineView messages activities/>  ← timeline/TimelineView.tsx
│   │   ├── <TimelineItem type="message" />  ← 每条消息
│   │   │   └── <MessageBubble />            ← message/MessageBubble.tsx
│   │   │       ├── <TextBlock />
│   │   │       ├── <ThinkingBlock />
│   │   │       ├── <ToolCallBlock />       → toolRendererRegistry → 定制/Fallback
│   │   │       ├── <ToolResultBlock />     → toolRendererRegistry → 定制/Fallback
│   │   │       ├── <ToolExecutionBlock />  → toolRendererRegistry → 定制/Fallback
│   │   │       ├── <ActivityRow inline />  ← 内嵌 Activity（streaming 期间）
│   │   │       └── <StreamingCursor />     ← primitives/StreamingCursor.tsx
│   │   └── <TimelineItem type="activity" /> ← 独立 Activity 条目
│   │       └── <ActivityRow />              ← timeline/ActivityRow.tsx
│   └── <ToolSidebar />                     ← toolbar/ToolSidebar.tsx
├── <InputBar />                            ← 输入区
```

### 2.3 TimelineItem 排列规则

```
TimelineView 渲染逻辑：

TimelineItem[] = merge(messages, standaloneActivities)
                 ↳ 按 timestamp 排序

其中 standaloneActivities = 没有关联到任何消息的 ActivityEntry（parentMessageId === null）

每条 MessageBubble 内部也会渲染 inlineActivities（parentMessageId === 该消息 id）
```

---

## 3. Activity 系统

### 3.1 类型定义（`activity/types.ts`）

```typescript
import type { LucideIcon } from "lucide-react";

export type ActivityPriority = "prominent" | "normal" | "subtle";

export interface ActivityTypeConfig {
  /** 唯一标识，如 "compaction"、"auto_retry"、"model_change" */
  id: string;
  /** 显示标签 */
  label: string;
  /** lucide icon 组件引用 */
  icon: LucideIcon;
  /** tailwind 文字颜色 class，如 "text-amber-400" */
  color: string;
  /** 展示优先级 */
  priority: ActivityPriority;
  /** 是否默认折叠（subtle 默认折叠） */
  defaultCollapsed?: boolean;
  /** 渲染摘要文本 */
  renderSummary: (data: Record<string, unknown>) => string;
  /** 可选：渲染详情（展开后显示） */
  renderDetail?: (data: Record<string, unknown>) => string;
}

export interface ActivityEntry {
  id: string;
  typeId: string;
  timestamp: number;
  /** 活动数据，传给 ActivityTypeConfig.renderSummary */
  data: Record<string, unknown>;
  /** null = 独立 timeline 条目；有值 = 内嵌在指定消息内 */
  parentMessageId: string | null;
}
```

### 3.2 注册表（`activity/registry.ts`）

```typescript
import type { ActivityTypeConfig } from "./types";

class ActivityRegistry {
  private types = new Map<string, ActivityTypeConfig>();

  register(config: ActivityTypeConfig): void {
    this.types.set(config.id, config);
  }

  get(typeId: string): ActivityTypeConfig | undefined {
    return this.types.get(typeId);
  }

  getAll(): ActivityTypeConfig[] {
    return [...this.types.values()];
  }
}

/** 全局单例 */
export const activityRegistry = new ActivityRegistry();
```

### 3.3 内置类型（`activity/builtins.ts`）

所有内置 activity type 集中在一个文件注册，便于查阅和维护：

```typescript
import { activityRegistry } from "./registry";
import {
  Archive, RefreshCw, Cpu, Brain, ListOrdered,
  Trash2, Bookmark, Play, CircleStop, Zap,
  FileText, Database, AlertTriangle, Sparkles,
} from "lucide-react";

activityRegistry.register({
  id: "compaction",
  label: "上下文压缩",
  icon: Archive,
  color: "text-amber-400",
  priority: "subtle",
  defaultCollapsed: true,
  renderSummary: (d) => {
    const before = (d.tokensBefore as number) ?? 0;
    const after = (d.tokensAfter as number) ?? 0;
    return `压缩 ${(before / 1000).toFixed(0)}K→${(after / 1000).toFixed(0)}K tokens`;
  },
});

activityRegistry.register({
  id: "auto_retry",
  label: "自动重试",
  icon: RefreshCw,
  color: "text-orange-400",
  priority: "normal",
  renderSummary: (d) => {
    const attempt = d.attempt as number;
    const max = d.maxAttempts as number;
    const err = d.errorMessage as string | undefined;
    return `重试 (${attempt}/${max})${err ? `: ${err}` : ""}`;
  },
});

activityRegistry.register({
  id: "model_change",
  label: "模型切换",
  icon: Cpu,
  color: "text-purple-400",
  priority: "normal",
  renderSummary: (d) => `切换模型 → ${d.modelId ?? "unknown"}`,
  renderDetail: (d) => `provider: ${d.provider ?? "-"}\nmodel: ${d.modelId ?? "-"}`,
});

activityRegistry.register({
  id: "thinking_level_change",
  label: "思考级别",
  icon: Brain,
  color: "text-indigo-400",
  priority: "subtle",
  defaultCollapsed: true,
  renderSummary: (d) => `思考级别 → ${d.thinkingLevel ?? "unknown"}`,
});

activityRegistry.register({
  id: "queue_update",
  label: "排队更新",
  icon: ListOrdered,
  color: "text-gray-400",
  priority: "subtle",
  defaultCollapsed: true,
  renderSummary: (d) => {
    const s = ((d.steering as string[])?.length) ?? 0;
    const f = ((d.followUp as string[])?.length) ?? 0;
    return `排队: steering[${s}] followUp[${f}]`;
  },
});

activityRegistry.register({
  id: "deletion",
  label: "消息删除",
  icon: Trash2,
  color: "text-red-400",
  priority: "normal",
  renderSummary: (d) => `删除消息: ${(d.entryId as string)?.slice(0, 8)}`,
});

activityRegistry.register({
  id: "label",
  label: "书签",
  icon: Bookmark,
  color: "text-blue-400",
  priority: "subtle",
  defaultCollapsed: true,
  renderSummary: (d) => `书签: ${(d.text as string) ?? ""}`,
});

activityRegistry.register({
  id: "agent_lifecycle",
  label: "Agent 生命周期",
  icon: Play,
  color: "text-green-400",
  priority: "prominent",
  renderSummary: (d) => d.phase === "start" ? "Agent 开始处理" : "Agent 处理完成",
});

activityRegistry.register({
  id: "rules_loaded",
  label: "规则加载",
  icon: FileText,
  color: "text-cyan-400",
  priority: "subtle",
  defaultCollapsed: true,
  renderSummary: (d) => `加载规则: ${(d.rulePath as string) ?? ""}`,
});

activityRegistry.register({
  id: "memory_retrieved",
  label: "记忆检索",
  icon: Database,
  color: "text-teal-400",
  priority: "subtle",
  defaultCollapsed: true,
  renderSummary: (d) => `检索记忆: ${(d.query as string) ?? ""}`,
});

activityRegistry.register({
  id: "lsp_error",
  label: "LSP 异常",
  icon: AlertTriangle,
  color: "text-red-400",
  priority: "normal",
  renderSummary: (d) => `LSP 错误: ${(d.message as string) ?? "unknown"}`,
});

activityRegistry.register({
  id: "custom_entry",
  label: "自定义",
  icon: Sparkles,
  color: "text-cyan-400",
  priority: "normal",
  renderSummary: (d) => (d.summary as string) ?? "自定义事件",
  renderDetail: (d) => (d.detail as string) ?? JSON.stringify(d, null, 2),
});
```

> **扩展方式**：外部插件/模块只需 `import { activityRegistry } from "../activity/registry"` 后调 `.register()` 即可添加新类型。

---

## 4. 基础 UI 原语（primitives/）

所有 block 渲染器和 ActivityRow 共享的基础 UI 组件，避免重复写 `<details>` + border + bg 模式。

### 4.1 CollapsibleCard

```typescript
interface CollapsibleCardProps {
  /** 边框颜色 class */
  borderColor?: string;
  /** 背景色 class */
  bgColor?: string;
  /** 默认是否展开 */
  defaultOpen?: boolean;
  /** 标题区域（icon + 文本） */
  header: React.ReactNode;
  /** 展开内容 */
  children?: React.ReactNode;
  /** 额外 className */
  className?: string;
}
```

替代重复的 `<details className="my-1 border rounded p-2 bg-xxx">` 模式。

### 4.2 StatusBadge

```typescript
type BadgeStatus = "running" | "done" | "error" | "idle";

interface StatusBadgeProps {
  status: BadgeStatus;
  size?: "sm" | "md";
}
```

统一 running(⏳/脉冲)、done(✓)、error(✗)、idle 的视觉表现。

### 4.3 CodeBlock

```typescript
interface CodeBlockProps {
  content: string;
  maxHeight?: number;
  withCopy?: boolean;
  language?: string;
  className?: string;
}
```

替代重复的 `<pre className="mt-1 text-xs overflow-x-auto max-h-64">`。

### 4.4 IconLabel

```typescript
interface IconLabelProps {
  icon: LucideIcon;
  text: string;
  color?: string;
  size?: "xs" | "sm" | "md";
}
```

统一 icon + text + color 三件套，被 ActivityRow、TokenBar、ToolSidebar 共用。

### 4.5 StreamingCursor

```typescript
// 无 props，纯视觉组件
export function StreamingCursor() { ... }
```

替代内联的 `<span className="w-1.5 h-4 animate-pulse" />`。

---

## 5. 工具渲染器系统（tool-renderers/）

### 5.1 三阶段渲染

一个工具从调用到完成经历三个阶段，共享一套定制逻辑：

```
toolCall（LLM 决定调什么）→ toolExecution（执行中）→ toolResult（执行完毕）
```

注册的不是三个独立渲染器，而是**一个工具一套三件**：

```typescript
// tool-renderers/registry.ts

import type { ComponentType } from "react";
import type { ContentBlock } from "../../../types";

type ToolCallBlock = Extract<ContentBlock, { type: "toolCall" }>;
type ToolResultBlock = Extract<ContentBlock, { type: "toolResult" }>;
type ToolExecutionBlock = Extract<ContentBlock, { type: "toolExecution" }>;

export interface ToolRenderer {
  /** 渲染 toolCall 阶段（参数展示） */
  renderCall?: ComponentType<{ block: ToolCallBlock }>;
  /** 渲染 toolExecution 阶段（流式执行中） */
  renderExecution?: ComponentType<{ block: ToolExecutionBlock }>;
  /** 渲染 toolResult 阶段（结果展示） */
  renderResult?: ComponentType<{ block: ToolResultBlock }>;
}

const toolRendererRegistry = new Map<string, ToolRenderer>();

export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  toolRendererRegistry.set(toolName.toLowerCase(), renderer);
}

export function getToolRenderer(toolName: string): ToolRenderer | undefined {
  return toolRendererRegistry.get(toolName.toLowerCase());
}
```

### 5.2 分发逻辑

```tsx
// ToolCallBlock.tsx — 查注册表，有定制用定制，否则 fallback
export function ToolCallBlock({ block }) {
  const renderer = getToolRenderer(block.name);
  if (renderer?.renderCall) {
    const Component = renderer.renderCall;
    return <Component block={block} />;
  }
  return <FallbackCallRenderer block={block} />;
}

// ToolExecutionBlock.tsx — 同理
// ToolResultBlock.tsx — 同理（通过 block.toolName 查注册表）
```

### 5.3 具体渲染器示例

**FileReadRenderer** — 三阶段：
```
call 阶段：  📄 file_path + 行号范围预览
execution：  📄 file_path + 流式内容输出（语法高亮）
result：     📄 file_path + 完整内容（可折叠，行号 + 语法高亮）
```

**FileEditRenderer** — 三阶段：
```
call 阶段：  ✏️ file_path + diff 预览（直接解析 old_string/new_string）
execution：  ✏️ file_path + diff 预览 + 运行状态
result：     ✏️ file_path + 应用结果（成功/失败 + 变更统计）
```

**BashRenderer** — 三阶段：
```
call 阶段：  💻 $ command 预览
execution：  💻 $ command + 流式 stdout/stderr
result：     💻 $ command + 完整输出 + exit code badge
```

**SearchRenderer** — 三阶段：
```
call 阶段：  🔍 pattern 预览
execution：  🔍 流式 file:line 匹配
result：     🔍 file:line 结果列表 + 匹配高亮 + 计数 badge
```

---

## 6. Icon 映射系统

### 6.1 工具图标映射（`activity/tool-icon-map.ts`）

工具名（toolName）→ 图标和颜色的映射表，被 ToolSidebar 和 ToolExecutionBlock 共用：

```typescript
import type { LucideIcon } from "lucide-react";
import {
  FileText, Wrench, Search, Code, Terminal,
  Image as ImageIcon, Globe, FolderOpen, Pencil,
  Database, GitBranch, Settings, Cpu,
} from "lucide-react";

export interface ToolIconConfig {
  icon: LucideIcon;
  color: string;    // tailwind color class
  label: string;
}

/** 工具名 → 图标配置（全小写匹配） */
const toolIconMap: Record<string, ToolIconConfig> = {
  read:       { icon: FileText,    color: "text-blue-400",   label: "Read" },
  edit:       { icon: Pencil,      color: "text-green-400",  label: "Edit" },
  write:      { icon: FileText,    color: "text-emerald-400",label: "Write" },
  search:     { icon: Search,      color: "text-yellow-400", label: "Search" },
  grep:       { icon: Search,      color: "text-yellow-400", label: "Grep" },
  glob:       { icon: FolderOpen,  color: "text-amber-400",  label: "Glob" },
  bash:       { icon: Terminal,    color: "text-cyan-400",   label: "Bash" },
  code:       { icon: Code,        color: "text-purple-400", label: "Code" },
  image:      { icon: ImageIcon,   color: "text-pink-400",   label: "Image" },
  web:        { icon: Globe,       color: "text-sky-400",    label: "Web" },
  database:   { icon: Database,    color: "text-teal-400",   label: "DB" },
  git:        { icon: GitBranch,   color: "text-orange-400", label: "Git" },
  settings:   { icon: Settings,    color: "text-gray-400",   label: "Settings" },
  model:      { icon: Cpu,         color: "text-violet-400", label: "Model" },
};

/** 默认图标（未匹配时使用） */
const DEFAULT_TOOL_ICON: ToolIconConfig = {
  icon: Wrench,
  color: "text-gray-400",
  label: "Tool",
};

/**
 * 获取工具图标配置
 * 支持全小写匹配 + 别名
 */
export function getToolIcon(toolName: string): ToolIconConfig {
  const key = toolName.toLowerCase().replace(/[_-]/g, "");
  return toolIconMap[key] ?? DEFAULT_TOOL_ICON;
}

/** 获取所有已注册的工具图标（供 ToolSidebar 展示） */
export function getAllToolIcons(): ToolIconConfig[] {
  return Object.values(toolIconMap);
}
```

### 6.2 扩展 icon 的方式

| 场景 | 扩展方式 | 修改文件 |
|------|---------|---------|
| 新增工具类型（如 `docker`） | 在 `toolIconMap` 添加一行 | `tool-icon-map.ts` |
| 新增 Activity 类型（如 `test_run`） | `activityRegistry.register(...)` | `builtins.ts` 或外部模块 |
| 新增 ContentBlock 类型 | 在 `blocks/` 新建文件 + index.ts 注册 | `blocks/XxxBlock.tsx` + `blocks/index.ts` |

---

## 7. 组件职责说明

### 7.1 `timeline/TimelineView.tsx`

```
职责：从 store 读取 messages + activities，合并排序，渲染 TimelineItem 列表
Props: 无（直接读 store）
内部：
  - 读取 useChatStore.messagesBySession[sessionId]
  - 读取 useActivityStore.activitiesBySession[sessionId]
  - 合并为 TimelineItem[] 并按 timestamp 排序
  - 渲染 <TimelineItem /> 列表 + 自动滚动
```

### 7.2 `timeline/TimelineItem.tsx`

```
职责：根据 item.type 分发渲染
  - "message" → <MessageBubble />
  - "activity" → <ActivityRow />
Props: item: TimelineItem
```

### 7.3 `timeline/ActivityRow.tsx`

```
职责：渲染单条 Activity 条目
Props: entry: ActivityEntry, inline?: boolean

渲染逻辑：
  1. 从 activityRegistry.get(entry.typeId) 取得 config
  2. 渲染: [config.icon] [config.renderSummary(entry.data)]
  3. inline 模式：更紧凑，半透明背景
  4. 独立模式：左侧竖线 + icon + 文本，可展开详情

视觉：
  内嵌模式（在消息气泡内）：
  ┌────────────────────────────────────┐
  │  ...assistant 文本内容...          │
  │  ┌──────────────────────────────┐  │
  │  │ 📦 压缩 85K→12K tokens      │  │  ← 半透明，小字
  │  └──────────────────────────────┘  │
  │  ...继续 assistant 文本...         │
  └────────────────────────────────────┘

  独立模式（消息之间）：
  ─── 🔄 自动重试 (2/3): Server overloaded ───
  ─── ⚡ 切换模型 → gpt-4o ────────────────────
```

### 7.4 `message/MessageBubble.tsx`

```
职责：消息气泡外壳
Props: message: ChatMessage, activities?: ActivityEntry[]

渲染逻辑：
  - user：右对齐，深色背景
  - assistant：左对齐，渲染 content blocks + inline activities
  - isStreaming：末尾加闪烁光标
```

### 7.5 `message/blocks/index.ts`

```
职责：ContentBlock 类型分发
导出: ContentBlockRenderer({ block }: { block: ContentBlock })

内部 switch:
  "text"          → <TextBlock />
  "thinking"      → <ThinkingBlock />
  "toolCall"      → <ToolCallBlock />
  "toolResult"    → <ToolResultBlock />
  "toolExecution" → <ToolExecutionBlock />  ← 使用 getToolIcon(block.toolName)

扩展：新增 block type 时，新建 block 文件 + 在 switch 加一行
```

### 7.6 `toolbar/TokenBar.tsx`

```
职责：顶部状态栏
从 ChatPanel 提取，包含：
  - SessionToggleIcon（左）
  - Token 计数 / 模型名 / 费用
  - StatusToggleIcon（右）
```

### 7.7 `toolbar/ToolSidebar.tsx`

```
职责：右侧工具图标窄栏
取代 ToolIconList，接入 getToolIcon() 动态渲染
显示当前会话使用过的工具（去重）
```

---

## 8. Store 设计

### 8.1 `use-activity-store.ts`

```typescript
interface ActivityState {
  activitiesBySession: Record<string, ActivityEntry[]>;

  addActivity: (sessionId: string, entry: ActivityEntry) => void;
  getInlineActivities: (sessionId: string, messageId: string) => ActivityEntry[];
  getStandaloneActivities: (sessionId: string) => ActivityEntry[];
  clearSession: (sessionId: string) => void;
}
```

### 8.2 `types/index.ts` 新增

```typescript
// Timeline 统一类型
export type TimelineItem =
  | { type: "message"; message: ChatMessage }
  | { type: "activity"; activity: ActivityEntry };
```

---

## 9. 视觉规范

### 9.1 ActivityRow 样式

| 模式 | 容器 | 字体 | icon 大小 |
|------|------|------|----------|
| inline（内嵌） | `bg-gray-800/30 rounded px-2 py-0.5` | `text-[11px]` | `w-3 h-3` |
| standalone（独立） | `border-l-2 border-gray-700 pl-3 py-1` | `text-xs` | `w-3.5 h-3.5` |

### 9.2 优先级视觉差异

| priority | 内嵌模式 | 独立模式 |
|----------|---------|---------|
| prominent | 默认展开，带背景色 | 独立条目，icon 带脉冲动画 |
| normal | 默认折叠 | 独立条目，标准样式 |
| subtle | 默认折叠，更透明 | 独立条目，更小字号 |

### 9.3 颜色体系（与 lucide icon 配合）

| 类别 | 颜色 |
|------|------|
| 成功/完成 | `text-green-400` |
| 警告/注意 | `text-amber-400` / `text-orange-400` |
| 错误/异常 | `text-red-400` |
| 信息/中性 | `text-blue-400` / `text-gray-400` |
| 特殊 | `text-purple-400`（模型）、`text-cyan-400`（规则）、`text-teal-400`（记忆） |

---

## 10. 数据链路修正

### 10.1 问题：toolResult 缺少 toolName

RPC 协议中，`toolResult` 消息只有 `toolCallId`，没有 `toolName`：

```json
{"role": "toolResult", "toolCallId": "tc_001", "content": [...]}
```

但工具名在 `tool_execution_*` 事件中有。三阶段渲染器需要 `toolName` 才能查到对应渲染器。

### 10.2 解决方案

**1. 维护 `toolCallId → toolName` 映射**

在 `use-session-store.ts` 的事件处理器中，`tool_execution_start` 时记录：

```typescript
const toolCallNameMap: Record<string, string> = {};

if (eventType === "tool_execution_start") {
  toolCallNameMap[event.toolCallId] = event.toolName;
}
```

**2. `parseContentBlocks` 补上 toolResult 解析**

当前 `message-mapper.ts` 只处理 `text`、`thinking`、`toolCall`，`toolResult` 被丢弃。
需要在 `messageToChatMessage` 中，当 `role === "toolResult"` 时，将消息转为 `{ type: "toolResult", toolCallId, toolName, content, isError }` 的 ContentBlock。

**3. 类型定义补 `toolName`**

```typescript
// types/index.ts
| { type: "toolResult"; toolCallId: string; toolName: string; content: string; isError?: boolean }
```

### 10.3 修正后数据流

```
agent stdout
  ↓
tool_execution_start  → 记录 toolCallId → toolName 映射
  ↓
tool_execution_end    → 生成 toolExecution ContentBlock（已有）
  ↓
message_start(role=toolResult) → 用映射查 toolName → 生成 toolResult ContentBlock（含 toolName）
```

---

## 11. 迁移步骤

按顺序执行，每步可独立提交：

1. **数据链路修正** — types 补 toolName + parseContentBlocks 补 toolResult + 映射表
2. **新建 primitives/** — CollapsibleCard, StatusBadge, CodeBlock, IconLabel, StreamingCursor
3. **提取 blocks/** — 把 ContentBlockRenderer 从 MessageBubble 拆分为独立 block 文件
4. **新建 tool-renderers/** — registry + fallback + FileRead/Edit/Bash/Search 渲染器
5. **新建 activity/** — types + registry + builtins + tool-icon-map
6. **提取 toolbar/** — TokenBar + ToolSidebar 从 ChatPanel 分离
7. **新建 timeline/** — TimelineView + TimelineItem + ActivityRow
8. **新建 use-activity-store.ts** — Activity 状态管理
9. **重构 ChatPanel** — 用新组件替换内联代码
10. **接入事件** — use-session-store 里的 compaction/retry/model_change 事件写入 activity store
