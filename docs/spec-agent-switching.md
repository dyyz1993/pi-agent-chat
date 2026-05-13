# Agent Switching 功能 Spec

> 状态：Draft | 目标仓库：`pi-mono-fork/packages/coding-agent` | 前端：`pi-agent-chat`

---

## 一、目标

在 pi-agent-chat 的聊天界面中，用户可以切换当前会话的 Agent 模式（如 Build / Explore / Plan）。切换后：

1. **工具集变化**（硬限制）— Explore 只看到 read/grep/glob，Plan 看不到 write/edit
2. **System Prompt 变化** — 每个 Agent 有专属指令
3. **可选：模型/思考等级变化** — Explore 用轻量模型，Plan 用强模型+深度思考
4. **同一个会话内切换** — 不新建会话，Agent 是挂在每次 prompt 上的

---

## 二、架构差异对比（OpenCode vs pi-mono-fork）

> 这是设计方案的基础。两个系统的关键机制不同，能力不能 1:1 搬运。

| 维度                   | OpenCode                                              | pi-mono-fork                                                     | 设计影响                                             |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| **工具拦截位置**       | LLM tools 层（构建 tools 对象时删除被 deny 的工具）   | 扩展事件层（`tool_call` 事件拦截，返回 `{ block: true }`）       | 权限控制走扩展，不改工具代码                         |
| **权限引擎位置**       | 核心模块 `src/permission/service.ts`                  | 扩展 `extensions/agent-permissions/index.ts`                     | 扩展现有扩展，不新建核心模块                         |
| **System Prompt 注入** | Agent 的 `prompt` 字段替换 provider prompt            | `before_agent_start` 事件 + `appendSystemPrompt` 参数            | 复用 `_rebuildSystemPrompt` + `appendSystemPrompt`   |
| **Agent 注册表**       | `src/agent/agent.ts` 内的 `state()` 对象              | `src/core/agent-types.ts` 的 `AgentConfig` + `discoverAgents()`  | 扩展现有 `AgentConfig` 接口                          |
| **Agent 切换方式**     | 每条消息带 `agent` 字段，`loop()` 读 `lastUser.agent` | **不存在** — 需要新增                                            | 在 `prompt()` 方法中加 agent 参数                    |
| **工具管理 API**       | 按权限过滤后传给 LLM                                  | `setActiveToolsByName()` 直接设置 `agent.state.tools`            | 复用 `setActiveToolsByName()`                        |
| **Prompt 重建 API**    | Agent prompt + provider prompt + instructions         | `buildSystemPrompt(options)` + `_rebuildSystemPrompt(toolNames)` | 复用 `_rebuildSystemPrompt`，追加 agent instructions |

---

## 三、现有代码盘点

### 已有能力（不需要重建）

| 能力               | 文件:行号                                      | 说明                                                                                                         |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Agent 配置接口     | `agent-types.ts:40-61`                         | `AgentConfig` 有 name, description, tools, disallowedTools, model, systemPrompt, permissionMode 等 16 个字段 |
| Agent 发现         | `agent-types.ts:249-270`                       | `discoverAgents(cwd, scope)` 扫描 `~/.pi/agents/` + `.pi/agents/`                                            |
| Frontmatter 解析   | `agent-types.ts:152-217`                       | `loadAgentsFromDir()` 解析 `.md` 文件的 YAML frontmatter + body                                              |
| 优先级合并         | `agent-types.ts:239-247`                       | `mergeAgentsByPriority()` 按优先级合并同名 Agent                                                             |
| 工具白名单/黑名单  | `agent-types.ts:42-43`                         | `tools?: string[]` 和 `disallowedTools?: string[]`                                                           |
| 工具过滤           | `agent-session.ts:1006-1021`                   | `setActiveToolsByName(toolNames)` 设置活跃工具并重建 prompt                                                  |
| Prompt 重建        | `agent-session.ts:1101-1135`                   | `_rebuildSystemPrompt(toolNames)` 调用 `buildSystemPrompt()`                                                 |
| System Prompt 注入 | `system-prompt.ts:8-25`                        | `appendSystemPrompt` 和 `customPrompt` 参数                                                                  |
| 权限拦截           | `agent-permissions/index.ts:172-192`           | `tool_call` 事件拦截，支持 block                                                                             |
| 权限模式           | `agent-permissions/index.ts:37-74`             | 6 种 PermissionMode（auto/acceptEdits/plan/dontAsk/always-allow/always-deny）                                |
| Glob 匹配          | `agent-permissions/index.ts:84-115`            | `matchesDisallowedTool()` 支持 `toolName(globPattern)`                                                       |
| 扩展 API           | `extensions/types.ts:1289-1296`                | `setActiveTools()`, `setModel()`, `setThinkingLevel()`                                                       |
| RPC 协议           | `rpc-types.ts`, `rpc-mode.ts`, `rpc-client.ts` | 完整的命令/响应/客户端体系                                                                                   |

