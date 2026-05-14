# Subagent & 会话交互验证清单

## 执行信息

- **日期**: 2026-05-14
- **执行人**: ui-tester
- **环境**: http://localhost:5173 / http://localhost:3100
- **视口**: 1440×900

## A 组：侧边栏会话列表（10 个）

- [ ] A1 主会话选中态（indigo 渐变 + ring）
- [ ] A2 Subagent 选中态（purple 渐变 + ring）
- [ ] A3 从 subagent 切回主会话
- [ ] A4 主会话折叠/展开 subagent
- [ ] A5 Subagent 自动展开
- [ ] A6 置顶会话排序
- [ ] A7 新建会话排序（pinned 之下）
- [ ] A8 Fork 会话排序 + fork: 前缀
- [ ] A9 Subagent 状态徽标（绿/橙/红）
- [ ] A10 主会话状态徽标（绿/橙/红）

## B 组：Subagent 条目操作（4 个）

- [ ] B1 复制 subagent ID
- [ ] B2 重命名 subagent
- [ ] B3 删除 subagent（确认弹窗）
- [ ] B4 Subagent 条目 hover 效果

## C 组：ChatPanel subagent 视图（7 个）

- [ ] C1 进入 subagent 视图（从侧边栏）
- [ ] C2 Subagent 只读栏 + Fork 按钮
- [ ] C3 Subagent 视图 Fork 按钮功能
- [ ] C4 隐藏输入框
- [ ] C5 隐藏 QuickActionToolbar
- [ ] C6 隐藏 QueueCards
- [ ] C7 返回主会话

## D 组：SubagentExecutionCard（4 个）

- [ ] D1 Running 态样式
- [ ] D2 Completed 态样式 + 查看按钮
- [ ] D3 Error 态样式
- [ ] D4 查看按钮跳转

## E 组：TokenStatusBar（2 个）

- [ ] E1 主会话 token 显示
- [ ] E2 Subagent 视图 token 显示

## F 组：派发/队列（9 个）

- [ ] F1 Steering 排队显示
- [ ] F2 Follow-up 排队显示
- [ ] F3 多条排队
- [ ] F4 清除队列
- [ ] F5 QueueCards 仅主会话显示
- [ ] F6 Coordinator 派发新会话
- [ ] F7 派发会话排序
- [ ] F8 派发会话 parentSessionPath
- [ ] F9 派发会话状态同步

## 总计

- 全部：36 个
- 通过：0
- 失败：0
- 跳过：0
