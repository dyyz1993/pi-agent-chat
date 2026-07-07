# [Architecture] 为 Extension 提供 `ctx.fs` capability，补齐 ToolOperationsProvider 远程能力缺口

## 一、问题背景

### 1.1 现象

当启用 `remote-ssh` extension 时（本地 pi 进程 + 远程工具转发），`file-review` 的 `pending` / `approve` / `reject` 会**静默误操作**：

- `review.pending` 计算的 diff **始终为空或错误**——因为 `FileSnapshotManager.getLiveChanges()` 用 `node:fs.readdirSync` + `readFileSync` 扫描的是**本地磁盘**，而非远程项目目录。
- `review.reject` 的回滚写入打在**本地**——`unlinkSync` / `writeFileSync` 操作的是本地路径，远程项目文件不受影响。
- `review.approve` 虽然不写文件，但它依赖的快照基线是错的，所以审批语义不可信。

**这不是 file-review 一个插件的 bug，而是整个插件体系的结构性缺陷。**

### 1.2 根因

`remote-ssh` extension 通过 `pi.setToolOperationsProvider(remoteOps)` 只重定向了**核心内置工具**（read/write/bash/grep/find/ls）。但：

1. **兄弟插件完全不知道 provider 切换了。** `file-review`、`file-snapshot`、`preview` 等插件各自 `import { ... } from "node:fs"`，直接读本地磁盘，remote-ssh 的 provider 对它们不可见。
2. **ExtensionContext 没有任何 fs capability。** `ctx` 暴露了 `cwd`、`projectDataDir`、`sessionDataDir` 等**路径**，但插件拿到路径后只能自己用 `node:fs` 操作——在远程场景下静默读错。
3. **ToolOperationsProvider 本身能力不全。** 即使把 file-review 改成走 ops，现有接口也表达不了 delete、递归目录扫描、批量读取——file-review 的回滚链路根本无法实现。

### 1.3 业界先例：VS Code 遇到过一模一样的问题

VS Code 有 Remote-SSH、Dev Container、WSL 等远程场景。扩展如果直接用 `node:fs`，就读到本地机器而非远端。VS Code 的解法：

- **禁止扩展用 `node:fs`，强制用 `vscode.workspace.fs` API。**
- `workspace.fs` 根据 URI scheme 路由：`file://` → 本地，`vscode-remote://ssh-remote+host/` → 远程。
- 官方文档明确警告：_"Extensions that use Node.js `fs` module directly will not work in remote scenarios."_

**我们撞上的是同一个坑，VS Code 十年前就踩过并解决了。**

参考：