### 缺失能力（需要新增）

| 能力                              | 说明                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `AgentConfig.tier`                | 不存在，需要新增                                                |
| `AgentConfig.thinkingLevel`       | 不存在，需要新增                                                |
| `AgentConfig.mode`                | 不存在（只有 `permissionMode`），需要新增 primary/subagent 区分 |
| `builtinAgents` 填充              | `discoverAgents()` line 253 硬编码为空数组，需要填充            |
| `_availableAgents` 缓存           | `AgentSession` 上没有 Agent 列表缓存                            |
| `PromptOptions.agent`             | `prompt()` 不接受 agent 参数                                    |
| Agent 切换逻辑                    | `prompt()` 中没有 "根据 agent 配置过滤工具+注入 prompt" 的逻辑  |
| 白名单执行                        | `agent-permissions` 的 `tools` 字段（白名单）没被执行层使用     |
| `get_agents` / `switch_agent` RPC | RPC 层没有 Agent 相关命令                                       |

---

## 四、改动清单（精确到文件:行号）

### 改动 1：扩展 `AgentConfig` 接口

**文件**：`src/core/agent-types.ts`
**位置**：line 40-61（`AgentConfig` 接口）
**行数**：+8 行

```typescript
// 在 AgentConfig 接口中新增 3 个字段：

/** 快捷模型层级：fast=轻量模型, pro=标准模型, max=强模型 */
tier?: "fast" | "pro" | "max";

/** 思考等级覆盖 */
thinkingLevel?: ThinkingLevel;

/** Agent 模式：primary=用户可选, subagent=只能被 subagent 工具调用 */
mode?: "primary" | "subagent" | "all";
```

同时需要在 `loadAgentsFromDir()` 的字段解析中补充新字段（line 87-121 的 coerceField 区域）。

### 改动 2：填充内置 Agent

**文件**：`src/core/agent-types.ts`
**位置**：line 249-270（`discoverAgents()` 函数）
**行数**：+40 行

```typescript
// 将 line 253 的空数组替换为内置定义：
const builtinAgents: AgentConfig[] = getBuiltinAgents();

// 新增 getBuiltinAgents() 函数（~35 行）
function getBuiltinAgents(): AgentConfig[] {
  return [
    {
      name: "build",
      description: "Full-stack development with read, write, edit and execution capabilities",
      systemPrompt: "", // 使用默认 system prompt
      source: "builtin",
      filePath: "",
      mode: "primary",
    },
    {
      name: "explore",
      description: "Read-only exploration, search and read code",
      tools: ["read", "grep", "find", "ls", "glob", "bash"],
      disallowedTools: ["edit", "write"],
      systemPrompt:
        "You are a code exploration specialist. You can only read and search code. Never modify any files...",
      source: "builtin",
      filePath: "",
      mode: "primary",
      tier: "fast",
    },
    {
      name: "plan",
      description: "Planning mode, output analysis and specs only",
      tools: ["read", "grep", "find", "ls", "glob"],
      disallowedTools: ["edit", "write", "bash"],
      systemPrompt:
        "You are a planning specialist. You only output analysis reports and implementation plans (spec). Never edit any code files...",
      source: "builtin",
      filePath: "",
      mode: "primary",
      tier: "max",
      thinkingLevel: "high",
    },
  ];
}
```

### 改动 3：AgentSession 缓存可用 Agents

**文件**：`src/core/agent-session.ts`
**位置**：class 字段区域（~line 170-190）
**行数**：+8 行

```typescript
// 新增 class 字段
private _availableAgents: Map<string, AgentConfig> = new Map();
private _activeAgentName: string = "build";

// 在 session 初始化方法中调用：
this._availableAgents = new Map(
  discoverAgents(this._cwd, "both").agents.map(a => [a.name, a])
);
```

### 改动 4：`PromptOptions` 增加 agent 参数

**文件**：`src/core/agent-session.ts`
**位置**：line 229-240（`PromptOptions` 接口）
**行数**：+2 行

```typescript
export interface PromptOptions {
  // ... 现有 5 个字段
  /** Agent name to use for this prompt. If set, applies agent's tool filter + instructions */
  agent?: string;
}
```

