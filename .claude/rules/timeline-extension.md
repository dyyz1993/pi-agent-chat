# Timeline 组件扩展指南

> 完整架构设计见 `docs/design-chat-timeline.md`

## 四种扩展场景

### 1. 新增 Activity 类型（如 `test_run`）

**步骤：**

1. 打开 `src/mainview/components/chat/activity/builtins.ts`
2. 在文件末尾添加注册调用：

```typescript
activityRegistry.register({
  id: "test_run",                    // 唯一标识
  label: "测试运行",                  // 显示标签
  icon: TestTube,                     // 从 lucide-react 导入
  color: "text-emerald-400",          // tailwind 文字颜色 class
  priority: "normal",                 // "prominent" | "normal" | "subtle"
  defaultCollapsed: false,            // subtle 建议设 true
  renderSummary: (d) => {             // 摘要文本
    const passed = d.passed as number;
    const failed = d.failed as number;
    return `测试: ${passed} 通过, ${failed} 失败`;
  },
  renderDetail: (d) => {              // 可选：展开详情
    return d.output as string ?? "";
  },
});
```

3. 在 `src/mainview/stores/use-session-store.ts` 的事件处理器中，对对应的 RPC 事件调用 `useActivityStore.getState().addActivity(sessionId, { id, typeId: "test_run", ... })`

**文件修改清单：**
- `components/chat/activity/builtins.ts` — 注册新类型
- `stores/use-session-store.ts` — 接入事件（如果事件已存在）

---

### 2. 新增工具图标（如 `docker`）

**步骤：**

1. 打开 `src/mainview/components/chat/activity/tool-icon-map.ts`
2. 在 `toolIconMap` 对象中添加一行：

```typescript
docker: { icon: Container, color: "text-blue-400", label: "Docker" },
```

3. 从 lucide-react 导入对应 icon

**无需修改其他文件** — ToolSidebar 和 ToolExecutionBlock 都通过 `getToolIcon(toolName)` 动态获取。

---

### 3. 新增 ContentBlock 类型（如 `imageBlock`）

**步骤：**

1. 在 `src/mainview/types/index.ts` 的 `ContentBlock` 联合类型中添加新变体：

```typescript
| { type: "imageBlock"; url: string; alt?: string }
```

2. 在 `components/chat/message/blocks/` 下新建渲染文件：

```typescript
// ImageBlock.tsx
export function ImageBlock({ block }: { block: Extract<ContentBlock, { type: "imageBlock" }> }) {
  return <img src={block.url} alt={block.alt ?? ""} className="max-w-full rounded" />;
}
```

3. 在 `blocks/index.ts` 的 switch 中添加：

```typescript
case "imageBlock":
  return <ImageBlock block={block as Extract<ContentBlock, { type: "imageBlock" }>} />;
```

**文件修改清单：**
- `types/index.ts` — 添加 ContentBlock 变体
- `blocks/XxxBlock.tsx` — 新建渲染文件
- `blocks/index.ts` — 注册到 switch

---

### 4. 新增工具渲染器（如 `docker`）

为某个工具提供三阶段定制渲染（toolCall / toolExecution / toolResult）。

**步骤：**

1. 在 `components/chat/message/blocks/tool-renderers/` 下新建渲染文件：

```typescript
// DockerRenderer.tsx
import type { ToolRenderer } from "./registry";

const DockerCallRenderer = ({ block }) => (
  // toolCall 阶段：解析 args 显示容器名/镜像等
);

const DockerExecRenderer = ({ block }) => (
  // toolExecution 阶段：流式输出
);

const DockerResultRenderer = ({ block }) => (
  // toolResult 阶段：结果展示
);

export const dockerRenderer: ToolRenderer = {
  renderCall: DockerCallRenderer,
  renderExecution: DockerExecRenderer,
  renderResult: DockerResultRenderer,
};
```

2. 在 `tool-renderers/registry.ts` 或同文件末尾注册：

```typescript
registerToolRenderer("docker", dockerRenderer);
```

3. 同时在 `activity/tool-icon-map.ts` 添加图标映射

**三个阶段各自可选**——只注册 `renderExecution` 也可以，未注册的阶段自动 fallback 到通用渲染。

**文件修改清单：**
- `blocks/tool-renderers/XxxRenderer.tsx` — 新建渲染文件
- `blocks/tool-renderers/registry.ts` — 注册
- `activity/tool-icon-map.ts` — 添加图标（可选）

---

## 基础原语

定制渲染器应复用 `primitives/` 下的基础组件：

| 原语 | 用途 | 路径 |
|------|------|------|
| `CollapsibleCard` | 可折叠卡片容器 | `primitives/CollapsibleCard.tsx` |
| `StatusBadge` | running/done/error 状态指示 | `primitives/StatusBadge.tsx` |
| `CodeBlock` | 代码输出（带复制、行号） | `primitives/CodeBlock.tsx` |
| `IconLabel` | icon + 文字行 | `primitives/IconLabel.tsx` |
| `StreamingCursor` | 流式闪烁光标 | `primitives/StreamingCursor.tsx` |

| 类别 | 颜色 class | 适用场景 |
|------|-----------|---------|
| 成功/完成 | `text-green-400` | 工具执行成功、测试通过 |
| 警告/注意 | `text-amber-400` | 压缩、资源警告 |
| 重试/异常 | `text-orange-400` | 自动重试、降级 |
| 错误/失败 | `text-red-400` | 错误、LSP 异常 |
| 信息/中性 | `text-blue-400` | 文件读取、通用工具 |
| 模型/AI | `text-purple-400` | 模型切换、AI 相关 |
| 规则/配置 | `text-cyan-400` | 规则加载、配置变更 |
| 记忆/数据 | `text-teal-400` | 记忆检索、数据库 |
| 次要/低优 | `text-gray-400` | 队列更新、背景活动 |

## 优先级规范

| priority | 内嵌模式 | 独立模式 | 适用场景 |
|----------|---------|---------|---------|
| prominent | 默认展开 + 背景色 | icon 脉冲动画 | agent 生命周期、关键操作 |
| normal | 默认展开 | 标准样式 | 模型切换、重试、删除 |
| subtle | 默认折叠 + 半透明 | 更小字号 | 压缩、队列、书签、思考级别 |
