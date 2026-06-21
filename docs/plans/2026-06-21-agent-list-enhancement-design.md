# Agent 列表注入系统提示词方案（v2）

> **日期**: 2026-06-21
> **状态**: 方案设计中，待确认
> **目标**: 对标 Skill 的注入方式，把可用 agent 清单写入 system prompt

---

## 一、核心思路

**Skill 是怎么做的**：在 `buildSystemPrompt()` 构建系统提示词时，调用 `formatSkillsForPrompt(skills)` 生成 `<available_skills>` 块，一次性写入 system prompt。之后每次 LLM 请求都能看到，不需要 context hook 反复 push。

**Agent 要做的完全一样**：新增 `formatAgentsForPrompt(agents)` 函数，在 `buildSystemPrompt()` 里调用，生成 `<available_agents>` 块写入 system prompt。

```
Skill:  formatSkillsForPrompt()  →  <available_skills>   →  写入 system prompt
Agent:  formatAgentsForPrompt()  →  <available_agents>   →  写入 system prompt
```

### 为什么这个方案最优

| 方案                            | token 开销                        | 实时性             | 改动量     |
| ------------------------------- | --------------------------------- | ------------------ | ---------- |
| ❌ context hook 每次 push       | 高（每次请求重复注入）            | 实时               | ~30 行     |
| ❌ 工具 description 动态注入    | 中（工具描述占位）                | 实时               | 复杂       |
| ✅ **system prompt 一次性注入** | **低（只算 system prompt 一次）** | **session 级足够** | **~40 行** |

---

## 二、注入效果

LLM 在 system prompt 末尾会看到：

```
<available_agents>
The following agents are available for delegation via subagent or session_delegate tools.
Choose the agent that best matches the task nature:

  <agent>
    <name>build</name>
    <description>Full-permission agent for all development tasks</description>
    <source>builtin</source>
    <filePath>(builtin)</filePath>
  </agent>
  <agent>
    <name>explore</name>
    <description>Read-only exploration agent with bash access</description>
    <source>builtin</source>
    <filePath>(builtin)</filePath>
  </agent>
  <agent>
    <name>plan</name>
    <description>Read-only planning agent</description>
    <source>builtin</source>
    <filePath>(builtin)</filePath>
  </agent>
  <agent>
    <name>code-reviewer</name>
    <description>Reviews code changes for quality and security</description>
    <source>user</source>
    <filePath>/Users/xuyingzhou/.pi/agent/agents/code-reviewer.md</filePath>
  </agent>
</available_agents>

Default agent is "build" when not specified. Use the agent name in the `agent` parameter of subagent/session_delegate tools.
```

注入后 LLM 就能：

- ✅ 在派发子任务时根据 description 选择最合适的 agent
- ✅ 知道有哪些自定义 agent 可用（不再盲选）
- ✅ 看到文件路径（可读文件了解详情）
- ✅ 默认 build，不指定时自动用 build

---

## 三、改动清单

只改底层（pi-momo-fork），3 个文件，每个改动很小：

### 文件 1：`src/core/agent-types.ts` — 新增 `formatAgentsForPrompt()`

对标 `formatSkillsForPrompt()`（在 `skills.ts:353`），新增格式化函数。

```typescript
// agent-types.ts — 在 formatAgentList() 旁边新增

/**
 * Format agents for inclusion in a system prompt.
 * Mirrors formatSkillsForPrompt() from skills.ts.
 *
 * Excludes hidden agents. All visible agents are included regardless of mode,
 * so the LLM can choose any agent for delegation.
 */
export function formatAgentsForPrompt(agents: AgentConfig[]): string {
  const visibleAgents = agents.filter((a) => !a.hidden);

  if (visibleAgents.length === 0) {
    return "";
  }

  const lines = [
    "\n\n<available_agents>",
    "The following agents are available for delegation via subagent or session_delegate tools.",
    "Choose the agent that best matches the task nature:",
    "",
  ];

  for (const agent of visibleAgents) {
    lines.push("  <agent>");
    lines.push(`    <name>${escapeXml(agent.name)}</name>`);
    lines.push(`    <description>${escapeXml(agent.description)}</description>`);
    lines.push(`    <source>${escapeXml(agent.source)}</source>`);
    lines.push(`    <filePath>${escapeXml(agent.filePath)}</filePath>`);
    lines.push("  </agent>");
  }

  lines.push("</available_agents>");
  lines.push("");
  lines.push('Default agent is "build" when not specified.');

  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
```