### 改动 5：`prompt()` 方法中插入 Agent 切换逻辑

**文件**：`src/core/agent-session.ts`
**位置**：line 1209-1212（在 `_flushPendingBashMessages()` 之后、model 验证之前）
**行数**：+20 行

```typescript
// line 1210 之后插入：

// === Agent switching (NEW) ===
const agentName = options?.agent || this._activeAgentName;
if (agentName !== this._activeAgentName || options?.agent) {
  const agentConfig = this._availableAgents.get(agentName);
  if (agentConfig) {
    this._applyAgentConfig(agentConfig);
    this._activeAgentName = agentName;
  }
}

// 然后才走原有的 model 验证（line 1212-1227）
```

**为什么必须插在这里（model 验证之前）**：

- Agent 可能指定了不同的 model（如 `tier: "fast"`）
- model 验证在 line 1213 检查 `this.model`
- 如果 agent 切换改了 model，验证必须用新 model
- 所以 agent 切换必须在验证之前完成

### 改动 6：新增 `_applyAgentConfig()` 方法

**文件**：`src/core/agent-session.ts`
**位置**：在 `setActiveToolsByName()` 方法之后（~line 1022）
**行数**：+35 行

```typescript
/**
 * Apply agent configuration: filter tools, inject instructions, optionally switch model/thinking level.
 */
private _applyAgentConfig(config: AgentConfig): void {
  // 1. Filter tools
  const allToolNames = Array.from(this._toolDefinitions.keys());
  let activeToolNames: string[];

  if (config.tools && config.tools.length > 0) {
    // Whitelist mode: only allow listed tools
    activeToolNames = allToolNames.filter(name => config.tools!.includes(name));
  } else {
    // No whitelist: start with all tools, then remove disallowed
    activeToolNames = allToolNames.filter(
      name => !(config.disallowedTools || []).some(pattern => {
        // Support simple glob matching for disallowedTools
        if (pattern === name) return true;
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        return regex.test(name);
      })
    );
  }

  // Apply tool filter (also rebuilds system prompt via _rebuildSystemPrompt)
  this.setActiveToolsByName(activeToolNames);

  // 2. Append agent instructions to system prompt
  if (config.systemPrompt) {
    this._baseSystemPrompt += "\n\n## Agent Mode\n";
    this._baseSystemPrompt += `You are currently operating as "${config.name}" agent.\n\n`;
    this._baseSystemPrompt += config.systemPrompt;
    this.agent.state.systemPrompt = this._baseSystemPrompt;
  }

  // 3. Optionally switch model (tier or specific model)
  if (config.tier) {
    const resolved = this._resolveTierAlias(config.tier);
    if (resolved) {
      this.setModel(resolved.provider, resolved.modelId);
    }
  } else if (config.model) {
    // resolve model string like "provider/model"
    const [provider, ...rest] = config.model.split("/");
    if (provider && rest.length > 0) {
      this.setModel(provider, rest.join("/"));
    }
  }

  // 4. Optionally switch thinking level
  if (config.thinkingLevel) {
    this.setThinkingLevel(config.thinkingLevel);
  }
}
```

**关键时序**：`setActiveToolsByName()` 在 line 1019 调用 `_rebuildSystemPrompt()` 重建 prompt。我们在它之后追加 agent instructions，这样 prompt 内容是：`[基础 system prompt（含工具列表）] + [Agent instructions]`。

### 改动 7：增强 `agent-permissions` 扩展

**文件**：`extensions/agent-permissions/index.ts`
**位置**：`createPermissionHandler()` 函数（line 117-170）
**行数**：+60 行

**当前问题**：

1. `AgentConfig.tools`（白名单）没被执行层使用 — `createPermissionHandler()` 只读 `permissionMode` + `disallowedTools`
2. 没有 `ask` 模式 — 只有 allow/deny，没有"询问用户"
3. 从 `variables` 读配置，不从 `AgentConfig` 读

**改动方案**：

