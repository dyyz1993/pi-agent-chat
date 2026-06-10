# Plugin Toggle 设计方案

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 StatusPanel 的 Plugins 列表中添加 toggle 开关，用户可以按项目禁用/启用 plugin，通过 `set_settings` + `reload` 真正从 Agent runtime 中移除。

**Architecture:** 前端在 `~/.pi-agent-chat/config.json` 持久化 `disabledPlugins`（按项目路径存储）。Toggle 时同时写 config.json + 调用 `agent.setSettings` 修改 settings 中的 extensions 排除规则 + 调用 `agent.reload` 重新加载 CLI runtime。`fetchInitialState` 时读取 disabledPlugins 标记 UI 状态。

**Tech Stack:** React + Zustand + WebSocket RPC（复用现有架构）

---

## 背景调研结论

### 为什么不用 `set_active_tools`？

经验证，`set_active_tools` 不适合：

1. **reload 会覆盖** — `session.reload()` 调用 `_buildRuntime({ includeAllExtensionTools: true })`，会把所有 extension tools 重新加入 active 列表
2. **Extension 仍在运行** — 只是从 LLM 可见列表移除，事件处理器、slash 命令等仍活跃
3. **不够彻底** — 不符合用户预期（用户期望"关闭"= 完全不加载）

### 正确路径：`set_settings` + `reload`

fork 的 `resource-loader.reload()` 中有 `isEnabledByOverrides()` 过滤机制：
- settings 中的 `extensions` 数组支持 `-path` 前缀强制排除
- `set_settings` RPC 会写入 settings 文件并持久化到磁盘
- `reload` 重新解析所有资源，被排除的 extension 不会被加载

### 持久化策略

采用方案 A：在现有 `config.json` 中按项目路径存储，与 Skill 的全局 `disabledSkills` 并列：

```json
{
  "disabledSkills": ["skill-a"],
  "disabledPlugins": {
    "/Users/foo/project-a": ["hooks-engine", "some-plugin"],
    "/Users/foo/project-b": ["another-plugin"]
  }
}
```

---

## 生命周期流程

```
用户在 StatusPanel 点击 Plugin toggle (OFF)
  │
  ├─ ① 前端乐观更新 UI (enabled → false, 显示 loading)
  │
  ├─ ② 写入 config.json:
  │     disabledPlugins[projectPath].push(pluginName)
  │
  ├─ ③ 调用 agent.setSettings({ extensions: [..., "-pluginPath"] }, "project")
  │     → settings 写入 .pi/settings.json
  │
  ├─ ④ 调用 agent.reload(sessionId)
  │     → CLI 进程重新加载 runtime
  │     → 被排除的 extension 不会被加载（isEnabledByOverrides 过滤）
  │
  ├─ ⑤ reload 返回后，调用 fetchInitialState(sessionId)
  │     → 重新获取 extensions → 对比 disabledPlugins 设置 enabled=false
  │     → 更新 UI
  │
  └─ ⑥ loading 状态结束
```

---

## 涉及文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/shared/lib/project-config.ts` | 修改 | 添加 `disabledPlugins` 字段、`listDisabledPlugins`、`setDisabledPlugin` |
| `src/shared/modules/agent.ts` | 修改 | 添加 `agent.getDisabledPlugins`、`agent.setDisabledPlugin` RPC 类型 |
| `src/shared/handlers/agent.ts` | 修改 | 注册新 RPC handler |
| `src/mainview/stores/use-status-store.ts` | 修改 | 添加 `togglePluginEnabled` 方法 |
| `src/mainview/stores/session-initial-state.ts` | 修改 | fetchInitialState 中获取 disabledPlugins 并映射 enabled |
| `src/mainview/components/status-panel/StatusPanel.tsx` | 修改 | Plugin 列表添加 toggle UI |
| `src/mainview/locales/zh-CN/status.json` | 修改 | 添加 toggle 相关翻译 |
| `src/mainview/locales/en/status.json` | 修改 | 添加 toggle 相关翻译 |

**不需要修改 fork（pi-coding-agent）**，因为 `set_settings` + `reload` 已存在。

