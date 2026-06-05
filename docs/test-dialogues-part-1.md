# Pi-Agent-Chat 测试话术手册：第 1 卷

[返回总览](./test-dialogues.md)

## 1. 基础对话流

### T1.1 发送首条消息（触发 auto-session-title）

```
🗣️ 用户话术：帮我看看这个项目的 package.json
```

| 维度              | 内容                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | 1. tool: read("package.json") 2. 返回文件内容摘要 3. turn_end → auto-session-title 生成会话标题                                                                           |
| 📦 扩展           | auto-session-title                                                                                                                                                        |
| 🔌 RPC            | agent.send, agent.start                                                                                                                                                   |
| 👁️ UI 验证点      | 消息气泡渲染（用户蓝/助手绿）；工具执行卡片(read, 蓝色文件图标)可折叠/展开；会话标题从 "New Chat" 变为有意义名称；TokenStatusBar 显示 token 用量；侧边导航点(SideNav)出现 |

### T1.2 流式消息与停止

```
🗣️ 用户话术：请详细解释 React hooks 的工作原理，包括 useState、useEffect、useMemo、useCallback、useRef，每个都给出代码示例
```

| 维度              | 内容                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | message_start → 流式 message_update → message_end                                                                                                         |
| 👁️ UI 验证点      | 文本逐字流式渲染；发送按钮→停止按钮(方块)；点击停止→Agent 中断；Markdown 渲染(代码高亮/列表/标题)；长文本出现展开按钮→MarkdownExpandOverlay；复制按钮可用 |

### T1.3 Thinking Block（思考块）

```
🗣️ 用户话术：分析 use-session-store.ts 的架构，给出重构建议
```

| 维度              | 内容                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| 🤖 Agent 预期行为 | 思考过程 → thinking block → 然后输出分析文本                                   |
| 👁️ UI 验证点      | ThinkingCard 出现(紫色边框)；可折叠/展开；流式完成后自动折叠(可配置)；复制按钮 |

### T1.4 中途转向 (Steering)

```
🗣️ 用户话术：帮我写一个复杂的排序算法
（Agent 开始流式输出后，立即输入转向）
🗣️ 转向话术：等一下，改用 TypeScript 写，并且加上性能测试
```

| 维度              | 内容                                                            |
| ----------------- | --------------------------------------------------------------- |
| 🤖 Agent 预期行为 | 收到 steer → 调整当前生成方向                                   |
| 🔌 RPC            | agent.steer                                                     |
| 👁️ UI 验证点      | 输入区出现转向按钮(闪电⚡图标, 琥珀色)；QueueCards 显示转向队列 |

### T1.5 后续消息 (Follow-Up)

```
🗣️ 用户话术：帮我分析 src/main.tsx 的代码结构
（Agent 工作中，输入后续消息）
🗣️ 后续话术：也顺便看看 App.tsx
```

| 维度              | 内容                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | followUp 进入队列等待当前 turn 完成                                              |
| 🔌 RPC            | agent.followUp                                                                   |
| 👁️ UI 验证点      | 发送按钮→时钟图标(Follow-Up)；QueueCards 显示 followUp 队列；turn 完成后自动处理 |

### T1.6 中断执行 (Abort)

```
🗣️ 用户话术：遍历 src/ 下所有 .ts 文件，分析每个文件的代码复杂度
（Agent 开始大量文件读取后点击停止）
```

| 维度              | 内容                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | abort → 停止工具执行 → 返回部分结果                                  |
| 🔌 RPC            | agent.abort                                                          |
| 👁️ UI 验证点      | 进行中的工具卡片变为"已中断"；状态 streaming→idle；停止按钮→发送按钮 |

---

## 2. Bash 扩展

### T2.1 基本命令执行

```
🗣️ 用户话术：运行 echo "Hello from pi-agent" && date && uname -a
```

| 维度              | 内容                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: bash({ command, description })                                                           |
| 📦 扩展           | bash-ext                                                                                       |
| 📡 Channel        | bash: start → output → end                                                                     |
| 👁️ UI 验证点      | BashRenderer 卡片；命令+状态(running→done)；流式输出；执行时间；退出码(0)；复制按钮；折叠/展开 |