```typescript
// 1. createPermissionHandler() 增加 tools 白名单检查
function createPermissionHandler(config: AgentConfig) {
  const mode = config.permissionMode ?? "auto";
  const rules = RULES[mode];
  const allowedTools = rules?.allowedTools; // 现有的（plan 模式的白名单）
  const agentAllowedTools = config.tools // NEW: Agent 定义的 tools 白名单
    ? new Set(config.tools)
    : null;
  const blockedTools = rules?.blockedTools;
  const agentDisallowedTools = config.disallowedTools // 现有的
    ? config.disallowedTools
    : [];
  const blockBashPatterns = rules?.blockBashPatterns;

  return (event: { toolName: string; input: Record<string, unknown> }) => {
    // NEW: Agent 白名单检查（优先于 PermissionMode 的白名单）
    if (agentAllowedTools && !agentAllowedTools.has(event.toolName)) {
      return {
        block: true,
        reason: `[${config.name}] Tool "${event.toolName}" is not in the allowed list`,
      };
    }
    // ... 然后走原有的 allowedTools / blockedTools / bashPatterns 检查
  };
}

// 2. tool_call handler 从 AgentConfig 驱动（而不是从 variables 读）
pi.on("tool_call", (event) => {
  // NEW: 从 session 的 activeAgentName 读取 AgentConfig
  const activeAgentName = vars?.["activeAgentName"];
  const agentConfig = activeAgentName ? availableAgents.get(activeAgentName) : null;

  if (agentConfig) {
    const handler = createPermissionHandler(agentConfig);
    const result = handler({ toolName: event.toolName, input: event.input });
    if (result?.block) {
      return { block: true, reason: result.reason };
    }
  }

  // ... 原有的 permissionMode 逻辑作为 fallback
});
```

### 改动 8：RPC 层新增 3 个命令

#### 8a：`rpc-types.ts` 新增命令类型

**文件**：`src/modes/rpc/rpc-types.ts`
**位置**：在 `RpcCommand` 联合类型末尾
**行数**：+12 行

```typescript
// 在 RpcCommand 联合类型中追加：
| { id?: string; type: "get_agents" }
| { id?: string; type: "switch_agent"; agent: string }
| { id?: string; type: "get_current_agent" }

// 在 RpcResponse 联合类型中追加：
| { id?: string; type: "response"; command: "get_agents"; data: { agents: Array<{
    name: string; description: string; mode?: string; tier?: string;
    thinkingLevel?: string; color?: string; tools?: string[];
    disallowedTools?: string[];
  }> } }
| { id?: string; type: "response"; command: "switch_agent"; data: { agent: string } }
| { id?: string; type: "response"; command: "get_current_agent"; data: { agent: string } }
```

#### 8b：`rpc-mode.ts` 新增 handler + prompt 加参数

**文件**：`src/modes/rpc/rpc-mode.ts`
**位置 1**：line 407（prompt handler 的 options）
**行数**：+1 行

```typescript
// line 407 加 agent 参数：
.prompt(command.message, {
  images: command.images,
  streamingBehavior: command.streamingBehavior,
  source: "rpc",
  agent: command.agent,  // ← 新增
  preflightResult: ...,
})
```

**位置 2**：在 switch 语句中新增 3 个 case
**行数**：+25 行

```typescript
case "get_agents": {
  const agents = session.getAvailableAgents();
  return success(id, "get_agents", { agents });
}

case "switch_agent": {
  session.setActiveAgent(command.agent);
  return success(id, "switch_agent", { agent: command.agent });
}

case "get_current_agent": {
  return success(id, "get_current_agent", { agent: session.getActiveAgentName() });
}
```

#### 8c：`rpc-client.ts` 新增客户端方法

**文件**：`src/modes/rpc/rpc-client.ts`
**位置**：在 `setThinkingLevel()` 方法之后
**行数**：+15 行

```typescript
async getAgents(): Promise<RpcAgentInfo[]> {
  const response = await this.send({ type: "get_agents" });
  return this.getData<{ agents: RpcAgentInfo[] }>(response).agents;
}

async switchAgent(agent: string): Promise<string> {
  const response = await this.send({ type: "switch_agent", agent });
  return this.getData<{ agent: string }>(response).agent;
}

async getCurrentAgent(): Promise<string> {
  const response = await this.send({ type: "get_current_agent" });
  return this.getData<{ agent: string }>(response).agent;
}
```

### 改动 9：AgentSession 新增公开方法

**文件**：`src/core/agent-session.ts`
**行数**：+15 行

```typescript
/** Get all available agents */
getAvailableAgents(): Array<Pick<AgentConfig, "name" | "description" | "mode" | "tier" | "thinkingLevel" | "color" | "tools" | "disallowedTools">> {
  return Array.from(this._availableAgents.values())
    .filter(a => a.mode !== "subagent" && !a.hidden)
    .map(a => ({
      name: a.name,
      description: a.description,
      mode: a.mode,
      tier: a.tier,
      thinkingLevel: a.thinkingLevel,
      color: a.color,
      tools: a.tools,
      disallowedTools: a.disallowedTools,
    }));
}

/** Get current active agent name */
getActiveAgentName(): string {
  return this._activeAgentName;
}

/** Set active agent by name */
setActiveAgent(name: string): void {
  const config = this._availableAgents.get(name);
  if (config) {
    this._applyAgentConfig(config);
    this._activeAgentName = name;
  }
}
```