> **注意**：`escapeXml` 在 `skills.ts` 里已有，但在 `agent-types.ts` 里不存在。可以抽取到公共 utils，或直接复制（很短）。

### 文件 2：`src/core/system-prompt.ts` — 加 agents 参数和注入点

**改动 3 处**：

1. **import** — 引入 `formatAgentsForPrompt` 和 `AgentConfig`
2. **`BuildSystemPromptOptions`** — 加 `agents?: AgentConfig[]` 字段
3. **`SystemPromptBreakdown`** — 加 `agentsChars: number` 字段
4. **注入逻辑** — 在 skills section 之后注入 agents section（**customPrompt 分支和默认分支都要加**）

```typescript
// system-prompt.ts

// 1. import 改动
import { formatSkillsForPrompt, type Skill } from "./skills.ts";
import { formatAgentsForPrompt, type AgentConfig } from "./agent-types.ts"; // ← 新增

// 2. BuildSystemPromptOptions 加字段
export interface BuildSystemPromptOptions {
  // ... existing fields ...
  /** Pre-loaded agents. */
  agents?: AgentConfig[]; // ← 新增
}

// 3. SystemPromptBreakdown 加字段
export interface SystemPromptBreakdown {
  systemBaseChars: number;
  toolsChars: number;
  contextFilesChars: number;
  skillsChars: number;
  agentsChars: number; // ← 新增
}

// emptyBreakdown 加默认值
function emptyBreakdown(): SystemPromptBreakdown {
  return {
    systemBaseChars: 0,
    toolsChars: 0,
    contextFilesChars: 0,
    skillsChars: 0,
    agentsChars: 0, // ← 新增
  };
}

// 4. buildSystemPromptWithBreakdown — 解构 agents
const {
  // ... existing ...
  agents: providedAgents, // ← 新增
} = options;
const agents = providedAgents ?? [];

// 5. customPrompt 分支注入（在 skills section 之后）
// --- 现有 skills 注入 ---
if (customPromptHasSkill && skills.length > 0) {
  const skillsSection = formatSkillsForPrompt(skills);
  breakdown.skillsChars = skillsSection.length;
  prompt += skillsSection;
}

// --- 新增 agents 注入 ---
if (agents.length > 0) {
  const agentsSection = formatAgentsForPrompt(agents);
  breakdown.agentsChars = agentsSection.length;
  prompt += agentsSection;
}

// 6. 默认分支注入（在 skills section 之后，同样位置）
// --- 现有 skills 注入 ---
const hasSkill = tools.includes("skill");
if ((hasRead || hasSkill) && skills.length > 0) {
  const skillsSection = formatSkillsForPrompt(skills);
  breakdown.skillsChars = skillsSection.length;
  prompt += skillsSection;
}

// --- 新增 agents 注入 ---
if (agents.length > 0) {
  const agentsSection = formatAgentsForPrompt(agents);
  breakdown.agentsChars = agentsSection.length;
  prompt += agentsSection;
}

// 7. breakdown.systemBaseChars 计算（两个分支都要加 - breakdown.agentsChars）
breakdown.systemBaseChars =
  prompt.length -
  breakdown.toolsChars -
  breakdown.contextFilesChars -
  breakdown.skillsChars -
  breakdown.agentsChars; // ← 加 agentsChars
```

### 文件 3：`src/core/agent-session.ts` — 传 agents 数据

在 `_rebuildSystemPrompt()` 里调用 `discoverAgents()` 获取 agent 列表，传给 `buildSystemPromptWithBreakdown()`。

```typescript
// agent-session.ts — _rebuildSystemPrompt()

// 顶部 import
import { discoverAgents } from "./agent-types.ts";  // ← 新增（如果尚未 import）

private _rebuildSystemPrompt(toolNames: string[]): string {
  // ... existing toolSnippets/guidelines logic ...

  const loadedSkills = this._resourceLoader.getSkills().skills;
  const activeSkills = ...;
  const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;

  // --- 新增：discover available agents ---
  const agentDiscovery = discoverAgents(this._cwd, "user");

  this._baseSystemPromptOptions = {
    cwd: this._cwd,
    skills: activeSkills,
    contextFiles: loadedContextFiles,
    customPrompt: loaderSystemPrompt,
    appendSystemPrompt,
    selectedTools: validToolNames,
    toolSnippets,
    promptGuidelines,
    agents: agentDiscovery.agents,  // ← 新增
  };
  const result = buildSystemPromptWithBreakdown(this._baseSystemPromptOptions);
  // ... rest unchanged ...
}
```

