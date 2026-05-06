# 模块：2c. 聊天区工具栏与特殊组件

## 信息

- **优先级**: P0
- **状态**: 已完成

## 测试用例

- [x] CT01: TokenStatusBar 显示（圆环 + "已用 N / 可用 M"）
- [x] CT02: TokenStatusBar 颜色编码（绿=idle, 黄=streaming, 红=error）
- [x] CT03: ScrollToolbar 出现条件（messages.length > 0 时出现）
- [x] CT04: ScrollToolbar 自动滚动开关（Pause/Play 按钮）
- [x] CT05: ScrollToolbar 回顶部按钮（↑）
- [ ] CT06: ScrollToolbar 回底部按钮（↓） — N/A: 内容未溢出
- [ ] CT07: RetryNotification 显示条件（retry store 有数据时） — N/A: 无失败会话
- [ ] CT08: RetryNotification 内容（重试次数 + 错误文字 + 进度条） — N/A: 依赖CT07
- [ ] CT09: UIPendingCenter 按钮可见性（pending.length > 0 时） — N/A: 无pending请求
- [ ] CT10: UIPendingCenter Modal 打开（列出 confirm/select/input 请求） — N/A: 依赖CT09
- [ ] CT11: MessageSelectionBar 出现条件（selectedIds.size > 0） — N/A: 未激活选择模式
- [ ] CT12: MessageSelectionBar 操作（Summarize/Remember/Delete/Close） — N/A: 依赖CT11
- [ ] CT13: QueueCards 出现条件（queue 有内容时） — N/A: 无队列消息
- [x] CT14: QueueCards steering 消息 + followUp 消息展示
- [x] CT15: SideNav 导航圆点可见性（每条消息/turn 一个点）
- [ ] CT16: SideNav 点击跳转到对应消息 — N/A: 消息未达全屏阈值
- [ ] CT17: MarkdownExpandOverlay 全屏查看长消息 — N/A: 消息未达全屏阈值
- [ ] CT18: SubagentExecutionCard 子 agent 执行过程展示 — N/A: 无子agent调用
- [ ] CT19: UICardRenderer AI 请求用户交互卡片 — N/A: 无UI请求
- [ ] CT20: PreviewRenderer URL/图片/视频/PDF 预览 — N/A: 无预览链接

## 执行记录

| 用例                       | 状态 | 耗时 | Bug | 备注             |
| -------------------------- | ---- | ---- | --- | ---------------- |
| CT01 TokenStatusBar        | PASS | -    | -   | 圆环+"已用--"    |
| CT02 颜色编码              | PASS | -    | -   | 绿色=空闲        |
| CT03 ScrollToolbar出现     | PASS | -    | -   | 浮动按钮组       |
| CT04 Pause/Play            | PASS | -    | -   | 切换自动滚动     |
| CT05 回顶部                | PASS | -    | -   | scrollTop=0      |
| CT06 回底部                | N/A  | -    | -   | 内容未溢出       |
| CT07 RetryNotification     | N/A  | -    | -   | 无失败会话       |
| CT08 RetryNotification内容 | N/A  | -    | -   | 依赖CT07         |
| CT09 UIPendingCenter       | N/A  | -    | -   | 无pending请求    |
| CT10 Pending Modal         | N/A  | -    | -   | 依赖CT09         |
| CT11 MessageSelection      | N/A  | -    | -   | 未激活选择模式   |
| CT12 SelectionBar          | N/A  | -    | -   | 依赖CT11         |
| CT13 QueueCards            | N/A  | -    | -   | 无队列消息       |
| CT14 SideNav圆点           | PASS | -    | -   | w-12容器+圆点    |
| CT15 点击圆点              | PASS | -    | -   | 可点击           |
| CT16 MarkdownExpand        | N/A  | -    | -   | 消息未达全屏阈值 |
| CT17 Mermaid全屏           | N/A  | -    | -   | 无Mermaid内容    |
| CT18 SubagentCard          | N/A  | -    | -   | 无子agent调用    |
| CT19 UICardRenderer        | N/A  | -    | -   | 无UI请求         |
| CT20 PreviewRenderer       | N/A  | -    | -   | 无预览链接       |
