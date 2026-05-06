# 模块：7b. Git 面板 (GitPanel)

## 信息

- **优先级**: P1
- **状态**: 已完成

## 测试用例

- [x] GP01: 切换到 Git 标签后面板内容正确加载
- [x] GP02: 当前分支名显示（如 "master"）
- [x] GP03: 提交计数徽章显示（ahead 数量）
- [x] GP04: Pull 按钮可点击
- [x] GP05: Push 按钮可点击
- [x] GP06: Refresh 按钮刷新 Git 数据
- [x] GP07: Stage all 按钮可点击
- [x] GP08: CHANGES 区域标题（变更数 + modified/deleted 统计）
- [x] GP09: 变更文件列表（文件名 + +/-N 变更量 + M/D 徽章）
- [x] GP10: Modified 文件黄色/琥珀色徽章
- [x] GP11: Deleted 文件红色徽章
- [x] GP12: Per-file Stage 按钮（hover 时 opacity-0→100 显示）
- [x] GP13: UNTRACKED 区域标题和文件列表
- [x] GP14: Untracked 文件灰色 U 徽章
- [x] GP15: COMMITS 区域展开/折叠
- [x] GP16: 提交历史列表（hash + 作者 + 时间 + 消息）
- [x] GP17: 文件状态颜色编码一致性检查

## 执行记录

| 用例 | 状态 | 耗时 | Bug | 备注               |
| ---- | ---- | ---- | --- | ------------------ |
| GP01 | PASS | -    | -   | 面板正确加载       |
| GP02 | PASS | -    | -   | 分支名显示         |
| GP03 | PASS | -    | -   | ahead徽章          |
| GP04 | PASS | -    | -   | Pull可点击         |
| GP05 | PASS | -    | -   | Push可点击         |
| GP06 | PASS | -    | -   | Refresh可点击      |
| GP07 | PASS | -    | -   | Stage all可点击    |
| GP08 | PASS | -    | -   | CHANGES区域正确    |
| GP09 | PASS | -    | -   | 变更文件列表正确   |
| GP10 | PASS | -    | -   | 黄色/琥珀色徽章    |
| GP11 | PASS | -    | -   | 红色徽章           |
| GP12 | PASS | -    | -   | hover显示Stage按钮 |
| GP13 | PASS | -    | -   | UNTRACKED区域正确  |
| GP14 | PASS | -    | -   | 灰色U徽章          |
| GP15 | PASS | -    | -   | 展开/折叠正常      |
| GP16 | PASS | -    | -   | 提交历史正确       |
| GP17 | PASS | -    | -   | 颜色编码一致       |
