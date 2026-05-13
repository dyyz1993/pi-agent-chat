# 模块：tier-switcher（模型 Tier 快切）

## 信息

- **URL**: http://localhost:5173
- **优先级**: P0
- **状态**: 已完成
- **测试时间**: 2026-05-11
- **关联模块**: model-selector（侧边栏模型选择器联动）

## 功能说明

在 ChatPanel 输入框上方提供 3 个 tier 快切按钮 [⚡ 快] [🎯 中] [🧠 思考]，对应 fast/pro/max 三个模型层级。前端本地解析 tier alias，不依赖后端 tier RPC。

**核心文件**:

- `src/mainview/stores/use-tier-store.ts` — tier 状态管理
- `src/mainview/components/chat/TierSwitcher.tsx` — 快切组件
- `src/mainview/components/chat/ChatPanel.tsx` — 集成位置（QuickActionToolbar 下方）
- `src/mainview/components/left-sidebar/SidebarBottomControls.tsx` — 双向同步

**Tier 映射**:
| Tier | 默认模型 |
|------|---------|
| fast | anthropic/claude-haiku-4 |
| pro | anthropic/claude-sonnet-4-20250514 |
| max | anthropic/claude-opus-4-6 |

## 测试用例

### 基础渲染

- [x] TC-1：会话就绪后 TierSwitcher 可见（3 个按钮：快/中/思考）
- [x] TC-1b：默认 tier（pro）高亮，非活跃 tier 显示模型简称
- [ ] TC-1c：无活跃会话时 TierSwitcher 不渲染
- [ ] TC-1d：查看 subagent 时 TierSwitcher 不渲染

### 快切交互

- [x] TC-2：点击「快」→ 按钮高亮切换 + 侧边栏模型同步更新
- [x] TC-3：点击「思考」→ 按钮高亮切换 + 侧边栏模型同步更新
- [x] TC-4：点击「中」→ 按钮高亮切换正确

### 双向同步

- [x] TC-5a：从侧边栏选非 tier 模型 → 三个 tier 按钮全部取消高亮
- [x] TC-5b：从侧边栏选回 tier 映射的模型 → 对应 tier 按钮自动高亮

### 会话继承

- [x] TC-6：新建会话继承当前 tier（如当前是 fast，新建也是 fast）
- [x] TC-7：切回旧会话 → 旧会话 tier 状态正确恢复

### 边界场景

- [ ] TC-8：tier 映射的模型不在 availableModels 中 → 按钮置灰+删除线
- [ ] TC-9：快速连击 → switching 状态阻止重复触发
- [ ] TC-10：switchToTier RPC 失败 → 按钮恢复原状（不卡在 switching）

## 执行记录

| 用例            | 状态 | 耗时 | Bug | 备注                                 |
| --------------- | ---- | ---- | --- | ------------------------------------ |
| TC-1 可见性     | PASS | -    | -   | 3 按钮正确渲染，带图标+标签+模型简称 |
| TC-2 切到快     | PASS | -    | -   | 高亮切换 + 侧边栏同步                |
| TC-3 切到思考   | PASS | -    | -   | 高亮切换 + 侧边栏同步                |
| TC-4 切到中     | PASS | -    | -   | 高亮切换正确                         |
| TC-5 侧边栏联动 | PASS | -    | -   | 非 tier 模型选后全部取消高亮         |
| TC-6 新会话继承 | PASS | -    | -   | 新建会话继承当前 fast tier           |
| TC-7 旧会话恢复 | PASS | -    | -   | 切回后 tier 状态正确                 |

## 测试截图

| 截图           | 路径                                               |
| -------------- | -------------------------------------------------- |
| 初始状态       | `/tmp/tier-test-tc1-tier-buttons-visible.png`      |
| 快 tier 激活   | `/tmp/tier-test-tc2-fast-selected.png`             |
| 思考 tier 激活 | `/tmp/tier-test-tc3-think-selected.png`            |
| 中 tier 激活   | `/tmp/tier-test-tc4-pro-selected.png`              |
| 模型下拉       | `/tmp/tier-test-tc5-model-dropdown.png`            |
| 非 tier 模型   | `/tmp/tier-test-tc5-non-tier-model.png`            |
| 新会话继承     | `/tmp/tier-test-tc6-new-session-inherits-tier.png` |
| 旧会话恢复     | `/tmp/tier-test-tc7-switch-back-old-session.png`   |

## 发现的问题

无 Bug。所有已执行用例通过。

## 环境备注

测试时后端可用模型为智谱 GLM 系列（非 Anthropic Claude），ui-tester 临时修改了 DEFAULT_TIER_MODELS 映射进行验证，测试后已恢复原始 Anthropic 映射。

## 下次迭代

- [ ] 使用已配置的 Anthropic 模型验证端到端 switchToTier RPC
- [ ] 验证 TC-8/9/10 边界场景
- [ ] 键盘可访问性测试
- [ ] RTL 布局测试