### T2.2 长时间运行 → 自动后台化

```
🗣️ 用户话术：运行 sleep 30 && echo "done"
```

| 维度              | 内容                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | bash({ backgroundAfter: 10 }) → 10s 后 background 事件 → 工具提前返回                           |
| 📡 Channel        | bash: start → output → background                                                               |
| 🔌 RPC            | bash.list                                                                                       |
| 👁️ UI 验证点      | 前10s正常输出；backgroundAfter后卡片标记"后台运行"；StatusPanel Shell区段出现后台进程；Kill按钮 |

### T2.3 手动移至后台 + Kill

```
🗣️ 用户话术：启动一个持续运行的 HTTP 服务器：python3 -m http.server 8765
操作：1. 点击"移至后台" 2. StatusPanel>Shell 找到进程 3. 点击 Kill
```

| 维度         | 内容                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| 📡 Channel   | bash: background → terminated                                                   |
| 🔌 RPC       | bash.command({ action: "kill" })                                                |
| 👁️ UI 验证点 | Bash卡片"移至后台"按钮；点击后标记后台；StatusPanel Shell显示进程；Kill后已终止 |

### T2.4 交互式命令 (stdin)

```
🗣️ 用户话术：运行 cat 命令，然后通过 stdin 发送 "test input line"
```

| 维度              | 内容                                      |
| ----------------- | ----------------------------------------- |
| 🤖 Agent 预期行为 | bash({ command: "cat" }) → write_stdin    |
| 📡 Channel        | bash: write_stdin                         |
| 👁️ UI 验证点      | Bash卡片显示运行中；输出显示stdin数据回显 |

### T2.5 命令执行失败

```
🗣️ 用户话术：尝试运行 ls /nonexistent_directory_xyz
```

| 维度              | 内容                                           |
| ----------------- | ---------------------------------------------- |
| 🤖 Agent 预期行为 | bash → 非零退出码                              |
| 📡 Channel        | bash: end (exitCode != 0)                      |
| 👁️ UI 验证点      | Bash卡片状态 error(红色)；错误信息；非零退出码 |

### T2.6 危险命令拦截

```
🗣️ 用户话术：运行 rm -rf /tmp/test_data
```

| 维度              | 内容                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | agent-permissions 拦截 → extension_ui_request(confirm)                      |
| 📦 扩展           | agent-permissions                                                           |
| 👁️ UI 验证点      | 确认对话框(ConfirmCard)；风险提示；确认/取消按钮；UIPendingCenter badge更新 |

### T2.7 后台进程日志查看

```
🗣️ 用户话术：运行一个后台构建命令 npm run build，查看日志
操作：StatusPanel > Shell > 展开进程 > 查看日志
```

| 维度         | 内容                                                   |
| ------------ | ------------------------------------------------------ |
| 🔌 RPC       | bash.readLog / bash.watchLog / bash.unwatchLog         |
| 👁️ UI 验证点 | 日志查看器；偏移量/分页；总行数+hasMore；实时watch模式 |

---

## 3. 文件操作与预览

### T3.1 读取文件

```
🗣️ 用户话术：读取 src/mainview/index.css 的内容
```

| 维度              | 内容                                                 |
| ----------------- | ---------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: read("src/mainview/index.css")                 |
| 👁️ UI 验证点      | ReadFileCard；文件路径+大小；可展开查看；CSS语法高亮 |

### T3.2 创建文件

```
🗣️ 用户话术：创建一个新文件 src/test-example.ts，内容是 hello world 函数
```

| 维度              | 内容                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: write("src/test-example.ts", content)                                      |
| 👁️ UI 验证点      | WriteFileCard；操作类型(create)；InlineDiffViewer 绿色新增行；文件资源管理器更新 |

### T3.3 编辑文件

```
🗣️ 用户话术：在 src/test-example.ts 中添加导出语句，修改函数名为 greet
```

| 维度              | 内容                                                             |
| ----------------- | ---------------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: edit("src/test-example.ts", [{ oldText, newText }])        |
| 👁️ UI 验证点      | WriteFileCard 编辑操作；InlineDiffViewer 红绿对比(删除红/新增绿) |

