# 模块：Subagent & 会话侧边栏交互

## 信息

- **优先级**: P0
- **状态**: 待测试
- **涉及组件**:
  - `components/session-sidebar/SessionSidebar.tsx`（SessionItem、SubagentItem、SubagentStatusBadge）
  - `components/chat/ChatPanel.tsx`（subagent 视图切换、Fork 按钮）
  - `components/chat/tool-renderers/SubagentRenderer.tsx`（SubagentExecutionCard）
  - `components/chat/TokenStatusBar.tsx`（主会话 vs subagent token 显示）
  - `components/chat/QueueCards.tsx`（排队消息）
  - `stores/use-subagent-store.ts`
  - `stores/use-session-store.ts`（insertAfterPinned）

## Store 关键状态

| Store            | 字段                 | 说明                                                       |
| ---------------- | -------------------- | ---------------------------------------------------------- |
| useSubagentStore | activeSubsessionId   | 当前正在查看的 subagent ID（null=主会话）                  |
| useSubagentStore | subsessionsByParent  | 按父会话路径分组的 subagent 列表                           |
| useSubagentStore | subagentStatusMap    | 每个 subagent 的状态（idle/streaming/compacting/retrying） |
| useSubagentStore | subagentContextMap   | 每个 subagent 的上下文使用量                               |
| useSubagentStore | messagesBySubsession | 每个 subagent 的消息列表                                   |
| useSessionStore  | activeSessionId      | 当前活跃的主会话 ID                                        |
| useSessionStore  | queueBySession       | 每个 session 的排队消息（steering + followUp）             |

## 测试用例

### A 组：侧边栏会话列表交互（10 个）

#### A1: 主会话选中态

- **操作**: 点击侧边栏任意主会话
- **预期**:
  - 背景变为 `bg-gradient-to-r from-indigo-500/15 to-indigo-500/5`
  - 文字色 `text-indigo-100`
  - 外框 `border border-indigo-500/20`
  - 阴影 `shadow-sm shadow-indigo-500/5`
  - 环形高亮 `ring-1 ring-indigo-500/20`
  - 左侧图标背景 `bg-indigo-500/20 text-indigo-300`
- **数据流**: `setActiveSession(sessionId)` → `useSubagentStore.setActiveSubsession(sessionId, null)`

#### A2: Subagent 选中态

- **操作**: 点击侧边栏中展开后的任意 subagent 条目
- **预期**:
  - 背景变为 `bg-gradient-to-r from-purple-500/15 to-purple-500/5`
  - 文字色 `text-purple-100`
  - 外框 `border border-purple-500/20`
  - 环形高亮 `ring-1 ring-purple-500/20`
  - 左侧图标背景 `bg-purple-500/20 text-purple-300`
- **数据流**: `useSubagentStore.setActiveSubsession(parentSessionId, sub.sessionId)`

#### A3: 从 subagent 切回主会话

- **操作**: 先点击 subagent，再点击其父主会话
- **预期**:
  - subagent 高亮消失
  - 主会话恢复 indigo 选中态
  - ChatPanel 从 subagent 只读模式切回主会话输入模式
- **数据流**: `setActiveSession(sessionId)` + `setActiveSubsession(sessionId, null)`

#### A4: 主会话折叠/展开 subagent 列表

- **操作**: 点击主会话左侧 chevron 按钮
- **预期**:
  - 展开时显示 `ChevronDown`，折叠时显示 `ChevronRight`
  - 展开后 subagent 条目缩进 `ml-4 pl-3`
  - 左侧竖线 `border-l border-gray-800/60`
  - 如果有 subagent 在加载中，显示 `Loader2` spinner + "正在加载子代理..."
- **数据流**: `expandedIds` state toggle

#### A5: Subagent 自动展开

- **操作**: 当主会话有活跃 subagent 时自动展开
- **预期**:
  - 主会话自动展开（仅首次，`autoExpandedRef` 去重）
  - 不重复展开同一会话
