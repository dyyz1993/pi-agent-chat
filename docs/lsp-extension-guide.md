# LSP 扩展功能实践指南

## 概述

LSP 扩展为 AI 编码助手提供实时的语言服务能力（诊断、跳转定义、查找引用等）。它有两种工作方式：

1. **自动诊断**：AI 编辑文件后，自动运行 LSP 校验
2. **主动工具调用**：LLM 在对话中主动调用 `lsp` 工具查询信息

---

## 前置条件

确保 `~/.pi/lsp.yaml` 配置文件存在且包含需要的服务器：

```yaml
servers:
  - name: typescript
    command: ["typescript-language-server", "--stdio"]
    fileTypes: ["ts", "tsx"]
  - name: eslint
    command: ["vscode-eslint-language-server", "--stdio"]
    fileTypes: ["ts", "tsx", "js", "jsx"]
  # ... 其他服务器
```

启动 pi 后，状态面板 LSP 区域应显示 "Connected (N servers)"。

---

## 三种诊断模式

| 模式         | 按钮名   | 触发时机                       | 数据呈现位置                                |
| ------------ | -------- | ------------------------------ | ------------------------------------------- |
| `agent_end`  | On End   | 整个对话回合结束后             | 聊天消息区 `<lsp>` 通知 + 状态面板          |
| `edit_write` | On Write | 每次 write/edit 执行完立即触发 | 聊天消息区 + 注入 LLM 工具返回值 + 状态面板 |
| `disabled`   | Off      | 不触发                         | 无                                          |

默认模式：`agent_end`

### 模式切换

- **状态面板**：展开 LSP 区域，点击 `On End` / `On Write` / `Off` 按钮
- **命令**：在聊天中输入 `/lsp edit_write` 或 `/lsp agent_end` 或 `/lsp disabled`

---

## 触发时机详解

### 1. session_start（自动）

pi 会话创建时，自动启动所有配置的 LSP 服务器。

```
会话创建 → startup_begin（状态面板显示 "Starting N servers..."）
         → 逐个服务器启动（黄点→绿点）
         → startup_complete（状态面板显示 "Connected (N servers)"）
```

### 2. agent_end 模式的自动诊断

```
用户发消息 → AI 工作（可能调用 write/edit 修改文件）
          → AI 回复结束（agent_end 事件触发）
          → LSP 收集本回合所有被编辑过的文件（不是整个项目）
          → 逐个文件：打开 → 等待 2 秒 → 拉取 diagnostics
          → 有问题时：
             - 聊天消息区：出现 "<lsp> src/foo.ts: 2 errors, 1 warning"
             - 状态面板：底部出现 "⚠️ src/foo.ts: 2 issues"
          → 没问题：静默，什么都不显示
```

**关键**：只检查本回合被 `write`/`edit` 修改过的文件，不会扫描整个项目。

### 3. edit_write 模式的自动诊断

```
AI 调用 write/edit 修改 src/foo.ts → tool_result 事件触发
  → LSP 立即：打开文件 → 格式化（可选）→ 等待 2 秒 → 拉取 diagnostics
  → 有问题时：
     - 聊天消息区：出现 "<lsp> src/foo.ts: ..."
     - LLM 工具返回值被注入诊断结果（LLM 下一轮能看到错误并尝试修复）
     - 状态面板：底部更新
  → 没问题：显示 "no diagnostics"
```

### 4. LLM 主动工具调用

LLM 可以调用 `lsp` 工具，支持 8 种 action：

| Action        | 用途           | 必须参数                                  |
| ------------- | -------------- | ----------------------------------------- |
| `diagnostics` | 获取文件诊断   | `path`（可选，不传=全部）                 |
| `definition`  | 跳转到定义     | `path` + `line` + `character`             |
| `references`  | 查找所有引用   | `path` + `line` + `character`             |
| `hover`       | 悬停信息       | `path` + `line` + `character`             |
| `symbols`     | 搜索符号       | `query` 或 `path`                         |
| `rename`      | 重命名符号     | `path` + `line` + `character` + `newName` |
| `status`      | 查看服务器状态 | 无                                        |
| `reload`      | 重载配置       | 无                                        |

LLM 还可以调用 `lsp_health` 工具（等价于 `lsp` 的 `status` action）。

调用时左侧聊天列表和右侧工具图标区会出现蓝色 Network 图标。

---

## 消息数据结构

### channel 推送（diagnostics_update）

后端推送到前端的结构化数据：

```json
{
  "event": "diagnostics_update",
  "timestamp": 1745678901234,
  "filePath": "src/foo.ts",
  "diagnostics": [
    {
      "range": {
        "start": { "line": 10, "character": 5 },
        "end": { "line": 10, "character": 15 }
      },
      "severity": 1,
      "code": "TS2322",
      "source": "ts",
      "message": "Type 'string' is not assignable to type 'number'."
    }
  ]
}
```

severity 含义：`1 = Error` `2 = Warning` `3 = Info` `4 = Hint`

### UI 呈现

| 位置               | 内容                                    | 数据来源                                               |
| ------------------ | --------------------------------------- | ------------------------------------------------------ |
| 聊天消息区         | `<lsp>` src/foo.ts: 2 errors, 1 warning | `ctx.ui.notify` 纯文本                                 |
| 状态面板底部       | ⚠️ `src/foo.ts: 2 issues`               | channel `diagnostics_update` → store `lastDiagnostics` |
| 状态面板服务器列表 | 绿点/红点 + 服务器名                    | channel `status_changed` / `startup_complete`          |
| 左侧 SideNav       | 蓝色 Network 图标                       | 仅 LLM 调用 `lsp`/`lsp_health` 工具时                  |
| 右侧 ToolIconList  | 蓝色 Network 图标                       | 仅 LLM 调用 `lsp`/`lsp_health` 工具时                  |

---

## 验证步骤

### 测试 1：服务器启动

1. 启动 pi，打开状态面板 → LSP 区域
2. 预期：看到 "Starting N servers..." → 逐个变绿 → "Connected (N servers)"

### 测试 2：模式切换

1. 状态面板 LSP 区域 → 点击 `On Write` 按钮
2. 预期：按钮高亮切换到 `On Write`
3. 刷新页面后重新连接，观察模式是否恢复

### 测试 3：自动诊断（agent_end 模式）

1. 确认模式为 `On End`
2. 让 AI 修改一个有 TypeScript 错误的文件
3. 等待 AI 回复结束
4. 预期：聊天消息区出现 `<lsp>` xxx.ts: N errors 通知

### 测试 4：自动诊断（edit_write 模式）

1. 切换到 `On Write` 模式
2. 让 AI 修改一个文件
3. 预期：每次修改后立即出现诊断结果

### 测试 5：LLM 主动调用

1. 在聊天中输入测试消息（见下方）
2. 预期：LLM 调用 `lsp` 工具，侧边栏出现蓝色 Network 图标

### 测试 6：刷新恢复

1. 等待 LSP 完全启动
2. 刷新页面
3. 预期：状态面板仍然显示 LSP 服务器列表和状态