### T3.4 文件搜索 (grep)

```
🗣️ 用户话术：在 src/mainview/ 目录下搜索所有包含 "useTheme" 的文件
```

| 维度              | 内容                                             |
| ----------------- | ------------------------------------------------ |
| 🤖 Agent 预期行为 | tool: grep("useTheme", "src/mainview/")          |
| 👁️ UI 验证点      | 搜索工具卡片(搜索图标)；结果列表；文件和行号高亮 |

### T3.5 Glob 模式

```
🗣️ 用户话术：列出 src/mainview/stores/ 下所有 use- 开头的 .ts 文件
```

| 维度              | 内容                                        |
| ----------------- | ------------------------------------------- |
| 🤖 Agent 预期行为 | tool: glob("src/mainview/stores/use-\*.ts") |
| 👁️ UI 验证点      | 工具卡片显示 glob 模式；返回匹配文件列表    |

### T3.6 文件附件上传

```
🗣️ 操作：点击输入区域的📎按钮，选择一个图片文件和一个代码文件上传
```

| 维度         | 内容                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| 👁️ UI 验证点 | AttachmentBar 显示上传预览(缩略图+文件名+大小+状态)；pending→uploading→done；可单独移除；发送时注入 @path 引用 |

---

## 4. Todo 扩展

### T4.1 创建 Todo 列表

```
🗣️ 用户话术：帮我规划一个前端重构任务：
1. 分析现有组件结构
2. 提取公共组件到 shared/
3. 重构状态管理
4. 添加单元测试
5. 更新文档
```

| 维度              | 内容                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | todo({ action: "add" }) × 5                                                        |
| 📦 扩展           | todo-ext                                                                           |
| 📡 Channel        | todo: add events                                                                   |
| 🔌 RPC            | todo.list                                                                          |
| 👁️ UI 验证点      | Todo工具卡片(复选框图标)；StatusPanel>Plan Mode显示列表；优先级(H/M/L)；未完成状态 |

### T4.2 完成 Todo

```
🗣️ 用户话术：把第 1 和第 2 步标记为完成
```

| 维度              | 内容                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | todo({ action: "toggle", id: 1 }), todo({ action: "toggle", id: 2 }) |
| 📡 Channel        | todo: toggle                                                         |
| 👁️ UI 验证点      | StatusPanel>Plan Mode 划线+勾选                                      |

### T4.3 删除 Todo

```
🗣️ 用户话术：删除第 5 步（更新文档）
```

| 维度              | 内容                              |
| ----------------- | --------------------------------- |
| 🤖 Agent 预期行为 | todo({ action: "remove", id: 5 }) |
| 📡 Channel        | todo: remove                      |
| 👁️ UI 验证点      | StatusPanel 项消失                |

### T4.4 清空 Todo

```
🗣️ 用户话术：清空所有待办事项
```

| 维度              | 内容                      |
| ----------------- | ------------------------- |
| 🤖 Agent 预期行为 | todo({ action: "clear" }) |
| 📡 Channel        | todo: clear               |
| 👁️ UI 验证点      | Plan Mode 清空            |

### T4.5 查看 Todo

```
🗣️ 用户话术：当前有什么待办任务？
```

| 维度              | 内容                     |
| ----------------- | ------------------------ |
| 🤖 Agent 预期行为 | todo({ action: "list" }) |
| 🔌 RPC            | todo.list                |
| 👁️ UI 验证点      | 返回当前列表             |

---

## 5. 子智能体 (Subagent)

### T5.1 单个子智能体

```
🗣️ 用户话术：用 code-reviewer 子智能体审查 src/mainview/stores/use-session-store.ts 的代码质量
```

| 维度              | 内容                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | subagent({ agent: "code-reviewer", task: "..." }) → subagent_start → 代理事件 → end                                                           |
| 📦 扩展           | subagent / subagent-ext / subagent-v2                                                                                                         |
| 📡 Channel        | subagent: subagent_start → proxied events → end                                                                                               |
| 🔌 RPC            | subagent.listBySession                                                                                                                        |
| 👁️ UI 验证点      | SubagentRenderer卡片；状态芯片 running→completed；"查看"按钮导航到子智能体；侧边栏出现紫色Bot图标会话；子智能体有独立消息流；"返回主会话"按钮 |