- **触发**: `subsessionsByParent` 变化 + `activeSessionId` 匹配

#### A6: 置顶会话排序

- **操作**: 查看会话列表
- **预期**:
  - pinned 会话排在最前
  - pin 图标 `Pin` 显示 `text-indigo-400`
  - `sortPinnedFirst`: `(a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)` 时 pinned 排前
  - 同组内按 `updatedAt` 降序

#### A7: 新建会话排序（pinned 之下）

- **操作**: 创建新会话
- **预期**:
  - 新会话插入到最后一个 pinned 会话之后
  - 使用 `insertAfterPinned()` 函数
  - 非 pinned 会话按 updatedAt 降序

#### A8: Fork 会话排序 + fork: 前缀

- **操作**: 从消息 Fork 按钮或 subagent Fork 按钮创建 fork
- **预期**:
  - 新会话名称为 `fork: <原会话名或firstMessage>`
  - 插入到 pinned 之后（`insertAfterPinned`）
  - 刷新后仍然是根会话（不会变子集）
  - fork 后自动切换到新会话

#### A9: Subagent 状态徽标

- **操作**: 观察侧边栏 subagent 条目右侧状态
- **预期**:
  - exitCode === 0 → 绿色 "空闲" `bg-emerald-500/15 text-emerald-400`
  - exitCode !== 0 或有 error → 红色 "错误" `bg-red-500/15 text-red-400`
  - 运行中 → 橙色脉动 "运行中" `bg-amber-500/15 text-amber-400`

#### A10: 主会话状态徽标

- **操作**: 观察侧边栏主会话右侧状态
- **预期**:
  - streaming/compacting → 橙色脉动 "工作中" `bg-amber-500/15 text-amber-400`
  - permission → 红色 "需要帮助" `bg-red-500/15 text-red-400`
  - retrying → 红色脉动 "重试中" `bg-red-500/15 text-red-400`
  - idle → 绿色 "空闲" `bg-emerald-500/10 text-emerald-400/80`

---

### B 组：Subagent 条目操作（4 个）

#### B1: 复制 subagent ID

- **操作**: hover subagent → 点击 Copy 图标
- **预期**: sub.sessionId 复制到剪贴板（使用 `copyToClipboard`）
- **图标**: `Copy w-3 h-3`

#### B2: 重命名 subagent

- **操作**: hover subagent → 点击 Pencil 图标 → 输入新名称 → Enter
- **预期**:
  - 点击后出现 inline input + Check/X 按钮
  - input 自动 focus + select
  - Enter 确认 → `renameSubagent(path, sub.sessionId, trimmed)`
  - Escape 取消
  - RPC 调用 `subagent.rename`
- **图标**: `Pencil w-3 h-3`

#### B3: 删除 subagent

- **操作**: hover subagent → 点击 Trash2 图标 → 确认弹窗 → 确认
- **预期**:
  - 弹出 ConfirmDialog `t("sidebar:deleteSubagentConfirm")`
  - 确认后从 `subsessionsByParent` 移除
  - 清理 `messagesBySubsession`、`subagentStatusMap`、`subagentContextMap`
  - 如果删除的是当前活跃的 subagent → `activeSubsessionId = null`
  - RPC 调用 `subagent.delete`
- **图标**: `Trash2 w-3 h-3`

#### B4: Subagent 条目 hover 效果

- **操作**: hover 任意 subagent 条目
- **预期**:
  - 背景变化 `hover:bg-white/[0.04] dark:hover:bg-gray-800/50`
  - 文字变亮 `hover:text-gray-300`
  - 操作按钮组显示 `opacity-100 md:opacity-0 md:group-hover:opacity-100`
  - 移动端始终显示操作按钮

---

### C 组：ChatPanel subagent 视图切换（7 个）

#### C1: 进入 subagent 视图（从侧边栏）

