# 跨项目知识桥接插件（Linked Projects Bridge）

> 日期: 2026-04-30
> 状态: 设计完成，待实现

## 核心问题

项目 A 依赖项目 B 的库，但文档不够详细，导致开发时存在认知断层。LLM 在主任务中去翻另一个仓库的代码会大量消耗上下文，且每次查完就丢，没有沉淀。

## 设计目标

1. 配置关联的外部项目路径，自动注入到系统提示词
2. 主任务中访问关联项目路径时自动拦截，引导使用子任务
3. 子任务在关联项目中正常查找，结果返回主任务
4. 每次查找结果沉淀为知识文件（项目级）+ agent memories（个人级）
5. 下次查询优先复用已有知识，避免重复查找

---

## 一、配置与存储

### 1.1 配置文件

路径: 项目根目录 `.pi/linked-projects.json`

```json
{
  "projects": [
    {
      "id": "pi-mono",
      "path": "/Users/xuyingzhou/Project/pi-mono",
      "description": "pi coding agent 主仓库，当前项目是其扩展",
      "relationship": "upstream",
      "keyPaths": [
        {
          "path": "packages/coding-agent/src/core/extensions/",
          "description": "扩展 API，开发插件时重点参考"
        },
        {
          "path": "packages/coding-agent/src/core/tools/",
          "description": "工具定义与拦截机制"
        },
        {
          "path": "packages/agent/src/types.ts",
          "description": "Agent 核心类型定义"
        }
      ],
      "readonly": true
    }
  ]
}
```

字段说明:
- `id`: 唯一标识，用于知识文件命名和引用
- `path`: 关联项目的绝对路径
- `description`: 项目关系说明，注入到系统提示词
- `relationship`: `upstream`（上游依赖）/ `downstream`（下游消费者）/ `sibling`（同级关联）
- `keyPaths`: 关键目录/文件及说明，帮助子任务缩小搜索范围。目录优先，偶尔可以指定关键文件
- `readonly`: 默认 true，子任务只有读权限

### 1.2 知识沉淀目录

路径: `.pi/linked-knowledge/<project-id>.md`

每个关联项目一个文件。子任务每次查完后追加摘要。格式:

```markdown
# pi-mono 知识沉淀

## 2026-04-30: Extension API 概览
- Extension 通过 `pi.on("tool_call", handler)` 注册工具调用拦截
- `before_agent_start` 事件可注入/替换系统提示词
- Channel 机制支持插件与 UI 双向通信
- 子任务通过 spawn 独立 pi 进程实现

## 2026-04-30: 工具拦截机制
- 三层拦截: Agent Core hooks → Extension events → Hooks system
- `beforeToolCall` 返回 `{ block: true }` 可阻止执行
- bash 工具有 `spawnHook` 可感知/修改 cwd
```

### 1.3 双向通信

插件注册 channel `linked-projects`:
- UI 通过 channel 增删改配置 → 插件更新配置文件
- 插件监听文件变更 → 同步到内存配置
- 两边都能触发配置更新

---

## 二、核心运行机制

### 2.1 提示词注入（before_agent_start）

每次会话开始，插件注入以下内容到系统提示词:

```
## 跨项目引用规则

你当前项目关联了以下外部仓库：

### pi-mono (upstream)
- 路径: /Users/xuyingzhou/Project/pi-mono
- 说明: pi coding agent 主仓库，当前项目是其扩展
- 关键目录:
  - packages/coding-agent/src/core/extensions/ — 扩展 API
  - packages/coding-agent/src/core/tools/ — 工具定义

**重要规则**：当你需要查看、搜索、读取上述仓库中的代码时，请使用子任务（Task 工具）进行查找。
不要在主任务中直接访问这些路径（会被拦截）。在子任务中你可以自由访问。

已沉淀的知识: .pi/linked-knowledge/pi-mono.md
```

### 2.2 工具拦截（tool_call 兜底）

当 agent 无视提示词，直接用 bash/read/grep 等工具访问 linkedProjects 路径时:

```typescript
pi.on("tool_call", async (event) => {
  const matched = matchLinkedPath(event.input, config.projects);
  if (matched) {
    return {
      block: true,
      reason: buildInterceptMessage(matched, event)
    };
  }
});
```

拦截返回消息模板:

```
该路径属于关联项目「${project.description}」(${project.id})。
请启动子任务(Task)查找，建议 prompt：

---
在项目 ${project.path} 中查找以下信息：
${用户的原始意图}
重点关注目录：${project.keyPaths 摘要}
已有知识参考：.pi/linked-knowledge/${project.id}.md
请总结关键发现。
---
```

### 2.3 拦截匹配逻辑