### T5.2 并行子智能体

```
🗣️ 用户话术：同时让两个子智能体分别审查 use-session-store.ts 和 use-chat-store.ts
```

| 维度              | 内容                                                   |
| ----------------- | ------------------------------------------------------ |
| 🤖 Agent 预期行为 | subagent_parallel({ tasks: [...] })                    |
| 👁️ UI 验证点      | 多个并行子智能体；各自独立状态指示器；侧边栏多个子会话 |

### T5.3 链式子智能体

```
🗣️ 用户话术：先让 researcher 调研 React 19 新特性，然后把结果交给 coder 写示例
```

| 维度              | 内容                                                               |
| ----------------- | ------------------------------------------------------------------ |
| 🤖 Agent 预期行为 | subagent_chain({ chain: [{ researcher }, { coder, {previous} }] }) |
| 👁️ UI 验证点      | 链式执行；第一个完成后开始第二个                                   |

### T5.4 子智能体管理

```
操作：在侧边栏子智能体会话上右键/悬停
1. 重命名
2. 复制 ID
3. 删除
```

| 维度         | 内容                                                         |
| ------------ | ------------------------------------------------------------ |
| 🔌 RPC       | subagent.rename / subagent.delete                            |
| 👁️ UI 验证点 | 重命名：内联编辑框；复制ID：Toast提示；删除：确认对话框→消失 |

---

## 6. 记忆系统 (Auto-Memory)

### T6.1 手动记忆保存

```
🗣️ 用户话术：记住这个项目的 CSS 变量定义在 src/mainview/index.css 中，包含 --color-bg-*, --color-text-*, --color-border-* 三大类别
```

| 维度              | 内容                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: remember({ content: "..." }) → message_end → memory_extract                                                                                        |
| 📦 扩展           | auto-memory                                                                                                                                              |
| 📡 Channel        | memory: bookmark_creating → memory_updated                                                                                                               |
| 👁️ UI 验证点      | 记忆工具卡片(brain图标,teal色)；MemoryPanel>Recent Operations显示bookmark；MemoryPanel>Memory Files更新；文件有类型标签(project/user/feedback/reference) |

### T6.2 记忆预取

```
🗣️ 用户话术：帮我修改主题系统
```

| 维度              | 内容                                                 |
| ----------------- | ---------------------------------------------------- |
| 🤖 Agent 预期行为 | auto-memory → memory_prefetch → 返回相关记忆         |
| 📡 Channel        | memory: memory_prefetch → memory_prefetch_result     |
| 👁️ UI 验证点      | custom_entry 记忆卡片；MemoryPanel prefetch 操作记录 |

### T6.3 梦境整合

```
🗣️ 用户话术：整理一下记忆，合并重复内容
```

| 维度              | 内容                                       |
| ----------------- | ------------------------------------------ |
| 🤖 Agent 预期行为 | tool: memory_dream()                       |
| 📡 Channel        | memory: memory_dream → memory_dream_result |
| 👁️ UI 验证点      | MemoryPanel dream 操作；记忆文件合并/精简  |

### T6.4 记忆面板交互

```
操作：在 MemoryPanel 中：
1. "This Injection" — 当前注入的记忆项
2. 展开 "Memory Files" — 内容预览
3. "Memory Index" — entrypoint 内容
4. "Recent Operations" — 最近10次操作日志
```

| 维度         | 内容                                                       |
| ------------ | ---------------------------------------------------------- |
| 🔌 RPC       | memory.listFiles / memory.readFile                         |
| 👁️ UI 验证点 | 四区段可折叠/展开；文件内容预览；操作日志有时间戳+类型标签 |

### T6.5 通过消息选择保存记忆

```
操作：
1. 选择一条或多条消息（复选框）
2. MessageSelectionBar > Brain图标 > 保存
```

| 维度         | 内容                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 🔌 RPC       | memory.remember                                                            |
| 👁️ UI 验证点 | MessageSelectionBar 浮动；选中数+token统计；Toast提示成功；MemoryPanel更新 |

---