- **操作**: 点击侧边栏 subagent 条目
- **预期**:
  - `isViewingSubagent = true`
  - ChatPanel 消息源切换为 `subMessages`（来自 `messagesBySubsession[activeSubId]`）
  - 消息区域顶部显示返回按钮 + subagent 标题栏

#### C2: Subagent 只读栏（底部）

- **操作**: 查看 subagent 视图底部输入区
- **预期**:
  - 不显示输入框、附件栏、发送按钮
  - 显示 "子代理会话为只读模式" 文字 `text-[11px] text-gray-400 dark:text-gray-600`
  - 旁边显示 Fork 按钮 `bg-indigo-500/15 text-indigo-400 border border-indigo-500/20`
  - Fork 按钮包含 GitBranch 图标 + "Fork" 文字

#### C3: Subagent 视图的 Fork 按钮

- **操作**: 点击 subagent 只读栏的 Fork 按钮
- **预期**:
  - 获取父会话 tree 最后一个 entry
  - 调用 `agent.fork` 创建新会话
  - 新会话名 `fork: <原会话名>`
  - `insertAfterPinned` 插入
  - 继承当前 tier 配置 `switchToTier(currentTier, newSessionId)`
  - 自动切换到新会话

#### C4: Subagent 视图隐藏输入框

- **操作**: 查看 subagent 视图
- **预期**: InputBar、AttachmentBar、AttachmentButtons 均不渲染

#### C5: Subagent 视图隐藏 QuickActionToolbar

- **预期**: `{!isViewingSubagent && <QuickActionToolbar />}` — 不渲染

#### C6: Subagent 视图隐藏 QueueCards

- **预期**: `{activeSessionId && !isViewingSubagent && <QueueCards />}` — 不渲染

#### C7: 返回主会话

- **操作**: 从 subagent 视图点击顶部返回按钮
- **预期**:
  - `isViewingSubagent = false`
  - 消息源切回 `mainMessages`
  - 输入区恢复
  - QuickActionToolbar、QueueCards 恢复

---

### D 组：SubagentExecutionCard 消息内嵌（4 个）

#### D1: Running 态

- **视觉**:
  - 整体 `border-purple-500/30 bg-purple-50 dark:bg-purple-950/15`
  - Header 图标背景 `bg-purple-100 dark:bg-purple-500/20`
  - StatusChip `bg-purple-100 dark:bg-purple-500/15 text-purple-600` + 脉动圆点
  - 显示 RunningInstruction（`ArrowRight` 脉动 + instruction 文本）
  - OutputSection 展开/折叠，running 时标题显示 "实时输出" + "streaming" 脉动文字
- **可点击**: 整个卡片 `onClick={handleViewSubagent}` → 跳转 subagent 视图

#### D2: Completed 态

- **视觉**:
  - 整体 `border-purple-300/20 bg-purple-50/50 dark:bg-purple-950/8` + hover 加深
  - StatusChip `bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600` + 实心圆点
  - Header 右侧出现 "查看" 按钮 `ExternalLink` 图标 + `text-purple-600`
- **可点击**: 卡片 + "查看" 按钮均可跳转

#### D3: Error 态

- **视觉**:
  - 整体 `border-red-500/20 bg-red-50 dark:bg-red-950/10`
  - Header 图标背景 `bg-red-100 dark:bg-red-500/15`
  - StatusChip `bg-red-100 dark:bg-red-500/15 text-red-600`（无圆点）
  - Bot 图标 `text-red-500`

#### D4: 查看按钮跳转

- **操作**: 点击 completed 态卡片的 "查看" 按钮
- **预期**: `handleViewSubagent()` → `setActiveSubsession(activeSessionId, matchedSub.sessionId)`
- **前提**: `matchedSub` 不为 null（通过 toolCallId 或 description 匹配到 subsessionsByParent 中的条目）

---

### E 组：TokenStatusBar（2 个）

