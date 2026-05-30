# AgentConfig 未实现字段实现计划

## 现状总览

| 字段             | 类型     | 状态               | 优先级 |
| ---------------- | -------- | ------------------ | ------ |
| `permissionMode` | enum     | 半成品（只展示）   | P0     |
| `maxTurns`       | number   | 半成品（子智能体） | P1     |
| `effort`         | string   | 死字段             | P2     |
| `skills`         | string[] | 死字段             | P2     |
| `memory`         | enum     | 死字段             | P3     |
| `isolation`      | enum     | 死字段             | P3     |
| `background`     | boolean  | 死字段             | P3     |

---

## P0: permissionMode — 权限模式

### 作用

控制 Agent 执行操作时的确认行为。用户最关心的安全机制。

### 可选值

```typescript
type PermissionMode =
  | "auto" // 自动判断，高风险操作才确认
  | "acceptEdits" // 自动接受文件编辑，其他操作确认
  | "plan" // 规划模式，不执行任何修改操作
  | "dontAsk" // 不询问，全部自动执行（危险）
  | "always-allow" // 全部允许
  | "always-deny"; // 全部拒绝
```

### 运行时应该怎么生效

当 Agent 要执行工具调用时，检查 permissionMode：

- `plan` → 拦截所有写操作（edit, write, bash 中可能修改的命令）
- `acceptEdits` → 自动通过 edit/write，其他（如 bash rm）需确认
- `auto` → 默认行为，高风险操作弹出确认
- `dontAsk` → 全部自动执行
- `always-deny` → 全部拒绝

### 实现位置

- 工具执行前的拦截点：`agent-session.ts` 的工具调用处理逻辑
- 可能需要在 `tool-executor` 或 `agent loop` 中加检查

### 难度

⭐⭐⭐ 中等 — 需要找到工具执行的拦截点，但逻辑本身不复杂

### 注意

Plan agent 已经通过 `tools` 白名单限制了工具，但 `permissionMode: "plan"` 是语义上的保证 — 即使工具列表变了，permissionMode 仍然会阻止写操作。双重保险。

---

## P1: maxTurns — 最大执行轮次

### 作用

限制 Agent 在一次对话中最多执行多少轮工具调用。防止 Agent 无限循环。

### 当前状况

- `forkAgent()`（子智能体）已实现：`const maxTurns = opts.maxTurns ?? 5`
- 主会话循环没有限制

### 运行时应该怎么生效

```typescript
// applyAgentConfig 中
if (agent.maxTurns) {
  this._maxTurns = agent.maxTurns;
}
```

然后在主循环的 tool loop 中加入相同的检查逻辑。

### 实现位置

- `agent-session.ts` 主循环中的 tool execution counting

### 难度

⭐ 简单 — 复用 forkAgent 的逻辑模式

---

## P2: effort — 投入度

### 作用

控制 Agent 在回答时的"投入程度"。

### 可能的含义

- `"low"` → 简短回答，不深入
- `"medium"` → 正常
- `"high"` → 深入分析，多步骤

### 怎么生效

两种实现方式：

1. **注入提示词**：在 systemPrompt 中加入 "Please provide brief/concise answers" 或 "Please provide thorough, detailed analysis"
2. **映射到模型参数**：影响 temperature 或 maxTokens

### 建议

先用方式 1（注入提示词），简单且不依赖模型 API。

### 难度

⭐ 简单 — 只需要注入一段文本

---

## P2: skills — 技能过滤

### 作用

限制当前 Agent 可以使用的技能（Skills）。类似 tools 对工具的过滤。

### 当前状况

Skills 通过 `ResourceLoader` 全局加载，所有 Agent 都能看到所有 Skills。

### 运行时应该怎么生效

```typescript
// applyAgentConfig 中
if (agent.skills && agent.skills.length > 0) {
  // 只保留指定的 skills
  this._activeSkills = loadedSkills.filter((s) => agent.skills.includes(s.name));
}
```

### 难度

⭐⭐ 中等 — 需要理解 ResourceLoader 的加载机制，加一个过滤层

---

## P3: memory — 记忆范围

### 作用

控制 Agent 的记忆存储范围。

- `"user"` → 跨项目的用户级记忆
- `"project"` → 当前项目级记忆
- `"local"` → 当前会话级记忆

### 当前状况

auto-memory 扩展存在，但没有按范围过滤。

### 难度

⭐⭐⭐ 复杂 — 需要理解 auto-memory 扩展的存储机制，加范围过滤

### 建议

暂时不实现，等 memory 机制完善后再做

---

## P3: isolation — 执行隔离

### 作用

控制 Agent 的执行环境隔离级别。

- `"worktree"` → 在 git worktree 中执行（保护主工作区）
- `"remote"` → 在远程环境执行（SSH/容器）

### 当前状况

有 remote tool 的基础模式，但不是通过 AgentConfig 驱动的。

### 难度

⭐⭐⭐⭐ 很复杂 — 涉及 git worktree 管理、远程连接、文件同步

### 建议

暂时不实现，这是独立的大特性

---

## P3: background — 后台运行

### 作用

Agent 在后台运行，不阻塞用户交互。

### 当前状况

有 `background()` 扩展 API（用于扩展异步任务），但不是 Agent 级别的后台运行。

### 难度

⭐⭐⭐⭐ 很复杂 — 需要 UI 配合、任务队列、结果通知

### 建议

暂时不实现

---

## 推荐实现顺序

### 第一批（立即可做）

1. **maxTurns** — 最简单，5 分钟搞定
2. **effort** — 简单，注入提示词即可

### 第二批（需要设计）

3. **permissionMode** — 需要找到工具拦截点，但价值最高
4. **skills** — 需要理解 ResourceLoader

### 第三批（未来特性）

5. **memory** — 等 auto-memory 完善后
6. **isolation** — 独立大特性
7. **background** — 需要 UI 配合