## 7. 规则引擎 (Rules-Engine)

### T7.1 规则加载

```
🗣️ 用户话术：开始工作吧（新会话启动时自动触发）
```

| 维度              | 内容                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | rules-engine 扫描 .pi/rules/ 等目录 → snapshot 事件                                                                                   |
| 📦 扩展           | rules-engine                                                                                                                          |
| 📡 Channel        | rules-engine: snapshot                                                                                                                |
| 🔌 RPC            | rules.list / rules.requestSnapshot                                                                                                    |
| 👁️ UI 验证点      | RulesPanel>Loading Source 扫描目录+数量；Always Active Rules 无条件规则；严重级别标签(error/warn/info)；展开查看描述/源文件/glob/内容 |

### T7.2 条件规则匹配

```
🗣️ 用户话术：修改 src/mainview/index.css 中的 --color-bg-primary 变量
```

| 维度              | 内容                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | edit → rules-engine on("tool_call") 匹配 → matched 事件               |
| 📡 Channel        | rules-engine: matched                                                 |
| 👁️ UI 验证点      | RulesPanel>Conditional Rules 显示 glob 规则；Trigger History 匹配记录 |

### T7.3 规则重载

```
🗣️ 用户话术：我新增了规则文件到 .pi/rules/，请重新加载规则
```

| 维度         | 内容                                       |
| ------------ | ------------------------------------------ |
| 📡 Channel   | rules-engine: reloaded                     |
| 👁️ UI 验证点 | RulesPanel>Lifecycle reload 事件；列表更新 |

---

## 8. 协调器 (Coordinator)

### T8.1 创建委托会话

```
🗣️ 用户话术：在后台创建一个新会话来分析 src/ 下所有文件的代码复杂度
```

| 维度              | 内容                                               |
| ----------------- | -------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: session_delegate({ task, title })            |
| 📦 扩展           | coordinator                                        |
| 📡 Channel        | coordinator: session_delegate / session_created    |
| 👁️ UI 验证点      | 协调器工具卡片；侧边栏出现新委托会话；独立状态指示 |

### T8.2 发送消息给委托会话

```
🗣️ 用户话术：告诉那个分析会话，也把测试文件包含在分析中
```

| 维度              | 内容                                                      |
| ----------------- | --------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: session_delegate_send({ targetSessionId, message }) |
| 📡 Channel        | coordinator: session_delegate_send                        |
| 👁️ UI 验证点      | 委托会话开始处理；状态→working                            |

### T8.3 查看委托状态

```
🗣️ 用户话术：那个分析会话进展如何？
```

| 维度              | 内容                                         |
| ----------------- | -------------------------------------------- |
| 🤖 Agent 预期行为 | tool: session_delegate_status({ sessionId }) |
| 📡 Channel        | coordinator: session_delegate_status         |
| 👁️ UI 验证点      | 返回 status/isCompacting/contextUsage        |

### T8.4 列出所有委托

```
🗣️ 用户话术：列出所有后台委托会话
```

| 维度              | 内容                               |
| ----------------- | ---------------------------------- |
| 🤖 Agent 预期行为 | tool: session_delegate_list()      |
| 📡 Channel        | coordinator: session_delegate_list |
| 👁️ UI 验证点      | 返回会话列表+状态+标题             |

### T8.5 停止委托

```
🗣️ 用户话术：停止那个分析会话
```

| 维度              | 内容                                       |
| ----------------- | ------------------------------------------ |
| 🤖 Agent 预期行为 | tool: session_delegate_stop({ sessionId }) |
| 📡 Channel        | coordinator: session_delegate_stop         |
| 👁️ UI 验证点      | 状态→stopped；侧边栏更新                   |

### T8.6 分叉委托

```
🗣️ 用户话术：从那个分析会话分叉一个，专注 src/stores/
```

| 维度              | 内容                                                    |
| ----------------- | ------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: session_delegate_fork({ sessionId, task, title }) |
| 📡 Channel        | coordinator: session_delegate_fork                      |
| 👁️ UI 验证点      | 侧边栏新分叉会话；继承上下文                            |

---

## 9. 用户交互工具 (Ask-Tools)

### T9.1 确认对话框