---

## 五、行数估算

| #   | 文件                         | 改动类型                                      | 行数        |
| --- | ---------------------------- | --------------------------------------------- | ----------- |
| 1   | `agent-types.ts`             | 扩展 AgentConfig 接口                         | +8          |
| 2   | `agent-types.ts`             | 新增 getBuiltinAgents() + 修改 discoverAgents | +40         |
| 3   | `agent-types.ts`             | coerceField 补充新字段                        | +5          |
| 4   | `agent-session.ts`           | 新增 class 字段 + 初始化                      | +8          |
| 5   | `agent-session.ts`           | PromptOptions 加 agent                        | +2          |
| 6   | `agent-session.ts`           | prompt() 插入切换逻辑                         | +20         |
| 7   | `agent-session.ts`           | 新增 \_applyAgentConfig()                     | +35         |
| 8   | `agent-session.ts`           | 新增公开方法（getAvailableAgents 等）         | +25         |
| 9   | `agent-permissions/index.ts` | 增强权限执行                                  | +60         |
| 10  | `rpc-types.ts`               | 新增 3 个命令类型                             | +12         |
| 11  | `rpc-mode.ts`                | prompt 加参数 + 3 个 handler                  | +26         |
| 12  | `rpc-client.ts`              | 新增 3 个客户端方法                           | +15         |
| 13  | `core/index.ts`              | 导出                                          | +2          |
|     | **总计**                     |                                               | **~258 行** |

加上 CHANGELOG 和内置 Agent `.md` 文件（~100 行），总计 **~360 行**。

---

## 六、不做的事（及原因）

| 不做                                                      | 原因                                              |
| --------------------------------------------------------- | ------------------------------------------------- |
| 新建 `permission.ts`                                      | `agent-permissions` 扩展已存在，扩展它            |
| 新建 `agent-registry.ts`                                  | `agent-types.ts` 已有完整发现系统，扩展它         |
| 改 `core/tools/*.ts`                                      | 权限拦截在 `tool_call` 事件层，不在工具代码里     |
| 改 `system-prompt.ts`                                     | `appendSystemPrompt` 和 `customPrompt` 参数已够用 |
| 改 `extensions/types.ts` 的 `BeforeAgentStartEventResult` | 扩展已有 `ctx.setActiveTools()` API               |

---

## 七、前端改动（pi-agent-chat）

| 文件                                                | 改动                                                                       | 行数        |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ----------- |
| `stores/use-agent-store.ts`                         | 新增：currentAgent, agents[], switchAgent, fetchAgents                     | ~80         |
| `components/left-sidebar/SidebarBottomControls.tsx` | 加 Agent 选择行                                                            | ~80         |
| `stores/use-chat-store.ts`                          | sendMessage 带 agent 参数                                                  | ~10         |
| `shared/modules/agent.ts`                           | 新增 RPC schema：agent.getAgents, agent.switchAgent, agent.getCurrentAgent | ~15         |
| `shared/agent/process-manager.ts`                   | 新增 switchAgent, getAgents 方法                                           | ~25         |
| `shared/handlers/agent.ts`                          | 新增 3 个 handler                                                          | ~15         |
| i18n (zh-CN/en)                                     | 翻译                                                                       | ~20         |
|                                                     | **总计前端**                                                               | **~245 行** |

---

## 八、用户可见的 Agent 配置文件

用户可以在 `~/.pi/agents/` 或 `.pi/agents/` 放置 `.md` 文件自定义 Agent：

```markdown
---
name: spec
description: 技术规格文档专家，只写 spec 文件
mode: primary
tier: max
thinkingLevel: high
tools:
  - read
  - grep
  - glob
  - list
  - bash
  - edit
  - write
disallowedTools:
  - "edit(!.pi/specs/**)"
  - "write(!.pi/specs/**)"
color: purple
---

你是技术规格文档编写专家。你只输出技术规格文档到 .pi/specs/ 目录...

## 输出格式

### 需求分析

...
```

优先级：内置 < `~/.pi/agents/`（全局）< `.pi/agents/`（项目级）