---

## 四、数据流图

```
_rebuildSystemPrompt()
  │
  ├─ discoverAgents(cwd, "user")          ← 读 ~/.pi/agent/agents/*.md + builtin
  │    └─ AgentConfig[] (含 name, description, filePath, source, hidden, mode)
  │
  ├─ buildSystemPromptWithBreakdown({
  │     skills: [...],
  │     agents: agentDiscovery.agents,     ← 新增
  │     ...
  │   })
  │
  └─ system-prompt.ts
       │
       ├─ formatSkillsForPrompt(skills)    → <available_skills> 块
       │
       └─ formatAgentsForPrompt(agents)    → <available_agents> 块  ← 新增
              │
              ├─ filter out hidden
              ├─ XML 格式化
              │    <agent>
              │      <name>build</name>
              │      <description>...</description>
              │      <source>builtin</source>
              │      <filePath>...</filePath>
              │    </agent>
              │
              └─ 追加默认提示: Default agent is "build"
```

---

## 五、注入位置说明

在 system prompt 中的相对位置：

```
┌─ Base prompt (You are an expert coding assistant...) ──┐
│                                                        │
├─ Available tools ──────────────────────────────────────┤
│  - read: Read file contents                            │
│  - bash: Execute commands                              │
│  - edit: Edit a file                                   │
│  ...                                                   │
├─ Guidelines ───────────────────────────────────────────┤
│  - Be concise...                                       │
├─ Pi documentation paths ───────────────────────────────┤
├─ <project_context> (AGENTS.md 等) ─────────────────────┤
├─ <available_skills> ───────────────────────────────────┤
│  <skill> name / description / location </skill>        │
│  ...                                                   │
├─ <available_agents>  ← 新增，紧跟在 skills 之后 ──────────┤
│  <agent> name / description / source / filePath </agent>│
│  ...                                                   │
├─ Current date / cwd ───────────────────────────────────┤
└────────────────────────────────────────────────────────┘
```

---

## 六、注意事项

1. **过滤规则**：只过滤 `hidden: true` 的 agent。不区分 mode（primary/subagent/all 全部注入），让 LLM 根据 description 自行判断。

2. **builtin agent 的 filePath**：builtin agent（build/explore/plan）没有真实文件路径，`filePath` 字段可能是空字符串或 `(builtin)`。`escapeXml` 已经处理了空串情况。

3. **token 开销**：每个 agent 约 ~150 字符。10 个 agent ≈ 1500 字符 ≈ ~400 token。相比每次 context hook push，这是一次性开销。

4. **discoverAgents 性能**：`_rebuildSystemPrompt()` 只在 agent 切换/工具变化时调用（不是每次请求），所以磁盘扫描频率很低。如果担心，可以在 session_start 时缓存一次。

5. **与 subagent-v2 的关系**：subagent-v2 的 `execute` 里已经用 `discoverAgents()` 做运行时发现和校验。system prompt 注入只是让 LLM 提前"看到"清单，不改变 subagent 的实际运行逻辑。

6. **escapeXml 复用**：`skills.ts` 和 `agent-types.ts` 都需要 `escapeXml`。建议抽取到 `src/utils/xml.ts` 公共工具（但这是 code quality 优化，不是必须的）。

---

## 七、验证方式

1. 修改底层后 `cd pi-momo-fork/packages/coding-agent && npm run build && yalc push`
2. 重启 dev server，新建 session
3. 打开 AgentPanel → "Live System Prompt" section，确认 `<available_agents>` 块出现
4. 发一条消息让 LLM 派发子任务，检查它是否能正确引用 agent 名称
5. 检查 Context Usage breakdown 里 agentsChars 有值

---

## 八、对比 v1 方案（已废弃）

| 维度       | v1 方案（废弃）                        | v2 方案（当前）          |
| ---------- | -------------------------------------- | ------------------------ |
| 注入方式   | context hook 每次请求 push             | system prompt 一次性注入 |
| 改动范围   | 前端 UI + 底层 extension + coordinator | 底层 3 个文件            |
| token 开销 | 每次请求重复                           | 只算 system prompt 一次  |
| UI 改动    | 有（下拉改卡片）                       | 无                       |
| 复杂度     | 高                                     | 低                       |