```
🗣️ 用户话术：删除 src/test-example.ts 文件
```

| 维度              | 内容                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: ask-confirm({ title, question })                                                                         |
| 📦 扩展           | ask-tools                                                                                                      |
| 📡 Event          | extension_ui_request (method: "confirm")                                                                       |
| 🔌 RPC            | agent.respondUI                                                                                                |
| 👁️ UI 验证点      | ConfirmCard；标题+问题；确认/取消按钮；UIPendingCenter bell+badge；Agent 状态→permission；确认→继续；取消→中止 |

### T9.2 选择对话框 — 单选

```
🗣️ 用户话术：我想换一个颜色主题，给我几个选项
```

| 维度              | 内容                                                             |
| ----------------- | ---------------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: ask-select({ title, options, multiple: false })            |
| 📡 Event          | extension_ui_request (method: "select")                          |
| 👁️ UI 验证点      | SelectCard 单选(radio)；选项可点击；"自定义回答"输入框；提交按钮 |

### T9.3 选择对话框 — 多选

```
🗣️ 用户话术：选择需要重构的模块
```

| 维度              | 内容                                                 |
| ----------------- | ---------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: ask-select({ title, options, multiple: true }) |
| 👁️ UI 验证点      | SelectCard 多选(checkbox)；已选数量显示              |

### T9.4 输入对话框

```
🗣️ 用户话术：创建一个新组件，问我组件名
```

| 维度              | 内容                                        |
| ----------------- | ------------------------------------------- |
| 🤖 Agent 预期行为 | tool: ask-input({ title, placeholder })     |
| 📡 Event          | extension_ui_request (method: "input")      |
| 👁️ UI 验证点      | InputCard；文本输入框+placeholder；提交按钮 |

### T9.5 编辑器对话框

```
🗣️ 用户话术：帮我写一个 commit message，先给我草稿让我编辑
```

| 维度              | 内容                                         |
| ----------------- | -------------------------------------------- |
| 🤖 Agent 预期行为 | tool: ask-editor({ title, prefill })         |
| 📡 Event          | extension_ui_request (method: "editor")      |
| 👁️ UI 验证点      | EditorCard；Textarea+预填内容；提交/取消按钮 |

### T9.6 通知

```
🗣️ 场景：Agent 完成长时间操作后触发
```

| 维度              | 内容                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| 🤖 Agent 预期行为 | tool: ask-notify({ message, type })                                            |
| 📡 Event          | extension_ui_request (method: "notify")                                        |
| 👁️ UI 验证点      | NotifyCard；消息+类型(info/success/warning/error)；NotificationCenter 收到通知 |

### T9.7 UI Pending Center

```
操作：多个 UI 请求待处理时
1. 点击 Bell 图标(badge)
2. UIPendingCenter 全屏模态
3. 查看所有待处理请求
4. 点击跳转到会话
5. 直接响应请求
```

| 维度         | 内容                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| 👁️ UI 验证点 | 所有会话的待处理请求；卡片可交互；"Go to session"跳转；响应后消失+badge更新 |

---

## 10. LSP 诊断

### T10.1 LSP 启动与诊断

```
🗣️ 用户话术：分析 src/mainview/stores/use-chat-store.ts 的 TypeScript 错误
```

| 维度              | 内容                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🤖 Agent 预期行为 | LSP 自动启动 → tool: lsp\_\* → 诊断结果                                                                                                                |
| 📦 扩展           | lsp                                                                                                                                                    |
| 📡 Channel        | lsp                                                                                                                                                    |
| 🔌 RPC            | lsp.status                                                                                                                                             |
| 👁️ UI 验证点      | StatusPanel>LSP: inactive→starting→ready；Active Languages "TypeScript" badge；Startup Log；LspExecutionCard 诊断结果；严重级别颜色(红error/黄warning) |

### T10.2 LSP 模式切换

```
操作：StatusPanel > LSP > Diagnostics Mode 下拉切换
- agent_end / edit_write / disabled
```

| 维度         | 内容                         |
| ------------ | ---------------------------- |
| 🔌 RPC       | lsp.setMode                  |
| 👁️ UI 验证点 | 下拉切换；立即生效；标签更新 |