- [VS Code remote extensions guidance](https://code.visualstudio.com/api/extension-guides/remote)
- [vscode.workspace.fs API](https://code.visualstudio.com/api/references/vscode-api#workspace.fs)

---

## 二、能力缺口分析

### 2.1 ToolOperationsProvider 现有接口 vs 快照引擎需求

当前 `ToolOperationsProvider`（`src/core/tools/index.ts:119-129`）包含 7 个子接口：

| 接口              | 方法                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `BashOperations`  | `exec(command, cwd, options)`                                                                       |
| `ReadOperations`  | `readFile(path)`, `stat?(path)→{size}`, `createReadStream?`, `access(path)`, `detectImageMimeType?` |
| `WriteOperations` | `writeFile(path, content)`, `mkdir(dir)`                                                            |
| `EditOperations`  | `readFile(path)`, `writeFile(path, content)`, `access(path)`                                        |
| `GrepOperations`  | `isDirectory(path)`, `readFile(path)`, `search?(...)`                                               |
| `FindOperations`  | `exists(path)`, `glob(pattern, cwd, opts)`                                                          |
| `LsOperations`    | `exists(path)`, `stat(path)→{isDirectory}`, `readdir(path)→string[]`                                |

快照引擎（`InternalGit` + `FileSnapshotManager`）的实际 fs 用法：

| 快照引擎用到的操作                                | ToolOperationsProvider 有吗                                            | 缺口         |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ------------ |
| `writeFileSync`（写文件内容）                     | ✅ `WriteOperations.writeFile`                                         | 无           |
| `mkdirSync({recursive})`                          | ✅ `WriteOperations.mkdir`                                             | 无           |
| `readFileSync`（单文件）                          | ✅ `ReadOperations.readFile`                                           | 无           |
| `existsSync`                                      | ✅ `FindOperations.exists`                                             | 无           |
| `statSync`（带 size）                             | ⚠️ `ReadOperations.stat` 有 size；`LsOperations.stat` 只有 isDirectory | 小缺口       |
| **`unlinkSync` / `rmSync`（删除文件）**           | ❌ **7 个接口无任何 delete 操作**                                      | **致命**     |
| **`readdirSync({withFileTypes})` 带 Dirent 类型** | ❌ `LsOperations.readdir` 只返回 `string[]`                            | **致命**     |
| **递归目录树扫描（带深度/ignore/预算）**          | ❌ 无 walk/scan/listTree 原语                                          | **致命**     |
| **批量读多文件**                                  | ❌ 无 batch read，只能单文件 N 次 round-trip                           | **性能致命** |
| `lstatSync`（符号链接）                           | ❌ 无（当前引擎也未真用，但 lstatSync vs statSync 不一致是隐患）       | 中           |

### 2.2 三个致命缺口详解

**缺口 1：没有 delete 操作。**

file-review 的 reject 路径：

```ts
// extensions/file-review/index.ts:506
unlinkSync(fullPath); // 删除"新增文件"类型的回滚
```

FileSnapshotManager.restoreFiles：

```ts
// file-snapshot-manager.ts:669
this.git.rm(path); // InternalGit.rm → rmSync
```

InternalGit 自身的对象存储 GC 也依赖 `rmSync`。

**整个回滚链路都依赖删除，而 ToolOperationsProvider 没有这个能力。** 哪怕把 file-review 改成走 ops，reject 也实现不了。

**缺口 2：readdir 没有目录类型信息。**

快照扫描靠 `Dirent.isDirectory()` / `Dirent.isFile()` 递归走树：

```ts
// internal-git.ts:230
const entries = readdirSync(dir, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isDirectory()) {
    recurse(entry);
  } else if (entry.isFile()) {
    snapshot(entry);
  }
}
```

但 `LsOperations.readdir` 只返回 `string[]`，不带类型。**快照扫描的核心逻辑无法用现有 ops 表达。**

**缺口 3：没有递归扫描原语。**

`scanWorkingDir` 是一个手写的递归遍历器（带深度限制、.gitignore 模式、size/count 预算）。远程场景下如果没有 `walk()` 原语，只能用 N 次 readdir 逐层走——**每层一次 SSH round-trip，扫一个中型项目可能几百次 RPC，慢到不可用。**

### 2.3 符号链接隐患（非阻塞但应记录）

- `FileSnapshotManager.readDiskFile` 用 `lstatSync`（line 88）。
- `InternalGit.scanDir` 用 `statSync`（line 252）。
- 两者都只用 `.size`，不分支 `isSymbolicLink()`。
- 潜在问题：`scanDir` 中，指向 >1MB 文件的符号链接会按目标 size 被跳过；指向 <1MB 文件的符号链接会被按目标内容快照。不一致，但非硬性阻塞。设计远程接口时应一并解决。

---

## 三、改造方案

### 3.1 第一步：补齐 ToolOperationsProvider 缺口

在 `src/core/tools/index.ts` 扩展接口：

```ts
// 新增：带类型信息的目录项
interface FsDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

// 新增：文件信息（统一 stat）
interface FsStat {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mtimeMs: number;
}

// 扩展 WriteOperations —— 补 delete
interface WriteOperations {
  writeFile(path, content): Promise<void>;
  mkdir(dir): Promise<void>;
  delete(path): Promise<void>; // 新增：删除文件
  rename?(oldPath, newPath): Promise<void>; // 新增（可选）
}

// 扩展 LsOperations —— 补 Dirent + 统一 stat
interface LsOperations {
  exists(path): Promise<boolean>;
  stat(path): Promise<FsStat>; // 升级：带 size
  readdir(path): Promise<string[]>; // 保留：简单场景
  readdirWithTypes(path): Promise<FsDirent[]>; // 新增：带类型
}

// 新增：FileSystemOperations（递归扫描 + 批量读）
interface FileSystemOperations {
  // 递归扫描目录树，带 ignore/depth/预算
  walk(
    cwd,
    opts?: {
      maxDepth?: number;
      ignore?: string[];
      maxFiles?: number;
      maxSize?: number;
    },
  ): Promise<WalkResult>;

  // 批量读多文件（远程场景减少 round-trip）
  readBatch(
    paths: string[],
  ): Promise<Array<{ path: string; content: Buffer | null; error?: string }>>;
}
```

`ToolOperationsProvider` 新增 `fs?: FileSystemOperations`。

### 3.2 第二步：新增 `ctx.fs` capability

在 `ExtensionContext`（`src/core/extensions/types.ts`）新增：

```ts
interface ExtensionContext {
  // ... 现有字段 ...

  /**
   * 远程安全的文件系统访问能力。
   * - 本地 session：默认本地 fs 实现。
   * - remote-ssh / sandbox session：自动路由到远程后端。
   * 扩展必须用 ctx.fs 代替 node:fs，否则远程场景静默读错。
   *
   * 参考：VS Code workspace.fs API。
   */
  fs: FileSystemCapability;
}

interface FileSystemCapability {
  readFile(path: string): Promise<Buffer>;
  readFileText(path: string): Promise<string>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FsStat>;
  readdir(path: string): Promise<string[]>;
  readdirWithTypes(path: string): Promise<FsDirent[]>;
  walk(cwd: string, opts?: WalkOptions): Promise<WalkResult>;
  readBatch(paths: string[]): Promise<ReadBatchResult[]>;
}
```

**实现路由：**

| session 类型 | `ctx.fs` 实现                   | 数据通路                          |
| ------------ | ------------------------------- | --------------------------------- |
| 本地（默认） | `LocalFileSystemCapability`     | 直接 `node:fs`                    |
| remote-ssh   | `RemoteSshFileSystemCapability` | 走 `ToolOperationsProvider` → SSH |
| 容器沙盒     | `ContainerFileSystemCapability` | 走 sandbox agent HTTP `/fs/*`     |

`remote-ssh` extension 设置 `ToolOperationsProvider` 时，同时把 `ctx.fs` 切换为 remote 实现（或通过 provider 注册机制联动）。

### 3.3 数据归属分层（核心设计约束）

**这是本 issue 最重要的设计决策，必须先读此节再看迁移方案。**

InternalGit 和 FileSnapshotManager 内部有两类完全不同的 fs 操作，它们的物理归属不同。**不能笼统地说"全部改 ctx.fs"**，否则会导致 pi 的私有数据库被错误地写到远程机器。

#### 两类操作

| 操作类别                           | 操作目标                            | 物理归属（ssh-command 模式） | 用什么 fs            | 改不改   |
| ---------------------------------- | ----------------------------------- | ---------------------------- | -------------------- | -------- |
| **A. 对象库操作**（pi 私有数据库） | `objects/<hash>`、`metadata/<hash>` | **本地**                     | `node:fs`（不变）    | **不改** |
| **B. 工作区操作**（项目文件）      | `cwd` 下的源代码                    | **远程**                     | `ctx.fs`（迁移目标） | **要改** |

A 类是 pi 自己的内容寻址数据库（content blobs + metadata），和 session、memory 同属"pi 的私有记忆"——**永远跟着 pi 进程走**，ssh-command 模式下 pi 在本地，所以对象库也在本地。断线后仍然需要它做对比。**用 node:fs 读写对象库是对的，不需要改。**

B 类是项目本身正在被编辑的源代码——ssh-command 模式下在远程，**必须走 ctx.fs**，否则读到本地磁盘就是空的。

#### 逐方法分类

**InternalGit（`src/core/file-store/internal-git.ts`）：**

| 方法                               | 类别                  | 改不改                             | 原因         |
| ---------------------------------- | --------------------- | ---------------------------------- | ------------ |
| `readObject(hash)`                 | A：读对象库 blob      | **不改**                           | 本地私有数据 |
| `writeObject(hash, content)`       | A：写对象库 blob      | **不改**                           | 本地私有数据 |
| `loadMetadata(hash)`               | A：读元数据           | **不改**                           | 本地私有数据 |
| `saveMetadata(hash)`               | A：写元数据           | **不改**                           | 本地私有数据 |
| `hasObject(hash)`                  | A：查询对象是否存在   | **不改**                           | 本地私有数据 |
| `deleteObject(hash)`               | A：对象库 GC          | **不改**                           | 本地私有数据 |
| `deleteMetadata(hash)`             | A：元数据 GC          | **不改**                           | 本地私有数据 |
| `rm(path)`（对象库 GC 用）         | A：删对象库文件       | **不改**                           | 本地私有数据 |
| `scanDir(dir)`                     | **B：扫工作区**       | **改** → `ctx.fs.readdirWithTypes` | 碰项目文件   |
| `scanWorkingDir(cwd)`              | **B：递归扫工作区**   | **改** → `ctx.fs.walk`             | 碰项目文件   |
| `existsSync(.git / .gitignore)`    | **B：检查项目标记**   | **改** → `ctx.fs.exists`           | 碰项目文件   |
| `readFileSync(.gitignore)`         | **B：读 ignore 规则** | **改** → `ctx.fs.readFileText`     | 碰项目文件   |
| `statSync`（工作区文件 size 检查） | **B：检查项目文件**   | **改** → `ctx.fs.stat`             | 碰项目文件   |

> 注意：`scanDir` 内部同时读工作区文件内容（`readFileSync(entry.fullPath)`）和对象库文件。迁移时只需把工作区相关的 fs 调用走 ctx.fs，对象库相关调用保持 node:fs。

**FileSnapshotManager（`src/core/file-store/file-snapshot-manager.ts`）：**

| 方法                                      | 类别                  | 改不改                                       | 原因           |
| ----------------------------------------- | --------------------- | -------------------------------------------- | -------------- |
| `readDiskFile(path)`                      | **B：读项目实时文件** | **改** → `ctx.fs.stat + ctx.fs.readFileText` | 读远程工作区   |
| `findDirtyFiles()`                        | **B：检测远程变更**   | **改** → `ctx.fs.exists + stat + readBatch`  | 比对远程文件   |
| `restoreFiles()` 写回项目文件             | **B：写项目文件**     | **改** → `ctx.fs.mkdir + writeFile`          | 写远程项目     |
| `restoreFiles()` 调 `git.rm` 删除项目文件 | **B：删项目文件**     | **改** → `ctx.fs.delete`                     | 删远程项目文件 |
| `getBatchFileContents()`                  | **B：批量读项目文件** | **改** → `ctx.fs.readBatch`                  | 远程批量读     |
| 对象库间接操作（调 InternalGit A 类方法） | A                     | **不改**                                     | 本地私有数据   |

**file-review（`extensions/file-review/index.ts`）：**

| 方法                                   | 类别                   | 改不改                      | 原因         |
| -------------------------------------- | ---------------------- | --------------------------- | ------------ |
| `review.reject` 写回文件               | **B：写项目文件**      | **改** → `ctx.fs.writeFile` | 写远程       |
| `review.reject` 删除新增文件           | **B：删项目文件**      | **改** → `ctx.fs.delete`    | 删远程       |
| `review.reject` 创建父目录             | **B：写项目目录**      | **改** → `ctx.fs.mkdir`     | 远程目录     |
| `review.rejectAll`                     | 同 reject              | **改**                      | 同上         |
| `review.pending`                       | 走 FileSnapshotManager | **改**（间接）              | 上游已改     |
| `review.approve`（写审批记录到 JSONL） | session 历史           | **不改**                    | 本地 session |

#### 数据流图

```
┌─ 本地（pi 私有数据，node:fs，不改）──────────────────────┐
│                                                          │
│  Session JSONL                                           │
│    ├─ 消息历史                                            │
│    ├─ file-approval 记录  ← 审批存这                      │
│    └─ file-review-turn 记录                              │
│                                                          │
│  InternalGit 对象库                                      │
│    ├─ objects/<hash>     ← 历史文件 content blob（基线）  │
│    └─ metadata/<hash>    ← 元数据                        │
│                                                          │
│  Memory / Skill / Config                                 │
│                                                          │
└──────────────┬───────────────────────────────────────────┘
               │ review.pending 时：
               │   1. 本地读 baseline（快，node:fs）
               │   2. 远程读 live files（慢，ctx.fs）──┐
               │   3. 本地对比                          │
               │                                       │ ctx.fs（远程路由）
               │ review.reject 时：                     │
               │   1. 本地读 baseline blob（node:fs）   │
               │   2. 远程写回 / 删除（ctx.fs）─────────┤ SSH
               │   3. 本地写审批记录（node:fs）         │
               │                                       ▼
┌─ 远程（项目工作区，ctx.fs）──────────────────────────────┐
│                                                          │
│  项目工作区文件                                           │
│    ├─ src/index.ts        ← live files，算 diff 时读     │
│    ├─ src/new-file.ts     ← reject 时删/写               │
│    └─ ...                                                │
│                                                          │
│  无 pi 私有数据（不存快照库、不存审批、不存 session）     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**一句话原则：pi 的私有数据库（对象库 + 审批记录 + session）永远本地 node:fs；只有项目工作区操作走 ctx.fs。**

### 3.4 迁移 file-review + 快照引擎

基于 3.3 的分层，改造范围（按依赖顺序）：

```
1. InternalGit（src/core/file-store/internal-git.ts）
   仅改 B 类（工作区操作）：
   - scanDir: readdirSync({withFileTypes}) → ctx.fs.readdirWithTypes
   - scanWorkingDir: 递归走树 → ctx.fs.walk
   - scanDir 内部 readFileSync(工作区文件) → ctx.fs.readFileText
   - existsSync(.git / .gitignore) → ctx.fs.exists
   - readFileSync(.gitignore) → ctx.fs.readFileText
   - statSync(工作区文件) → ctx.fs.stat
   保持 A 类（对象库操作）不变：
   - readObject/writeObject/hasObject/loadMetadata/saveMetadata 等 → node:fs

2. FileSnapshotManager（src/core/file-store/file-snapshot-manager.ts）
   - readDiskFile: lstatSync + readFileSync → ctx.fs.stat + ctx.fs.readFileText
   - findDirtyFiles: existsSync + lstatSync + readFileSync → ctx.fs.exists + stat + readBatch
   - restoreFiles 写回: mkdirSync + writeFileSync → ctx.fs.mkdir + writeFile
   - restoreFiles 删除: git.rm(项目文件) → ctx.fs.delete
   - getBatchFileContents: N × readFileSync → ctx.fs.readBatch

3. file-review（extensions/file-review/index.ts）
   - review.reject: unlinkSync → ctx.fs.delete; mkdirSync → ctx.fs.mkdir; writeFileSync → ctx.fs.writeFile
   - review.rejectAll: 同上
   - review.pending: 走 FileSnapshotManager（已改造）
   - 审批记录写入 JSONL: 保持不变（本地 session）
```

**注意：ctx.fs 的注入方式需要调整。** 当前 InternalGit/FileSnapshotManager 在 `agent-session.ts` 构造时直接用 `node:fs`。改造后需要：

- 对象库路径（`this.objectsDir` 等）→ 继续用 `node:fs`（本地私有数据）
- 工作区路径（`cwd` 下的文件）→ 用注入的 `FileSystemCapability`
- 可以用一个 `workdirFs: FileSystemCapability` 参数注入到这两个类，对象库操作继续用模块级 `node:fs` import

### 3.5 sync → async 迁移

只有 B 类操作需要 async 化（因为 ctx.fs 是异步的）。A 类操作可以保持同步：

- `scanWorkingDir(cwd): Snapshot` → `scanWorkingDir(cwd): Promise<Snapshot>`（B 类）
- `scanDir(dir): DirSnapshot` → `scanDir(dir): Promise<DirSnapshot>`（B 类）
- `getLiveChanges(cwd): Changes` → `getLiveChanges(cwd): Promise<Changes>`（B 类）
- `getBatchFileContents(...)` → 已有 Promise 版，内部实现改 `readBatch`（B 类）
- `restoreFiles(...)` → `restoreFiles(...): Promise<void>`（B 类）
- `readObject/writeObject/loadMetadata/saveMetadata/hasObject` → **保持同步**（A 类，node:fs）

**所有调用方（file-review handler、agent-session 快照钩子）的 B 类调用要加 await。** A 类调用不变，无需修改。

---

## 四、副作用与风险

### 4.1 性能：远程场景下快照会变慢

`getLiveChanges` 每次操作后扫描整个工作区算 diff。本地几毫秒；远程走 SSH：

- 无 batch：每个文件一次 round-trip → 扫 500 个文件 = 500 次 SSH → **可能 10+ 秒**。
- 有 batch + walk：`ctx.fs.walk` 一次 SSH 递归列目录 + `ctx.fs.readBatch` 分批读 → **可压缩到 1-3 秒**。
- 极致优化：远端 pi 进程做快照，只传 diff 结果（这属于"全远程 pi"模型，是另一个权衡）。

**缓解措施：**

1. 必须实现 `walk` + `readBatch`，否则远程不可用。
2. 考虑增量快照：用 `stat` 的 mtimeMs + size 过滤未变文件，避免全量重读（FileSnapshotManager 已有 hash 机制，扩展即可）。
3. 考虑快照缓存：同一 turn 内多次 `getLiveChanges` 只算一次。

### 4.2 迁移范围

碰项目文件的插件（P0，远程必坏）：

- `file-review` — 1 处 fs import
- `file-snapshot` — 1 处
- `preview` — 1 处

碰自己 dataDir 的插件（P1-P2，本地大脑模型下不一定坏）：

- `learning`（12 处）、`lsp`（8 处）、`_auto-memory`（5 处）、`session-supervisor`（4 处）、`_multi-compaction`（4 处）等。

> **判断规则：** 插件操作的路径是 `ctx.projectDataDir` / `ctx.sessionDataDir` / `ctx.globalDataDir`（即 `~/.pi/agent/...`）→ 本地大脑模型下本来就该在本地 → **不需要迁**。插件操作的路径是 `ctx.cwd` / `ctx.projectRoot` 下的项目文件 → **必须迁**。

### 4.3 sync → async 的调用链传播

InternalGit / FileSnapshotManager 的方法从 sync 改 async 后，所有调用方都要适配。主要调用方：

- `extensions/file-review/index.ts` — review.\* handler（已 async，改动小）
- `src/core/agent-session.ts` — 快照钩子（step-snapshot、操作后快照）
- 任何 `ctx.fileSnapshotManager.getLiveChanges()` 的调用方

**风险：** 遗漏某个 sync 调用点会导致编译错误（好事，编译器兜底）或运行时 Promise 未 await（需测试覆盖）。

---

## 五、验证用例（Validation Cases）

### 5.1 单元测试

#### UC-1: ctx.fs 本地实现正确性

**Setup:** 创建临时目录，写入测试文件。

**Steps:**

1. `ctx.fs.writeFile("/tmp/test/hello.txt", "hello")` → 成功
2. `ctx.fs.readFileText("/tmp/test/hello.txt")` → 返回 `"hello"`
3. `ctx.fs.exists("/tmp/test/hello.txt")` → `true`
4. `ctx.fs.exists("/tmp/test/nonexistent")` → `false`
5. `ctx.fs.stat("/tmp/test/hello.txt")` → `{ size: 5, isFile: true, isDirectory: false, ... }`
6. `ctx.fs.mkdir("/tmp/test/sub/dir")` → 成功（recursive）
7. `ctx.fs.delete("/tmp/test/hello.txt")` → 成功
8. `ctx.fs.exists("/tmp/test/hello.txt")` → `false`

**Expected:** 所有操作行为与 `node:fs` 一致。

#### UC-2: readdirWithTypes 返回正确类型

**Setup:**

```
/tmp/walk-test/
  file-a.txt
  dir-b/
    nested.txt
  symlink-c → file-a.txt
```

**Steps:**

1. `ctx.fs.readdirWithTypes("/tmp/walk-test")` → 返回 3 个 entry
2. entry `file-a.txt`: `isFile() === true`, `isDirectory() === false`, `isSymbolicLink() === false`
3. entry `dir-b`: `isFile() === false`, `isDirectory() === true`
4. entry `symlink-c`: `isSymbolicLink() === true`

**Expected:** Dirent 类型正确，符号链接可识别。

#### UC-3: walk 递归扫描

**Setup:** 同 UC-2。

**Steps:**

1. `ctx.fs.walk("/tmp/walk-test", { maxDepth: 5 })` → 返回树结构
2. 结果包含 `file-a.txt`、`dir-b/nested.txt`
3. `maxDepth: 0` → 只返回顶层 entry，不递归
4. `ignore: ["dir-b"]` → 结果不含 `dir-b/**`
5. `maxFiles: 1` → 最多返回 1 个文件

**Expected:** 深度、ignore、预算限制均生效。

#### UC-4: readBatch 批量读取

**Setup:** 写入 3 个文件 a/b/c。

**Steps:**

1. `ctx.fs.readBatch(["/tmp/a", "/tmp/b", "/tmp/c", "/tmp/nonexistent"])` → 返回 4 项
2. a/b/c 的 content 正确
3. nonexistent 的 content 为 null，error 字段有信息

**Expected:** 一次调用读多文件，不存在的文件不抛异常。

#### UC-5: delete 操作

**Setup:** 写入文件。

**Steps:**

1. `ctx.fs.delete("/tmp/test/deleteme.txt")` → 成功
2. `ctx.fs.exists("/tmp/test/deleteme.txt")` → `false`
3. `ctx.fs.delete("/tmp/test/nonexistent")` → 不抛异常（幂等）
4. `ctx.fs.delete("/tmp/test/locked-file")` → 抛权限错误（模拟）

**Expected:** delete 正确，幂等，错误可捕获。

---

### 5.2 集成测试（InternalGit + FileSnapshotManager async 化）

#### UC-6: 快照扫描 async 化后结果一致

**Setup:** 本地临时项目，包含 src/index.ts、README.md、node_modules/（应被忽略）。

**Steps:**

1. 调用 `internalGit.scanWorkingDir(cwd)`（async 版）
2. 对比 sync 版结果

**Expected:** 文件列表、内容 hash 完全一致。node_modules 被正确忽略。

#### UC-7: getLiveChanges async 化后 diff 正确

**Setup:**

1. 初始快照（baseline）
2. 修改 src/index.ts
3. 新增 src/new-file.ts
4. 删除 src/old-file.ts

**Steps:**

1. `snapshotManager.getLiveChanges(cwd)`（async 版）
2. 返回 added/modified/deleted 三类

**Expected:** modified 含 src/index.ts；added 含 src/new-file.ts；deleted 含 src/old-file.ts。

#### UC-8: restoreFiles async 化后回滚正确

**Setup:** 同 UC-7。

**Steps:**

1. `snapshotManager.restoreFiles(cwd, targetSnapshot)`
2. 检查磁盘文件状态

**Expected:** src/index.ts 恢复为旧内容；src/new-file.ts 被删除；src/old-file.ts 恢复。

---

### 5.3 远程场景集成测试（remote-ssh）

#### UC-9: file-review pending 在远程正确计算 [核心验证]

**Setup:**

1. 配置 remote-ssh 连接到测试 SSH 服务器
2. 远端 `/home/test/project/` 有初始代码
3. 启动 pi session，remote-ssh 生效，`ctx.fs` → remote backend

**Steps:**

1. agent 在远程修改 `src/index.ts`
2. agent 在远程新增 `src/new.ts`
3. 调用 `review.pending`（channel 调用）

**Expected:**

- pending 返回 modified: [src/index.ts], added: [src/new.ts]
- **不是空列表**（这是当前 bug 的表现）

**Evidence:**

- pending 结果非空
- diff 内容与远端实际变更一致
- 可手动 SSH 到远端 `cat src/index.ts` 交叉验证

#### UC-10: file-review reject 在远程正确回滚 [核心验证]

**Setup:** 同 UC-9，agent 已修改远端文件。

**Steps:**

1. 调用 `review.reject({ path: "src/new.ts" })`（回滚新增文件）
2. SSH 到远端检查 `src/new.ts` 是否被删除

**Expected:**

- 远端 `src/new.ts` **确实被删除**（不是本地被删除）
- reject 返回成功

**Negative case:**

- reject 前记录远端文件列表
- reject 后确认远端 `src/new.ts` 消失
- 本地磁盘**不应有副作用**（本地根本不该有这个文件）

#### UC-11: 快照扫描在远程不读本地磁盘

**Setup:**

1. 本地 `/tmp/local-project/` 有文件 A
2. 远端 `/home/test/project/` 有文件 B（不同的项目）

**Steps:**

1. remote-ssh 生效，session cwd = 远端路径
2. `ctx.fs.walk(cwd)`
3. 检查返回结果

**Expected:**

- 结果包含远端文件 B
- 结果**不包含**本地文件 A
- 本地 `/tmp/local-project/` 无读写痕迹

#### UC-12: readBatch 在远程只走一次 SSH

**Setup:** 远端有 10 个文件。

**Steps:**

1. `ctx.fs.readBatch([10 个远端路径])`
2. 统计 SSH 连接数（mock 或日志计数）

**Expected:**

- SSH 调用次数 ≤ 2（一次 walk 列目录，一次 batch 读）
- **不是 10 次**（每个文件单独 round-trip 是性能失败）

---

### 5.4 回归测试

#### UC-13: 本地场景 file-review 行为不变 [回归保护]

**Setup:** 不启用 remote-ssh，纯本地项目。

**Steps:**

1. 正常使用 file-review pending/approve/reject
2. 对比改造前的行为

**Expected:**

- pending 结果一致
- reject 回滚结果一致
- 无性能退化（本地场景 walk/readBatch 仍然快）

#### UC-14: 其他插件不受影响 [回归保护]

**Setup:** 启用 `memory`、`learning`、`session-supervisor` 等插件。

**Steps:**

1. 正常使用这些插件（它们的 dataDir 操作）
2. remote-ssh 启用/禁用

**Expected:**

- 这些插件行为不变（它们操作 `~/.pi/agent/...`，走本地，不经过 remote-ssh）
- 无报错、无异常

---

### 5.5 边界与异常用例

#### UC-15: 远程断开时 ctx.fs 行为

**Setup:** remote-ssh 连接中。

**Steps:**

1. `ctx.fs.readFile(path)` 正常工作
2. 模拟 SSH 断开（杀掉 SSH 进程）
3. `ctx.fs.readFile(path)` 再次调用

**Expected:**

- 返回明确的连接错误（不是静默读本地）
- 错误信息提示"远程不可达"
- **不会 fallback 到本地**（fallback 会造成数据不一致）

#### UC-16: 大文件读取

**Setup:** 远端有一个 50MB 日志文件。

**Steps:**

1. `ctx.fs.readFileText("/path/to/large.log")`

**Expected:**

- 不超时
- 不 OOM
- 返回完整内容（或按约定截断 + 提示）

#### UC-17: 符号链接处理一致性

**Setup:**

```
/sandbox/project/
  real-file.txt        (1KB)
  symlink-to-real → real-file.txt
  symlink-to-outside → /etc/passwd
```

**Steps:**

1. `ctx.fs.stat("symlink-to-real")` → `isSymbolicLink() === true`
2. `ctx.fs.walk(cwd)` → 是否跟随符号链接？行为是否一致？

**Expected:**

- 符号链接可被识别（`isSymbolicLink`）
- 扫描行为明确：跟随 or 不跟随，文档化
- 指向沙盒外的符号链接不应泄露宿主文件内容（安全考量）

#### UC-18: 并发 walk 安全性

**Setup:** 两个 handler 同时调 `ctx.fs.walk`。

**Steps:**

1. 并发调用两个 walk

**Expected:**

- 不互相干扰
- 结果各自正确
- 无 SSH 连接竞争崩溃

---

## 六、迁移优先级

| 优先级                    | 范围                                                                                     | 依赖         |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------ |
| **P0-a**                  | 补 ToolOperationsProvider 缺口（delete / readdirWithTypes / walk / readBatch）           | 无           |
| **P0-b**                  | 实现 `ctx.fs` capability（LocalFileSystemCapability）                                    | P0-a         |
| **P0-c**                  | InternalGit + FileSnapshotManager async 化 + ctx.fs 迁移                                 | P0-b         |
| **P0-d**                  | file-review 迁移到 ctx.fs                                                                | P0-c         |
| **P0-e**                  | preview 迁移到 ctx.fs                                                                    | P0-b         |
| **P1**                    | RemoteSshFileSystemCapability 实现（remote-ssh extension 提供 ctx.fs 的 remote backend） | P0-b         |
| **P2**                    | 碰 dataDir 的插件渐进迁移（learning、lsp、memory 等）                                    | P0-b，非阻塞 |
| **Follow-up (chat 仓库)** | ISandboxProvider 与 ToolOperationsProvider 打通；session 启动时自动设置 ctx.fs backend   | P1           |

---

## 七、相关文件

### fork（`pi-momo-fork/packages/coding-agent/`）

| 文件                                           | 改动                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/core/tools/index.ts`                      | 扩展接口（delete / readdirWithTypes / walk / readBatch / FsDirent / FsStat） |
| `src/core/tools/{write,ls,read}.ts`            | 各 Operations 接口升级                                                       |
| `src/core/extensions/types.ts`                 | ExtensionContext 新增 `ctx.fs: FileSystemCapability`                         |
| `src/core/file-store/internal-git.ts`          | async 化 + ctx.fs 迁移                                                       |
| `src/core/file-store/file-snapshot-manager.ts` | async 化 + ctx.fs 迁移                                                       |
| `src/core/agent-session.ts`                    | FileSnapshotManager 构造注入 FileSystemCapability                            |
| `extensions/file-review/index.ts`              | unlinkSync/mkdirSync/writeFileSync → ctx.fs                                  |
| `extensions/file-snapshot/index.ts`            | 同步迁移                                                                     |
| `extensions/preview/index.ts`                  | 同步迁移                                                                     |
| `extensions/remote-ssh/operations.ts`          | 补 delete/walk/readBatch/readdirWithTypes 的 SSH 实现                        |
| `extensions/remote-ssh/index.ts`               | 设置 ToolOperationsProvider 时联动 ctx.fs                                    |

### chat（`pi-agent-chat/`，follow-up）

| 文件                             | 改动                                           |
| -------------------------------- | ---------------------------------------------- |
| `src/sandbox/sandbox-manager.ts` | session 启动时根据沙盒类型设置 ctx.fs backend  |
| `src/sandbox/types.ts`           | ISandboxProvider 可选暴露 FileSystemCapability |

---

## 八、参考

- [VS Code Remote Extensions Guidance](https://code.visualstudio.com/api/extension-guides/remote)
- [vscode.workspace.fs API](https://code.visualstudio.com/api/references/vscode-api#workspace.fs)
- [VS Code "Why doesn't my extension work in Remote?"](https://code.visualstudio.com/api/extension-guides/remote#using-the-workspace-api)
- [E2B Filesystem SDK](https://e2b.dev/docs/sandbox-features/filesystem) — `sandbox.files.read/write/list`
- [Daytona Python SDK](https://www.daytona.io/docs/en/python-sdk/) — `sandbox.process.exec` + `sandbox.fs.read_file/write_file`
- [Dev Container spec — workspace mount](https://containers.dev/implementors/json_reference/)
- 内部：`docs/architecture/remote-runtime-architecture-comparison.md`、`docs/workflows/ssh-remote-runtime.md`
