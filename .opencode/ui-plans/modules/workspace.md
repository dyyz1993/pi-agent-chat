# 模块：5c. 工作区 (Workspace)

## 信息

- **优先级**: P1
- **状态**: 已完成

## 测试用例

- [x] WS01: 工作区选择器按钮显示（文件夹树图标 + 当前工作区名+路径）
- [x] WS02: 点击打开下拉菜单（主工作区/worktree/新建选项）
- [x] WS03: 主工作区选项（✓ check 图标 + indigo 高亮背景）
- [x] WS04: Worktree 选项列表（⎇ 分支图标 + 分支名 + 路径）
- [x] WS05: 切换到 Worktree 后界面变化（青色 badge 显示 worktree 名）
- [x] WS06: 切换回主工作区后 badge 消失
- [x] WS07: 新建 Workspace 对话框（分支选择 + 新分支名输入）
- [x] WS08: 创建新 Worktree 成功后出现在选项列表中
- [x] WS09: 取消新建 Workspace 对话框

## 执行记录

| 用例              | 状态 | 耗时 | Bug | 备注                      |
| ----------------- | ---- | ---- | --- | ------------------------- |
| WS01 选择器按钮   | PASS | -    | -   | folder-tree图标+路径      |
| WS02 打开下拉     | PASS | -    | -   | 3个选项                   |
| WS03 主工作区样式 | PASS | -    | -   | ✓check+indigo高亮         |
| WS04 Worktree选项 | PASS | -    | -   | git-branch图标+分支名     |
| WS05 切换Worktree | PASS | -    | -   | 青色badge出现             |
| WS06 切回主工作区 | PASS | -    | -   | badge消失                 |
| WS07 新建对话框   | PASS | -    | -   | 分支select+名称input      |
| WS08 创建Worktree | PASS | -    | -   | test-workspace-ui创建成功 |
| WS09 取消新建     | PASS | -    | -   | 对话框关闭                |
