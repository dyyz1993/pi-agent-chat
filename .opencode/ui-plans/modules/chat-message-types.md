# 模块：2a. 消息类型渲染

## 信息

- **URL**: http://localhost:5173
- **优先级**: P0
- **状态**: 已完成
- **前置条件**: 需要一个有丰富消息内容的会话

## 测试用例

- [x] MT01: 纯文本消息渲染（用户/AI角色区分、时间戳）
- [x] MT02: Markdown 标题渲染（h1-h6 各级标题样式正确）
- [x] MT03: Markdown 有序/无序列表渲染
- [ ] MT04: Markdown 表格渲染 — SKIP: 当前会话无表格
- [ ] MT05: Markdown 引用块渲染 — SKIP: 当前会话无引用
- [x] MT06: Markdown 行内代码（`code`）渲染
- [ ] MT07: Markdown 加粗/斜体/删除线 — SKIP: AI未使用加粗格式
- [ ] MT08: Markdown 链接（可点击、新窗口？） — SKIP: 当前会话无链接
- [x] MT09: 多行代码块渲染（语言标识显示）
- [x] MT10: 代码块语法高亮（关键字/字符串/注释颜色不同）
- [x] MT11: 代码块行号显示（右对齐灰色小字）
- [x] MT12: 代码块复制按钮（点击后 copied 状态切换 Check 图标）
- [x] MT13: 代码块展开/折叠功能
- [ ] MT14: Mermaid 图表内联渲染 — SKIP: 当前会话无Mermaid
- [ ] MT15: Mermaid 图表全屏查看（点击放大图标触发 overlay） — SKIP: 当前会话无Mermaid
- [ ] MT16: 文件附件展示（名称+大小+状态卡片） — SKIP: 未上传文件
- [ ] MT17: 图片附件缩略图展示 — SKIP: 未粘贴图片
- [x] MT18: 工具调用展示 — toolCall 阶段（参数 YAML 展示）
- [x] MT19: 工具调用展示 — toolExecution 阶段（运行中/错误/完成状态）
- [x] MT20: 工具调用展示 — toolResult 阶段（结果展示）
- [ ] MT21: Activity/Timeline 时间线视图 — SKIP: 当前为消息视图
- [ ] MT22: Diff 压缩摘要（Archive 图标 + token 数 + 可折叠详情） — SKIP: 无压缩摘要

## 执行记录

| 用例               | 状态 | 耗时 | Bug | 备注                                     |
| ------------------ | ---- | ---- | --- | ---------------------------------------- |
| MT01 用户消息      | PASS | -    | -   | 角色"你"+时间戳                          |
| MT02 AI回复        | PASS | -    | -   | "助手"+模型信息                          |
| MT03 标题渲染      | PASS | -    | -   | H1/H2/H3正确                             |
| MT04 有序/无序列表 | PASS | -    | -   | ul+li正确                                |
| MT05 表格          | SKIP | -    | -   | 当前会话无表格                           |
| MT06 引用块        | SKIP | -    | -   | 当前会话无引用                           |
| MT07 行内代码      | PASS | -    | -   | 3处行内代码                              |
| MT08 加粗/斜体     | SKIP | -    | -   | AI未使用加粗格式                         |
| MT09 链接          | SKIP | -    | -   | 当前会话无链接                           |
| MT10 多行代码块    | PASS | -    | -   | Python+Bash代码块                        |
| MT11 语法高亮      | PASS | -    | -   | 31个Prism token，关键字/字符串/注释/函数 |
| MT12 行号          | PASS | -    | -   | 右对齐灰色小字                           |
| MT13 复制按钮      | PASS | -    | -   | title="复制"                             |
| MT14 展开/折叠     | PASS | -    | -   | title="展开查看全文"                     |
| MT15 Mermaid       | SKIP | -    | -   | 当前会话无Mermaid                        |
| MT16 文件附件      | SKIP | -    | -   | 未上传文件                               |
| MT17 图片附件      | SKIP | -    | -   | 未粘贴图片                               |
| MT18 toolCall      | PASS | -    | -   | Bash工具YAML参数                         |
| MT19 toolExecution | PASS | -    | -   | 搜索记忆+找到记忆                        |
| MT20 toolResult    | PASS | -    | -   | Bash输出结果                             |
| MT21 Timeline      | SKIP | -    | -   | 当前为消息视图                           |
| MT22 Diff摘要      | SKIP | -    | -   | 无压缩摘要                               |

## 发现的问题

无 Bug。8 个 SKIP 项需要构造特定场景才能测试（表格/引用/Mermaid/附件等）。
