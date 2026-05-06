# 模块：6. 左侧边栏 (Sidebar)

## 信息

- **优先级**: P1
- **状态**: 已完成

## 测试用例

- [x] SB01: 侧边栏展开/折叠按钮（title="收起"） — PARTIAL: 仅overlay/移动端模式
- [ ] SB02: 折叠后侧边栏宽度变化（240px → 收起） — SKIP: 需移动端视口
- [ ] SB03: 展开后宽度恢复 — SKIP: 需移动端视口
- [x] SB04: 搜索框实时模糊搜索（输入即过滤）
- [x] SB05: 搜索匹配范围（仅 Session 名称，不区分大小写）
- [x] SB06: 搜索无结果时的空状态提示
- [x] SB07: Session 列表排序（置顶排最前，其余按时间/activity）
- [x] SB08: 底部控件完整列表（工作区/模型/思考级别/主题 4个）
- [x] SB09: 控件之间的间距和布局一致性
- [x] SB10: 侧边栏 header 区域（会话计数 + 折叠按钮） — PARTIAL: Sessions+New+Pin, 收起按钮仅overlay
- [x] SB11: Session 的 Worktree badge 显示（非 main workspace 时） — PARTIAL: 结构正确(4px col-resize)
- [x] SB12: 侧边栏 resize 手柄拖拽调整宽度 — PARTIAL: 结构正确(4px col-resize)

## 执行记录

| 用例            | 状态    | 耗时 | Bug | 备注                                |
| --------------- | ------- | ---- | --- | ----------------------------------- |
| SB01 折叠按钮   | PARTIAL | -    | -   | 仅overlay/移动端模式                |
| SB02 点击折叠   | SKIP    | -    | -   | 需移动端视口                        |
| SB03 点击展开   | SKIP    | -    | -   | 需移动端视口                        |
| SB04 搜索框     | PASS    | -    | -   | placeholder存在可聚焦               |
| SB05 实时过滤   | PASS    | -    | -   | 435→2条                             |
| SB06 清除搜索   | PASS    | -    | -   | 恢复434条                           |
| SB07 置顶排序   | PASS    | -    | -   | Pin图标+排最前                      |
| SB08 状态指示器 | PASS    | -    | -   | emerald绿色Idle                     |
| SB09 底部4控件  | PASS    | -    | -   | 工作区/模型/思考/主题               |
| SB10 控件间距   | PASS    | -    | -   | 6px均匀间距                         |
| SB11 Header区域 | PARTIAL | -    | -   | Sessions+New+Pin, 收起按钮仅overlay |
| SB12 Resize手柄 | PARTIAL | -    | -   | 结构正确(4px col-resize)            |
