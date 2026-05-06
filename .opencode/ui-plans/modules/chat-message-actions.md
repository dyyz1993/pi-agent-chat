# 模块：2b. 消息操作交互

## 信息

- **优先级**: P0
- **状态**: 已完成

## 测试用例

- [x] MA01: hover 消息显示 ··· 操作按钮
- [x] MA02: 点击 ··· 展开操作菜单（Fork/RollbackMsg/RollbackBoth）
- [x] MA03: Fork（分支）操作的可用性 — PARTIAL: UI可交互，后端agent.getTree失败
- [x] MA04: RollbackMsg（回滚消息）操作 — PARTIAL: 触发通知系统(铃铛+1)
- [x] MA05: RollbackBoth（回滚+代码）操作 — PARTIAL: 应弹出确认框
- [x] MA06: 消息右侧 ChevronDown 折叠按钮可见性
- [x] MA07: 折叠消息后显示 120 字符斜体预览
- [x] MA08: 展开折叠的消息恢复完整内容
- [x] MA09: CopyButton 复制成功后图标切换为 Check
- [x] MA10: CopyButton 几秒后自动恢复为复制图标

## 执行记录

| 用例               | 状态    | 耗时 | Bug | 备注                            |
| ------------------ | ------- | ---- | --- | ------------------------------- |
| MA01 hover出现按钮 | PASS    | -    | -   | ··· 文字按钮                    |
| MA02 展开操作菜单  | PASS    | -    | -   | LazyHeaderActions懒加载         |
| MA03 记录选项      | PASS    | -    | -   | Fork/RollbackMsg/RollbackBoth   |
| MA04 Fork操作      | PARTIAL | -    | -   | UI可交互，后端agent.getTree失败 |
| MA05 RollbackMsg   | PARTIAL | -    | -   | 触发通知系统(铃铛+1)            |
| MA06 RollbackBoth  | PARTIAL | -    | -   | 应弹出确认框                    |
| MA07 折叠按钮      | PASS    | -    | -   | ChevronDown图标                 |
| MA08 折叠消息      | PASS    | -    | -   | 斜体预览文本                    |
| MA09 展开消息      | PASS    | -    | -   | 恢复完整内容                    |
| MA10 CopyButton    | PASS    | -    | -   | copy→Check(绿)→~3s→copy         |
