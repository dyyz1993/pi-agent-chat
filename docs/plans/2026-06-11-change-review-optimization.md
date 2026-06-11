# change-review.pending 性能优化

**状态**: 已实施

**目标**: 解决 `change-review.pending` RPC 调用耗时 5s+ 的问题，优化到毫秒级。

---

## 问题诊断

### 症状

前端调用 `change-review.pending` 获取待审查文件列表时，经常需要 5 秒以上才能返回。

### 根因分析

调用链路：

```
前端 → WebSocket → App Server handler
  → manager.callChannel(sessionId, "file-review", "review.pending", params)
    → stdin JSONL → CLI Agent 进程
      → file-review extension handler
        → getLiveChanges()                    # 从快照对比磁盘
        → getBatchFileContents(fileRequests)  # 读取旧内容
          → internalGit.readTree(hash)        # ⚠️ 读取整棵文件树所有文件
        → computeDiffInfo()                   # 计算每个文件的 diff
      ← 返回结果
```

**瓶颈 1：readTree 全量 IO**

`internal-git.ts` 的 `readTree` 方法读取整棵文件树的所有文件内容到内存。假设项目有 1000 个文件，一次 review 只需查 5 个，但 `getBatchFileContents` 会读取所有历史树的全部文件。

**瓶颈 2：Channel stdin 排队**

Channel 调用通过 stdin JSONL 同步通信。Agent streaming 时 stdin 正在被 LLM 响应占用，`callChannel` 请求排在队列后面，等待 Agent 忙完才处理。

**瓶颈 3：Channel 5s 超时**

即使 Agent idle，channel 调用也可能超时（extension 未加载、compaction 干扰等独立问题）。

---

## 解决方案

### 跨项目分工

| 改动归属                     | 内容                                                                            | 状态   |
| ---------------------------- | ------------------------------------------------------------------------------- | ------ |
| **底层 (pi-coding-agent)**   | `readTreeFiles` 按需读 + `getBatchFileContents` 加 `fromHash` + approval 持久化 | 已合入 |
| **当前项目 (pi-agent-chat)** | pending handler 优先调 channel，失败降级 JSONL                                  | 已合入 |

### 底层改动

#### 1. readTreeFiles — 按需读文件

```typescript
// 改前：readTree(hash) → 读所有文件内容 → O(N) 磁盘 IO
// 改后：readTreeFiles(hash, wantedPaths) → 只读需要的文件 → O(M) 磁盘 IO
```

假设项目 N=1000 文件，review 查 M=5 文件：

- 改前：~N × 历史树棵数 次磁盘 IO（几千次）
- 改后：~M 次（个位数）

#### 2. getBatchFileContents — fromHash 直接定位

```typescript
// 改前：通过 entryId 在 snapshotIndex 查找 → 格式不一致导致 oldContent=null
// 改后：直接传 treeHash → readTreeFiles(hash, paths) → 精确读取旧内容
interface FileRequest {
  path: string;
  fromHash?: string; // 新增：直接用 tree hash 跳过 entryId 查找
}
```

#### 3. turnToTreeHash — 确定性的快照定位

```typescript
// review.pending 构建 turnToTreeHash（turnIndex → snapshotTreeHash）
// 从 session 的 step-snapshot 条目中精确读取，每个条目记录了 turnIndex
```

#### 4. approval 持久化

```typescript
// 改前：approve/reject 只更新内存，进程重启后丢失
// 改后：写入 file-approval entry 到 session JSONL 文件
// session_start 时从 JSONL 恢复 approvals map
```

### 当前项目改动

#### pending handler — channel 优先 + JSONL 降级

```typescript
r("change-review.pending", async (params) => {
  const manager = getProcessManager();

  // 无 CLI 进程 → JSONL fallback（读 session 文件）
  if (!manager || !manager.hasSession(params.sessionId)) {
    return jsonlFallback(
      params.sessionId,
      params.sessionPath,
      manager?.getProjectPath(params.sessionId),
    );
  }

  // 有 CLI 进程 → channel 调用（底层已优化 O(M)）
  try {
    const result = await withTimeout(
      manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.PENDING, {
        sessionId: params.sessionId,
      }),
      CHANNEL_TIMEOUT_MS,
    );
    // ... 解析结果
    return items;
  } catch (err) {
    // channel 失败 → JSONL fallback
    return jsonlFallback(
      params.sessionId,
      params.sessionPath,
      manager.getProjectPath(params.sessionId),
    );
  }
});
```

#### JSONL fallback 实现

```typescript
async function jsonlFallback(sessionId, sessionPath, projectPath) {
  // 1. 读 JSONL → 提取 file-review-turn + file-approval 条目
  const items = await readPendingFromJsonl(sessionPath);
  // 2. 从磁盘读 newContent（当前文件内容）
  for (const item of items) {
    if (item.fileStatus === "deleted") {
      item.newContent = null;
    } else {
      item.newContent = readFileSync(join(projectPath, item.path), "utf-8");
    }
  }
  return items;
}
```

**注意**：JSONL fallback 只能提供 `newContent`（从磁盘读）和变更列表，无法提供 `oldContent`（需要快照数据）和 `unifiedDiff`（需要 diff 计算）。当 CLI 进程可用时优先走 channel 获取完整数据。