---

## Task 1: 后端持久化层 — project-config.ts

**Files:**
- Modify: `src/shared/lib/project-config.ts`

**Step 1: 在 `ProjectConfig` 接口添加字段**

在 `ProjectConfig` 接口中添加：

```typescript
interface ProjectConfig {
  // ... 现有字段 ...
  disabledSkills: string[];
  disabledPlugins: Record<string, string[]>;  // key = projectPath
  modelFavorites: string[];
}
```

**Step 2: 在 `emptyConfig()` 和 `parseConfig()` 中初始化**

```typescript
function emptyConfig(): ProjectConfig {
  return {
    // ... 现有 ...
    disabledPlugins: {},
  };
}

function parseConfig(raw: string): ProjectConfig {
  // ... 现有 ...
  disabledPlugins: parsed.disabledPlugins ?? {},
}
```

**Step 3: 在 `hasUserData()` 中添加检查**

```typescript
config.disabledPlugins && Object.keys(config.disabledPlugins).length > 0
```

**Step 4: 添加 `listDisabledPlugins` 和 `setDisabledPlugin` 函数**

```typescript
export async function listDisabledPlugins(projectPath: string): Promise<string[]> {
  const config = await load();
  return config.disabledPlugins[projectPath] ?? [];
}

export async function setDisabledPlugin(
  projectPath: string,
  pluginPath: string,
  disabled: boolean,
): Promise<string[]> {
  return loadAndSave((config) => {
    if (!config.disabledPlugins[projectPath]) {
      config.disabledPlugins[projectPath] = [];
    }
    const list = config.disabledPlugins[projectPath];
    if (disabled) {
      if (!list.includes(pluginPath)) {
        list.push(pluginPath);
      }
    } else {
      config.disabledPlugins[projectPath] = list.filter((p) => p !== pluginPath);
    }
    return config.disabledPlugins[projectPath];
  });
}
```

---

## Task 2: RPC 类型定义 — agent.ts

**Files:**
- Modify: `src/shared/modules/agent.ts`

**Step 1: 添加两个新 RPC 类型**

在 `agent.setDisabledSkill` 附近添加：

```typescript
"agent.getDisabledPlugins": {
  params: { projectPath: string };
  result: { disabledPlugins: string[] };
};
"agent.setDisabledPlugin": {
  params: { projectPath: string; pluginPath: string; disabled: boolean };
  result: { disabledPlugins: string[] };
};
```

---

## Task 3: RPC Handler — agent.ts handler

**Files:**
- Modify: `src/shared/handlers/agent.ts`

**Step 1: 导入新函数**

在已有的 `import { listDisabledSkills, setDisabledSkill }` 旁边添加：

```typescript
import { listDisabledSkills, setDisabledSkill, listDisabledPlugins, setDisabledPlugin } from "../lib/project-config";
```

**Step 2: 注册 handler**

在 `agent.setDisabledSkill` handler 后面添加：

```typescript
r("agent.getDisabledPlugins", async (params) => {
  const disabledPlugins = await listDisabledPlugins(params.projectPath);
  return { disabledPlugins };
});

r("agent.setDisabledPlugin", async (params) => {
  const disabledPlugins = await setDisabledPlugin(params.projectPath, params.pluginPath, params.disabled);
  return { disabledPlugins };
});
```

---

## Task 4: 前端 Store — use-status-store.ts

**Files:**
- Modify: `src/mainview/stores/use-status-store.ts`

**Step 1: 在 store 接口添加 `togglePluginEnabled` 方法签名**

在 `togglePluginExpanded` 附近添加：

```typescript
togglePluginEnabled: (sessionId: string, projectPath: string, pluginPath: string) => void;
```

**Step 2: 实现 `togglePluginEnabled`**