#### E1: 主会话 token 显示

- **预期**:
  - 标签 `t("tokenStatus.used")` = "已使用"
  - 显示 context ring + used/available token 数量
  - streaming/compacting/retrying 时 ring 脉动

#### E2: Subagent 视图 token 显示

- **预期**:
  - 标签 `t("tokenStatus.subagent")` = "子代理"
  - 使用 `subagentContextMap[activeSubId]` 的 token 数据
  - 使用 `subagentStatusMap[activeSubId]` 的状态

---

### F 组：派发/队列能力（9 个）

#### F1: Steering（实时指令）排队

- **操作**: 流式中发送 follow-up 消息
- **预期**:
  - QueueCards 出现在输入栏上方
  - steering 条目：amber 色 `text-amber-600 dark:text-amber-400/90` + Zap 图标
  - 文本内容截断显示

#### F2: Follow-up 排队

- **操作**: 发送消息但当前正在 streaming
- **预期**:
  - followUp 条目：blue 色 `text-blue-600 dark:text-blue-400/90` + Clock 图标
  - 文本内容截断显示

#### F3: 多条排队

- **预期**: steering + followUp 同时显示，总条目数正确

#### F4: 清除队列

- **操作**: 点击 QueueCards 右侧 X 按钮
- **预期**:
  - 全部清空
  - RPC `agent.clearQueue` 调用
  - QueueCards 组件消失（return null）

#### F5: QueueCards 仅主会话显示

- **预期**: subagent 视图 `{!isViewingSubagent && <QueueCards />}` — 不渲染

#### F6: Coordinator 派发新会话

- **操作**: `coordinator.delegate` RPC 触发
- **预期**: `coordinator.session_created` 事件 → 新会话插入 `sessionsByProject`
- **排序**: 使用 `insertAfterPinned` 插入

#### F7: 派发会话的 session_created 排序

- **预期**: 新会话插入到 pinned 之后（不是最前面）

#### F8: 派发会话带 parentSessionPath

- **预期**: 派发创建的会话 `parentSessionPath` 指向父会话 → 在侧边栏缩进显示为子会话

#### F9: 派发会话状态同步

- **预期**: `queue_update` 事件更新 `queueBySession[sessionId]`

---

## Bug 修复记录

### Bug #E2: subagent 选中时 TokenStatusBar 显示"已使用"而非"子代理"（已修复 ✅）

- **发现时间**: 2026-05-14
- **严重程度**: P1-严重（生产环境 UI 显示错误）
- **模块**: TokenStatusBar + session-subscriptions
- **状态**: 已修复

#### 根因

`session-subscriptions.ts` 的 `cleanupSessionData()` 函数（原第 583 行）无条件调用：

```
useSubagentStore.getState().setActiveSubsession(sessionId, null);
```

`cleanupSessionData` 在以下场景被调用时会清除 `activeSubsessionId`：

- `setActiveSession()` 切换会话时（use-session-store.ts:322）
- `setActiveProject()` 切换项目时（use-session-store.ts:230）
- `removeProjectTab()` 关闭 tab 时（use-session-store.ts:196）
- 其他清理场景（use-session-store.ts:670, 1117）

导致用户查看 subagent 时，任何 session 数据清理操作都会将 `activeSubsessionId` 置 null，
TokenStatusBar 读到 `activeSubId = null` 后显示"已使用"而非"子代理"。

#### 修复

从 `cleanupSessionData()` 中移除 `setActiveSubsession(sessionId, null)` 调用。
`activeSubsessionId` 是 UI 视图状态，应只由 UI 层显式管理：

- 用户点击 subagent 时设置（SessionSidebar / SubagentRenderer）
- 用户返回主会话时清除（ChatPanel.handleBackToMain）
- 用户切换主会话时清除（SessionSidebar 主会话点击）

#### 修改文件

- `src/mainview/stores/session-subscriptions.ts:583` — 删除一行
