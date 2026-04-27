# SideNav 交互需求

## 核心规则

**选中态只有一种，由最后一次点击决定。** 滚动不改变选中态。

## 数据模型

只需一个 store 状态：
```
selectedNavId: string | null  // 点击的 nav item ID
```

不再区分 `activeId`（滚动追踪）和 `activeBlockId`（块级选中）。滚动追踪的主 dot 高亮用独立样式（如左侧色条），与"选中态"（蓝色发光）不冲突。

## 交互矩阵

### 主 dot（消息级图标：用户/助手/Entry）

| 操作 | 选中态 | 滚动 |
|------|--------|------|
| 点击主 dot | ✅ 该主 dot 变蓝 | 滚到对应消息 |
| 点击另一个主 dot | ✅ 切换到新主 dot | 滚到新消息 |
| 点击 sub dot | 主 dot 不变蓝 | — |
| 手动滚动消息 | 不影响选中态 | 主 dot 左侧色条跟随（只读指示器） |

### Sub dot（块级图标：Thinking/文本/Bash/Memory）

| 操作 | 选中态 | 滚动 |
|------|--------|------|
| 点击 sub dot | ✅ 该 sub dot 变蓝，同组其他 sub 取消 | 滚到对应消息 |
| 点击另一个 sub dot | ✅ 切换到新 sub dot | 滚到新消息 |
| 点击同组主 dot | sub dot 取消选中，主 dot 变蓝 | 滚到消息顶部 |
| 手动滚动消息 | 不影响选中态 | — |

### 右键/双击（多选）

| 操作 | 效果 |
|------|------|
| 右键 dot | toggle 该消息的红色多选态 |
| 双击 dot | toggle 该消息的红色多选态 |

## 视觉样式

| 状态 | 主 dot | Sub dot |
|------|--------|---------|
| 默认 | 原色 icon | 原色 icon |
| 选中（蓝色） | bg-blue-500/20 + 蓝色发光 + 蓝色 icon | bg-blue-500/30 + 蓝色发光 + 蓝色 icon |
| 多选（红色） | bg-red-500/20 + 红色 icon | bg-red-500/20 + 红色 icon |
| 滚动指示（主 dot 专属） | 左侧 3px 蓝色色条 | 无 |

## 实现原则

1. **选中态只由点击设置，只由新点击切换** — 不存在"滚动覆盖选中"的逻辑
2. **一个 store 字段管理选中** — `selectedNavId`，格式为 `msgId`（主 dot）或 `msgId-N`（sub dot）
3. **滚动是纯副作用** — 点击触发 scrollToIndex，但不读写选中状态
4. **滚动指示器是只读的** — useActiveScrollTracker 的 activeId 只驱动左侧色条，不影响蓝色选中态

## 涉及文件

- `SideNav.tsx` — 全部重写
- `ChatPanel.tsx` — 删除 handleNavDotClick/handleSubDotScroll/markProgrammatic，简化 SideNav 调用
- `use-turn-store.ts` — activeBlockId → selectedNavId
- `use-chat-nav-store.ts` — activeId 只用于滚动指示色条
- `use-active-scroll-tracker.ts` — 不再需要 markProgrammatic，只设置 activeId 用于色条