```typescript
togglePluginEnabled: (sessionId, projectPath, pluginPath) => {
  const plugin = get().plugins.find((p) => p.path === pluginPath);
  if (!plugin) return;
  const newEnabled = !plugin.enabled;

  // 1. 乐观更新 UI
  set((s) => ({
    plugins: s.plugins.map((p) =>
      p.path === pluginPath ? { ...p, enabled: newEnabled } : p,
    ),
  }));

  // 2. 异步执行：写 config + set_settings + reload
  (async () => {
    try {
      // 写入 config.json
      await apiClient.call("agent.setDisabledPlugin", {
        projectPath,
        pluginPath,
        disabled: !newEnabled,
      });

      // 修改 settings 中的 extensions 排除规则
      // 注意：需要先获取当前 settings，再修改 extensions 数组
      const settingsRes = await apiClient.call("agent.getSettings", {
        sessionId,
        scope: "project",
      });
      const currentExtensions: string[] = settingsRes.extensions ?? [];
      const excludePattern = `-${pluginPath}`;

      let newExtensions: string[];
      if (!newEnabled) {
        // 禁用：添加排除模式（去重）
        if (!currentExtensions.includes(excludePattern)) {
          newExtensions = [...currentExtensions, excludePattern];
        } else {
          newExtensions = currentExtensions;
        }
      } else {
        // 启用：移除排除模式
        newExtensions = currentExtensions.filter((e) => e !== excludePattern);
      }

      await apiClient.call("agent.setSettings", {
        sessionId,
        settings: { extensions: newExtensions },
        scope: "project",
      });

      // reload 让 settings 生效
      await apiClient.call("agent.reload", { sessionId });

      // reload 完成后刷新 UI
      await useSessionStore.getState().fetchInitialState(sessionId);
    } catch (err) {
      log.warn("togglePluginEnabled failed", { error: String(err) });
      // 回滚乐观更新
      set((s) => ({
        plugins: s.plugins.map((p) =>
          p.path === pluginPath ? { ...p, enabled: !newEnabled } : p,
        ),
      }));
    }
  })();
},
```

> **注意**：需要在文件顶部 import `useSessionStore`。检查是否已有循环依赖问题。如果有，可以用 `useSessionStore.getState().fetchInitialState()` 延迟获取。

---

## Task 5: fetchInitialState 集成 — session-initial-state.ts

**Files:**
- Modify: `src/mainview/stores/session-initial-state.ts`

**Step 1: 添加 DisabledPluginsResponse 接口**

```typescript
interface DisabledPluginsResponse {
  disabledPlugins?: string[];
}
```

**Step 2: 在 Priority 3 阶段并行获取 disabledPlugins**

在 `disabledSkillsPromise` 旁边添加：

```typescript
const disabledPluginsPromise = apiClient.call("agent.getDisabledPlugins", {
  projectPath: /* 从 session 获取 projectPath */,
});
```

**Step 3: extensionsPromise.then 中合并 disabledPlugins 状态**

将现有的：

```typescript
enabled: true,
```

改为：

```typescript
enabled: true, // 先设为 true，后面根据 disabledPlugins 调整
```

然后在 `Promise.all([extensionsPromise, disabledPluginsPromise])` 中：

```typescript
Promise.all([extensionsPromise, disabledPluginsPromise])
  .then(([_, disabledPluginsRes]) => {
    const dp = disabledPluginsRes as DisabledPluginsResponse;
    const disabledPluginSet = new Set(dp?.disabledPlugins ?? []);
    if (disabledPluginSet.size > 0) {
      const currentPlugins = useStatusStore.getState().plugins;
      useStatusStore.getState().setPlugins(
        currentPlugins.map((p) => ({
          ...p,
          enabled: !disabledPluginSet.has(p.path),
        })),
      );
    }
  });
```

> **注意**：需要确认如何获取当前 session 的 projectPath。可能需要从 `useSessionStore` 中获取。

---

## Task 6: StatusPanel UI — StatusPanel.tsx

**Files:**
- Modify: `src/mainview/components/status-panel/StatusPanel.tsx`

**Step 1: 在 Plugin 行添加 toggle 按钮**

参考 Skill 的 Eye/EyeOff 实现，在 Plugin 行的 scope 标签后面添加：

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    if (activeSessionId) {
      const projectPath = /* 从 session store 获取 */;
      togglePluginEnabled(activeSessionId, projectPath, p.path);
    }
  }}
  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-surface-hover/60 rounded transition-opacity"
  title={p.enabled ? t("disablePlugin") : t("enablePlugin")}