```typescript
function matchLinkedPath(input: any, projects: LinkedProject[]): LinkedProject | null {
  const paths = extractPaths(input);
  // 从各种工具参数中提取路径:
  // - bash: command 中的路径、workdir 参数
  // - read/glob/grep: filePath, path, include 参数
  // - write/edit: filePath 参数
  for (const p of paths) {
    for (const project of projects) {
      if (p.startsWith(project.path)) {
        return project;
      }
    }
  }
  return null;
}
```

### 2.4 子任务放行

子任务是独立的 pi 进程，其 cwd 设置为关联项目路径。因为是独立进程，不受主任务的拦截规则影响，所以自然放行。

---

## 三、知识沉淀

### 3.1 沉淀触发

插件通过 `tool_result` 事件监听子任务完成:

```typescript
pi.on("tool_result", async (event) => {
  if (isLinkedSubtask(event)) {
    // 1. 写入项目级知识文件
    await knowledge.save(event.projectId, event.result);

    // 2. 写入 agent memories（个人级）
    await knowledge.memcommit(event.projectId, event.result);
  }
});
```

### 3.2 知识复用

下次查询前:
1. `before_agent_start` 注入提示词时，附带已有知识摘要
2. agent 看到已有知识，可能直接复用，跳过子任务
3. 如果仍需查找，子任务也能参考已有知识，缩小范围

### 3.3 双层沉淀

| 层级 | 位置 | 范围 | 用途 |
|------|------|------|------|
| 项目级 | `.pi/linked-knowledge/<id>.md` | 团队共享 | 团队成员都能复用 |
| 个人级 | agent memories (OpenViking) | 个人 | 跨项目个人知识积累 |

---

## 四、插件结构

```
.pi/extensions/linked-projects-bridge/
├── index.ts              # 插件入口，注册所有事件
├── config.ts             # 配置读写 + 文件监听
├── interceptor.ts        # tool_call 路径匹配 + 拦截逻辑
├── prompt-injector.ts    # before_agent_start 提示词构建
├── knowledge.ts          # 知识文件管理 + memcommit 沉淀
├── channel.ts            # linked-projects channel 双向通信
└── templates/
    └── scout.md          # 子任务 agent 模板（可选）
```

### 入口核心逻辑

```typescript
export default async function (pi: ExtensionContext) {
  const config = loadConfig(pi.cwd);
  const knowledge = new KnowledgeStore(pi.cwd);

  // 1. 提示词注入
  pi.on("before_agent_start", async (event) => {
    const prompt = buildLinkedProjectsPrompt(config, knowledge);
    return { message: { type: "context", content: prompt, display: "none" } };
  });

  // 2. 工具拦截
  pi.on("tool_call", async (event) => {
    const matched = matchLinkedPath(event.input, config.projects);
    if (matched) {
      return { block: true, reason: buildInterceptMessage(matched, event) };
    }
  });

  // 3. 知识沉淀
  pi.on("tool_result", async (event) => {
    if (isLinkedSubtask(event)) {
      await knowledge.save(event.projectId, event.result);
      await knowledge.memcommit(event.projectId, event.result);
    }
  });

  // 4. Channel 双向通信
  const channel = pi.registerChannel("linked-projects");
  channel.onReceive((data) => handleConfigUpdate(data, config));
}
```

---

## 五、完整数据流

```
1. 插件加载
   → 读 .pi/linked-projects.json
   → 读 .pi/linked-knowledge/*.md

2. before_agent_start
   → 注入关联项目信息 + 已有知识到系统提示词

3. Agent 需要查看关联项目代码
   → 尝试 read/bash/grep 等工具访问关联路径
   → tool_call 拦截 → 返回引导信息（推荐子任务 prompt）

4. Agent 启动子任务
   → 子任务 cwd = 关联项目路径
   → 子任务正常使用所有工具（不拦截）
   → 子任务返回结构化结果

5. tool_result 拦截
   → 检测到子任务目标是关联项目
   → 沉淀到 .pi/linked-knowledge/<id>.md（项目级）
   → memcommit 到 agent memories（个人级）

6. 下次同类查询
   → 系统提示词中已有知识
   → 可能直接命中，跳过子任务查找
```

---

## 六、依赖的 pi-mono 能力

| 能力 | 对应机制 | 状态 |
|------|---------|------|
| 工具调用拦截 | `pi.on("tool_call")` | ✅ 已有 |
| 系统提示词注入 | `before_agent_start` | ✅ 已有 |
| 子任务机制 | subagent 扩展 (spawn) | ✅ 已有 |
| Channel 通信 | `pi.registerChannel()` | ✅ 已有 |
| 工具结果修改 | `pi.on("tool_result")` | ✅ 已有 |
| Agent 模板 | `.md` 文件 frontmatter | ✅ 已有 |

**无需修改 pi-mono 核心代码，纯扩展即可实现。**