---

## 11. 文件快照 (File-Snapshot)

### T11.1 自动快照

```
🗣️ 用户话术：修改 src/test-example.ts，添加参数类型注解
```

| 维度              | 内容                                           |
| ----------------- | ---------------------------------------------- |
| 🤖 Agent 预期行为 | edit → turn_end → file-snapshot 自动创建       |
| 📦 扩展           | file-snapshot                                  |
| 🔌 RPC            | snapshot.list                                  |
| 👁️ UI 验证点      | SnapshotPanel 新快照(步骤索引/时间戳/文件数量) |

### T11.2 快照回滚

```
操作：SnapshotPanel > 点击快照 "Rollback" 按钮
```

| 维度         | 内容                                             |
| ------------ | ------------------------------------------------ |
| 🔌 RPC       | snapshot.rollback                                |
| 👁️ UI 验证点 | 文件恢复；快照标记"已回滚"；RollbackOverlay 预览 |

### T11.3 撤销回滚

```
操作：SnapshotPanel > 已回滚快照 "Unrevert" 按钮
```

| 维度         | 内容                   |
| ------------ | ---------------------- |
| 🔌 RPC       | snapshot.unrevert      |
| 👁️ UI 验证点 | 文件恢复；快照状态正常 |

### T11.4 快照树导航

```
操作：SnapshotPanel > 浏览快照文件树
```

| 维度         | 内容                                     |
| ------------ | ---------------------------------------- |
| 🔌 RPC       | snapshot.navigateTree / snapshot.getTree |
| 👁️ UI 验证点 | 树形目录；展开文件夹；查看文件内容       |

---

## 12. 预览工具 (Preview)

### T12.1 预览图片

```
🗣️ 用户话术：预览 public/logo.svg
```

| 维度              | 内容                                         |
| ----------------- | -------------------------------------------- |
| 🤖 Agent 预期行为 | tool: preview({ source: "public/logo.svg" }) |
| 📦 扩展           | preview                                      |
| 👁️ UI 验证点      | PreviewRenderer ImageCard；内联显示          |

### T12.2 预览 URL

```
🗣️ 用户话术：预览 https://example.com
```

| 维度              | 内容                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: preview({ source: "https://example.com" })                                  |
| 👁️ UI 验证点      | UrlCard；"点击加载"按钮；iframe 加载；全屏按钮(含safe-area)；刷新/复制链接/新窗口 |

### T12.3 预览 HTML

```
🗣️ 用户话术：创建一个简单 HTML 文件并预览
```

| 维度              | 内容                                                  |
| ----------------- | ----------------------------------------------------- |
| 🤖 Agent 预期行为 | write("test.html") → preview({ source: "test.html" }) |
| 👁️ UI 验证点      | HtmlCard；iframe 沙箱；全屏/刷新/复制                 |

### T12.4 预览 PDF

```
🗣️ 用户话术：预览 docs/test-report.pdf
```

| 维度              | 内容                                              |
| ----------------- | ------------------------------------------------- |
| 🤖 Agent 预期行为 | tool: preview({ source: "docs/test-report.pdf" }) |
| 👁️ UI 验证点      | PdfCard；iframe PDF渲染；全屏/刷新/复制           |

### T12.5 预览视频/音频

```
🗣️ 用户话术：预览 assets/demo.mp4 和 assets/notification.mp3
```

| 维度              | 内容                               |
| ----------------- | ---------------------------------- |
| 🤖 Agent 预期行为 | preview × 2                        |
| 👁️ UI 验证点      | VideoCard 播放器；AudioCard 播放器 |

### T12.6 预览 Markdown

```
🗣️ 用户话术：预览 README.md
```

| 维度              | 内容                                     |
| ----------------- | ---------------------------------------- |
| 🤖 Agent 预期行为 | tool: preview({ source: "README.md" })   |
| 👁️ UI 验证点      | MarkdownCard 渲染(标题/列表/代码块/链接) |

---

## 13. 自动会话标题

### T13.1 触发自动命名

```
🗣️ 用户话术：帮我优化 React 组件的性能
```