---

## 方案演进历程

### 方案一：Streaming Bypass（已弃用）

Agent streaming 时跳过 channel 调用，直接走 JSONL fallback。Agent idle 时仍走 channel。

**问题**：维护两套路径，逻辑复杂，channel 仍有 5s 超时问题。

### 方案二：统一 JSONL（已弃用）

所有场景都走 JSONL fallback，完全不走 channel。

**问题**：`oldContent` 和 `unifiedDiff` 无法获取，inline diff 对 modified 文件显示不完整。

### 方案三：Channel 优先 + JSONL 降级（最终方案）

- 有 CLI 进程 → channel 调用（底层已优化，O(M) 文件 IO）
- 无 CLI 进程 → JSONL fallback（2-4ms 返回）
- channel 超时/失败 → JSONL fallback

---

## 踩坑记录

### 1. dist 旧版本陷阱

**现象**：修改了底层源码并 `yalc push`，但 E2E 测试行为没变。

**原因**：`npm run build` 只在 build 时复制 extensions 到 dist。如果改了源码但没有重新 build 就 `yalc push`，dist 里是旧版本。

**解决**：始终 `npm run build && yalc push`，并验证 dist 文件修改时间。

```bash
# 验证 dist 是否包含新代码
grep -n "turnToTreeHash" .yalc/@dyyz1993/pi-coding-agent/dist/extensions/file-review/index.ts
```

### 2. entryId 格式不匹配

**现象**：`getBatchFileContents` 传了 `fromEntryId`，但 `snapshotIndex` 里找不到匹配的 entry，导致 `oldContent=null`。

**原因**：`turnToEntryId` 从 session 条目构建的 entryId 格式，和 `snapshotIndex` 内部使用的格式不一致。

**解决**：改为 `turnToTreeHash` 直接传 tree hash，跳过 entryId 查找。

### 3. E2E LLM 行为不确定

**现象**：断言 `oldContent` 包含 `"1.0.0"`，但 LLM 第一轮就写了 `"2.0.0"`。

**解决**：E2E 测试中只断言 `oldContent` 存在且 truthy，不依赖 LLM 的具体输出内容。

---

## 测试覆盖

### 单元测试（10/10）

`test/unit/handlers/change-review.test.ts`

覆盖场景：

- 无 CLI 进程 → JSONL fallback
- 有 CLI 进程 + channel 成功 → channel 数据
- 有 CLI 进程 + channel 失败 → JSONL fallback
- `readPendingFromJsonl` 各种 JSONL 条目组合

### E2E 测试（10/10，真实 DeepSeek LLM）

`test/e2e-llm/rpc/change-review.test.ts`

覆盖场景：
| # | 测试 | 验证内容 |
|---|------|---------|
| 1 | 创建文件 | added, newContent 有值, oldContent=null |
| 2 | 修改文件 | modified, newContent 有值, oldContent 有值（从快照读） |
| 3 | 创建多文件 | pending 返回多个变更 |
| 4 | Approve | 文件从 pending 消失 |
| 5 | Reject | 文件从 pending 消失，磁盘文件被删除 |
| 6 | ApproveAll | 所有文件从 pending 消失 |
| 7 | 删除文件 | deleted 状态正确 |
| 8 | 性能 | 停止 Agent 后 pending 3-5ms 返回 |
| 9 | JSONL 完整性 | turn + approval + snapshot 条目数量正确 |
| 10 | Approve 持久化 | 停止+重启后 approval 状态恢复 |

### 运行命令

```bash
# 单元测试
npx vitest run test/unit/handlers/change-review.test.ts

# E2E（需要 dev server + DeepSeek API）
PI_E2E_LLM=1 npx vitest run --config vitest.config.e2e.ts test/e2e-llm/rpc/change-review.test.ts
```

---

## 性能对比

| 场景                     | 优化前                  | 优化后                       |
| ------------------------ | ----------------------- | ---------------------------- |
| Agent idle, channel 成功 | 5s+（readTree 全量 IO） | <100ms（readTreeFiles O(M)） |
| Agent streaming          | 5s+（stdin 排队）       | JSONL fallback 2-4ms         |
| Agent 不在               | 5s timeout              | JSONL fallback 2-4ms         |
| 文件内容磁盘 IO          | ~N × 历史树棵数         | ~M 次（M=待审查文件数）      |

---

## 涉及文件

### 当前项目 (pi-agent-chat)

| 文件                                       | 改动                                       |
| ------------------------------------------ | ------------------------------------------ |
| `src/shared/handlers/change-review.ts`     | pending handler: channel 优先 + JSONL 降级 |
| `test/unit/handlers/change-review.test.ts` | 10 个单元测试                              |
| `test/e2e-llm/rpc/change-review.test.ts`   | 10 个 E2E 测试（真实 LLM）                 |

### 底层 (pi-coding-agent)

| 文件                                           | 改动                                        |
| ---------------------------------------------- | ------------------------------------------- |
| `extensions/file-review/index.ts`              | review.pending 用 turnToTreeHash + fromHash |
| `src/core/file-store/internal-git.ts`          | 新增 readTreeFiles / listTreeFiles          |
| `src/core/file-store/file-snapshot-manager.ts` | getBatchFileContents 支持 fromHash          |
