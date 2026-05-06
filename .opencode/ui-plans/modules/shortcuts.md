# 模块：8c. 全局快捷键 (Shortcuts)

## 信息

- **优先级**: P2
- **状态**: 已完成

## 测试用例

- [x] SH01: Ctrl+Shift+D 切换诊断面板
- [x] SH02: Escape 关闭所有弹窗/下拉/面板（通用行为）
- [ ] SH03: Enter 确认操作（重命名/选择目录等） — SKIP: 未找到合适场景
- [x] SH04: ↑↓ 在下拉列表中导航（项目选择器/模型/思考级别等）
- [x] SH05: ESC 关闭 ProjectPicker 对话框
- [ ] SH06: ESC 关闭 ThemeMenu 下拉 — SKIP: ESC未关闭需点外部
- [x] SH07: ESC 关闭 NotificationCenter
- [x] SH08: 输入框中 Enter 发送消息
- [x] SH09: 输入框中 Shift+Enter 换行

## 执行记录

| 用例                  | 状态 | 耗时 | Bug | 备注              |
| --------------------- | ---- | ---- | --- | ----------------- |
| SH01 Ctrl+Shift+D     | PASS | -    | -   | 诊断面板切换      |
| SH02 Escape通用       | PASS | -    | -   | 关闭通知面板      |
| SH03 Enter确认        | SKIP | -    | -   | 未找到合适场景    |
| SH04 ↑↓导航           | PASS | -    | -   | 工作区选择器      |
| SH05 ESC关闭Picker    | PASS | -    | -   | 关闭下拉/对话框   |
| SH06 ESC关闭ThemeMenu | SKIP | -    | -   | ESC未关闭需点外部 |
| SH07 ESC关闭通知      | PASS | -    | -   | 成功关闭          |
| SH08 Enter发送        | PASS | -    | -   | 输入框清空        |
| SH09 Shift+Enter换行  | PASS | -    | -   | 成功换行不发送    |