>
  {p.enabled ? (
    <EyeOff className="w-3 h-3 text-text-tertiary" />
  ) : (
    <Eye className="w-3 h-3 text-text-tertiary" />
  )}
</button>
```

**Step 2: 展开详情时显示禁用状态提示**

在展开区域添加：

```tsx
{!p.enabled && (
  <div className="text-status-error/70">
    {t("pluginDisabled")}
  </div>
)}
```

---

## Task 7: 国际化 — locales

**Files:**
- Modify: `src/mainview/locales/zh-CN/status.json`
- Modify: `src/mainview/locales/en/status.json`

添加翻译：

```json
// zh-CN
{
  "disablePlugin": "禁用插件",
  "enablePlugin": "启用插件",
  "pluginDisabled": "插件已禁用，需要重新加载生效"
}

// en
{
  "disablePlugin": "Disable plugin",
  "enablePlugin": "Enable plugin",
  "pluginDisabled": "Plugin disabled, requires reload to take effect"
}
```

---

## 风险与注意事项

### 1. projectPath 的获取

`agent.getDisabledPlugins` 需要 `projectPath` 参数。需要确认：
- 从 `useSessionStore` 的 session 数据中获取 projectPath
- 或从 `fetchInitialState` 的上下文中传递

### 2. `set_settings` 的 scope 选择

- 如果用 `"project"` scope，排除规则写入 `.pi/settings.json`，会修改用户项目文件
- 如果用 `"global"` scope，排除规则写入全局 settings，对所有项目生效
- **建议用 `"project"`**，因为 disabledPlugins 本身是按项目存储的

### 3. reload 期间的用户体验

reload 是耗时操作（1-2秒），需要：
- 在 toggle 时显示 loading 状态
- 禁止连续点击
- reload 失败时回滚 UI + 清理 config.json 中的记录

### 4. 内置 Extension（hooks、rules 等）

内置 extension 如 hooks-engine、rules-engine 也会出现在 plugins 列表中。
- 用户如果禁用 hooks-engine，hooks 功能将完全不可用
- 应该对内置 extension 添加确认提示（"禁用此插件将影响核心功能"）

### 5. 与 HooksPanel/RulesPanel 的关系

- Plugin Toggle（本方案）= Extension 级别，reload 生效
- Hooks 运行时开关（已有）= 暂停/恢复执行，即时生效
- 两者互不冲突，但 UI 上可能需要提示用户区别

---

## 测试计划

### 单元测试

1. `project-config.ts`: 测试 `listDisabledPlugins`、`setDisabledPlugin` 的读写
2. `use-status-store.ts`: 测试 `togglePluginEnabled` 的乐观更新和回滚

### E2E 测试（通过 WebSocket RPC）

```javascript
// 1. 创建会话
const sr = await rpc(ws, "session.create", { projectPath: CWD });
const sid = sr.result.sessionId;
await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sr.result.sessionPath });

// 2. 获取初始 extensions
const exts = await rpc(ws, "agent.getExtensions", { sessionId: sid });
const pluginPath = exts.result.extensions[0].path;

// 3. 禁用 plugin
await rpc(ws, "agent.setDisabledPlugin", { projectPath: CWD, pluginPath, disabled: true });

// 4. set_settings + reload
const settings = await rpc(ws, "agent.getSettings", { sessionId: sid, scope: "project" });
const newExtensions = [...(settings.result.extensions ?? []), `-${pluginPath}`];
await rpc(ws, "agent.setSettings", { sessionId: sid, settings: { extensions: newExtensions }, scope: "project" });
await rpc(ws, "agent.reload", { sessionId: sid });

// 5. 验证 extension 不再出现
const exts2 = await rpc(ws, "agent.getExtensions", { sessionId: sid });
assert(!exts2.result.extensions.some(e => e.path === pluginPath));

// 6. 启用回来
await rpc(ws, "agent.setDisabledPlugin", { projectPath: CWD, pluginPath, disabled: false });
// ... 类似流程

ws.close();
```