| 维度              | 内容                                                   |
| ----------------- | ------------------------------------------------------ |
| 🤖 Agent 预期行为 | turn_end → auto-session-title callLLM → session_rename |
| 📦 扩展           | auto-session-title                                     |
| 📡 Event          | session_rename                                         |
| 👁️ UI 验证点      | 侧边栏 "New Chat" → 描述性标题(≤50字符)                |

---

## 14. 上下文压缩

### T14.1 手动压缩

```
🗣️ 用户话术：压缩一下上下文，保留关键信息
```

| 维度              | 内容                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| 🤖 Agent 预期行为 | compact({ customInstructions })                                                              |
| 📦 扩展           | compaction-manager                                                                           |
| 📡 Event          | compaction_start → compaction_end                                                            |
| 🔌 RPC            | agent.compact                                                                                |
| 👁️ UI 验证点      | 状态→compacting(黄)；compaction_summary 消息(cyan边框)；前后token数；TokenStatusBar 大幅减少 |

### T14.2 自动压缩

```
场景：长对话上下文接近上限
```

| 维度              | 内容                                   |
| ----------------- | -------------------------------------- |
| 🤖 Agent 预期行为 | compaction-manager 监控 → 阈值自动压缩 |
| 👁️ UI 验证点      | TokenStatusBar 环形进度满→红/橙警告    |

---

## 15. 会话管理

### T15.1 创建新会话

```
操作：侧边栏 "+" 按钮 / Ctrl+Cmd+N
```

| 维度         | 内容                                     |
| ------------ | ---------------------------------------- |
| 🔌 RPC       | session.create / agent.newSession        |
| 👁️ UI 验证点 | 空会话出现在侧边栏；聊天清空；输入框聚焦 |

### T15.2 切换会话

```
操作：侧边栏点击另一个会话
```

| 维度         | 内容                                                                |
| ------------ | ------------------------------------------------------------------- |
| 🔌 RPC       | agent.start (switchSession)                                         |
| 👁️ UI 验证点 | 消息切换；加载指示器；TokenStatusBar 更新；侧边栏高亮；面板数据更新 |

### T15.3 置顶会话

```
操作：侧边栏 Pin 图标
```

| 维度         | 内容                                   |
| ------------ | -------------------------------------- |
| 🔌 RPC       | session.pin / session.unpin            |
| 👁️ UI 验证点 | 移到顶部(置顶区)；图标变实心；再点取消 |

### T15.4 重命名会话

```
操作：侧边栏悬停 > 编辑图标
```

| 维度         | 内容                                  |
| ------------ | ------------------------------------- |
| 🔌 RPC       | session.rename / agent.setSessionName |
| 👁️ UI 验证点 | 内联编辑框；Enter 确认；Escape 取消   |

### T15.5 删除会话

```
操作：侧边栏悬停 > 删除图标
```

| 维度         | 内容                             |
| ------------ | -------------------------------- |
| 🔌 RPC       | session.delete                   |
| 👁️ UI 验证点 | 确认对话框；消失后切换到最近会话 |

### T15.6 搜索会话

```
操作：侧边栏搜索框输入关键词
```

| 维度         | 内容                                         |
| ------------ | -------------------------------------------- |
| 👁️ UI 验证点 | 实时过滤；匹配名称/首条消息/ID；无匹配空状态 |

### T15.7 Fork 会话

```
操作：消息卡片头部 > Fork 按钮(GitBranch 图标)
```

| 维度         | 内容                                     |
| ------------ | ---------------------------------------- |
| 🔌 RPC       | agent.fork                               |
| 👁️ UI 验证点 | 确认弹窗；新会话继承消息；侧边栏嵌套显示 |

### T15.8 克隆会话

```
🗣️ 用户话术：克隆当前会话
```

| 维度         | 内容             |
| ------------ | ---------------- |
| 🔌 RPC       | agent.clone      |
| 👁️ UI 验证点 | 完全相同的新会话 |

### T15.9 导出 HTML

```
🗣️ 用户话术：把当前对话导出为 HTML
```

| 维度         | 内容             |
| ------------ | ---------------- |
| 🔌 RPC       | agent.exportHtml |
| 👁️ UI 验证点 | HTML 文件生成    |

---
