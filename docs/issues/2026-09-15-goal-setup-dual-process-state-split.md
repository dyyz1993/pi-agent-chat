# Issue: RPC/Web 模式下 goal setup 双进程状态分裂（goalId 交替 → interrupted）

**日期**：2026-09-15
**严重级别**：P1（Web 端 /goal 契约模式不可用或不稳定）
**发现路径**：authorities 自愈修复（fork 03b64211f）部署后做全链路验证时暴露

## 现象

通过 RPC（`goal.startSetup` channel）发起 goal setup 后，会话 JSONL 里的 `pi-goal-state-v1` 条目中 **goalId 在两个值之间交替出现**（如 `goal-bac69cca...` ↔ `goal-ffbd1c01...`），每个的状态都停在 `setting_up`（authorities: 0），若干轮后双双转为 `interrupted`。模型全程没有成功调用过 `pi_goal_submit_contract`（或调用了但落进"另一个"状态的进程里被拒 `No goal setup is awaiting a contract`）。

在已被多轮干预的会话（0c04d38a，tank-battle）上还能观察到：模型用真实 goalId + 完整 authorities 提交，但当前 state 的 goalId 已经换成另一个 → `Stale goal ID` / `No goal setup`。

## 根因（高置信）

goal-vendor 的 setup 状态存于 **extension 内存 store**（`store.set(state)`），按进程隔离。shanbox 部署是 warm 进程池：同一会话的 channel 调用（`goal.startSetup` / `getPendingContract` / continuation 触发的 turn）**轮流路由到不同 CLI 进程**，每个进程各自 `createGoalSetupState` 生成自己的 goalId。状态从不合拢：

```
进程 A（goalId X）: startSetup 落这里，setup 对话开始
进程 B（goalId Y）: continuation turn / 下一次 channel 落这里，重新 setup
→ JSONL 里 X/Y 交替持久化；模型 submit 时 load 到的可能是任一进程的副本
```

证据：全新会话首跑（无任何污染）即复现交替；`getPendingContract` 响应带不同 `invokeId`。

## 与既有报告的关系

- 用户 2026-09-14 报告的 `Validation failed ... authorities` 是**弱模型丢字段**（已由 03b64211f 修复：schema 放行 + normalizeDraft 自愈推导，原始 payload 复现 0 错误）；
- 但"老是报错"的持续循环里，**本 issue 的状态分裂是另一半原因**——即使模型提交正确，也可能落错进程被拒。
- Web UI 正常单用户交互路径可能比 RPC 脚本路径轻（用户曾走通过 awaiting_approval，见 2026-09-14 21:39 approval push），但同根因，只是踩中概率不同。

## 修复方向（候选，未实施）

1. **setup 期间进程钉住**（推荐）：goal setup/active 期间把该会话 pin 到单一 CLI 进程（warm 池已有 per-session 归属概念，setup 状态应升级为 pin 条件）；
2. **状态持久化恢复**：goal-vendor `load(ctx)` 每次从 session data（`pi-goal-state-v1` 最新条目）恢复而不是只读内存 store——改动集中在 fork，但要注意 continuation 写入时序；
3. 短期缓解：Web 端发起 goal 后避免并发 channel 调用打断 setup 对话。

## 验证素材

- 复现会话：shanbox `/root/.pi/agent/sessions/--tmp-e2e-goal-fresh--/6790fbb3-*.jsonl`（干净首跑，X/Y 交替 → interrupted）
- 污染会话：`--tmp-e2e-drel-push-demo2--/0c04d38a-*.jsonl`（模型带真实 goalId+6 authorities 提交仍被 Stale 拒）
- 相关修复：fork `03b64211f`（authorities 自愈，与本 issue 独立且已生效）
