# pi-agent-chat 接入 ion 后端方案（extension-first）

> **状态**：草案 v1（2026-09-25），待评审。
> **关联**：四路能力交叉调研（2026-09-25，结论摘要见附录 A）。
> **对照物**：pi fork = `pi-momo-fork/packages/coding-agent`（v0.78.14，生产 runtime）；ion = `/Users/xuyingzhou/Project/study-rust/ion`（Rust 重写，未上线）。

---

## 0. 架构铁律：能力归属判定（先读这一节）

> **铁律（用户定则，所有阶段必须遵守）**：
>
> 1. **能力优先做成 ion 的扩展**——channel 能力、审批流、调度、记忆管理等功能实现，一律落在 ion 扩展层；
> 2. **只有 ion 内核必须提供的能力才沉淀进 ion 框架**——需要动 agent loop、session 写入语义、provider 协议层、event bus 主干、工具注册机制的才允许改 ion 内核；
> 3. **除此之外一切按扩展插件方式接入**——app 侧只做传输适配和声明式映射，不做散装业务 shim；ion 侧不为主机 app 写专属旁路。

### 0.1 三层归属模型

```
┌──────────────────────────────────────────────────────────────┐
│ pi-agent-chat（app）                                          │
│  只做三件事：                                                  │
│  ① 传输适配：IonRpcClient implements RpcClientAPI（Unix socket）│
│  ② 声明式映射：channel/method/event 名称与形状对照表（单文件注册）│
│  ③ 能力开关：capability flags（降级/隐藏未就绪功能）            │
├──────────────────────────────────────────────────────────────┤
│ ion 扩展层（默认归宿，能力都在这里实现）                        │
│  形态 A：内置 Rust 扩展（Extension trait，config 启停，         │
│          经 extension_rpc 路由，如 file-approval / goal_supervisor）│
│  形态 B：WASM 扩展（.wasm，热加载，适合小而独立的能力）          │
│  判据：能用 Extension trait ~30 个钩子 + extension_on_rpc      │
│        表达的，一律算扩展，不碰内核                              │
├──────────────────────────────────────────────────────────────┤
│ ion 内核（白名单制，最小集，见 §4）                             │
│  仅限：agent loop / session_jsonl 写入语义 / provider 协议层 /  │
│  event bus 主干 / 工具内部机制 / host 进程编排                  │
└──────────────────────────────────────────────────────────────┘
```

### 0.2 归属判定决策树

```
新能力/迁移能力来了：
├─ 只是 app 和 ion 之间的方法名/事件形状差异？
│   └─ app 侧映射注册表加一行（不写逻辑）
├─ 需要 agent 运行时行为（审批、注入、调度、落盘、事件推送）？
│   ├─ Extension trait 钩子 + extension_rpc 能表达？
│   │   ├─ 小而独立、需要热插拔/自进化 → ion WASM 扩展
│   │   └─ 需要深度 host 访问/高性能/复杂状态 → ion 内置 Rust 扩展
│   └─ 钩子表达不了（要改 loop 语义/工具内部/provider 协议）？
│       └─ 进 §4 内核白名单，逐项评审
└─ 纯 UI/编排逻辑（徽标拼装、面板、降级提示）？
    └─ 留在 app
```

### 0.3 明确禁止的做法（反例）

- ❌ 在 app 的 Node server 里给某个 channel 手写业务 shim（如 app 内自己实现 goal 契约状态机去凑 ion 的缺口）——业务实现必须沉到 ion 扩展。
- ❌ 为了省事改 ion 内核 match 主干加"pi 兼容分支"——能用扩展钩子表达的不许动内核。
- ❌ 让 ion host 感知 pi-agent-chat 的私有概念（徽标、面板、Drel 推送等 app 专属语义不进 ion 任何层，app 从订阅流自行推导）。
- ❌ 把 ion 仓内"内置 Rust 扩展"当作内核——它仍是扩展层（config 启停 + extension_rpc 路由），改它不算违反铁律。

---

## 1. 背景与现状结论（一段话版）

pi-agent-chat 对 pi 的耦合分三层：进程边界（薄，2 个运行时 import 点，有 `SandboxRpcClient` 先例可循）、语义面（RpcClientAPI 接口面 **84 个公开方法**（业务转发 ~78）+ **13 个 channel 名（89 个 channel 方法）** + 24 种事件，权威清单见附录 B）、磁盘格式（6 个文件直读 session JSONL + `~/.pi` 布局）。ion 刻意对齐 pi：RPC 66/66 对齐、session entry 类型同构、file-approval 审批算法逐项对齐；但 TS 扩展生态不可携带（无 JS 运行时），goal 契约/learning curator/LSP/OAuth/默认提示词/read 图片/warm 池等存在缺失或降级。完整增减清单见附录 A。

**结论：双后端并存，渐进切换；能力缺口按 §0 铁律落到 ion 扩展层补齐，而不是在 app 侧糊。**

## 2. 总体架构

### 2.1 双后端拓扑

```
pi-agent-chat app（不变，四端）
  │  apiClient.call(...)  ← 前端零改动
  ▼
App Server (src/shared/handlers/**)
  │  RpcClientAPI（既有接缝）
  ├─ PI_BACKEND=pi   → PiRpcClient（现状，Node CLI stdin/stdout JSONL）
  └─ PI_BACKEND=ion  → IonRpcClient（新增，Unix socket JSONL + subscribe 泵）
                          │
                          ▼
                    ion host（ion serve）
                      ├─ 内核（白名单最小集）
                      ├─ 内置 Rust 扩展：file-approval / bash / rules / monitor /
                      │   goal-contract*(新) / curator*(新) / hooks-mgmt*(新) …
                      └─ WASM 扩展：todo-events*(新) …
```

- 默认 `PI_BACKEND=pi`，ion 全链路验收通过前不下线 pi。
- 预热策略不进 ion 内核：**app 侧经 RPC 预 spawn worker**（复用现有 warm-pool 语义，对 ion 只是提前调 create worker），ion 零改动。
- 协议参考实现：`ion-webui/ion_client.py`（hello/snapshot/epoch/stale_route/ui_respond 重连泵已全部踩平），IonRpcClient 照其语义用 TS 重写。

### 2.2 app 侧新增模块（唯一允许新增的地方）

```
src/shared/agent/ion-backend/
  ion-rpc-client.ts      # 传输层：socket 连接、RPC 分拣、subscribe 泵、复活逻辑
  channel-map.ts         # 声明式：pi channel/method → ion extension_rpc 路由表
  event-map.ts           # 声明式：ion 事件形状 → app AgentEvent 归一化
  capability-flags.ts    # 能力开关：哪些功能在 ion 后端下降级/隐藏
  session-paths.ts       # ion 目录布局（~/.ion）→ app 扫描/直读的路径适配
```

规约：映射表只准是数据（对象字面量），出现 `if/else` 业务逻辑即违规；前端 store 组件不改，继续消费现有 `agent.*` RPC 面。

### 2.3 传输选型记录：为什么 ion 走 socket，不复用 pi 的 stdin/stdout

stdin/stdout JSONL 在 ion 架构里是 **host↔worker** 的通信腿，不是 client↔runtime 的腿（host 进程只监听 socket，不读自己的 stdin）。已评估并否决的替代方案：

| 方案                                                  | 判定    | 理由                                                                                                                                                                                                |
| ----------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app 直接 spawn `ion --mode rpc`（worker 模式，stdio） | ❌ 否决 | 绕过 host 后拿到的是无状态替身：审批总线、subscribe 协议、host 直读、会话复活、崩溃重派、多 agent 编排、远程桥接全部住在 host，stdio 腿上没有；缺的功能只能 app 侧补，违反 §0 铁律（app 业务 shim） |
| 本地 shim 进程：stdio ↔ socket 翻译代理               | ❌ 否决 | 多一跳进程；翻译逻辑 ≈ 直接写 client 的逻辑，省不掉工作量，白增维护面                                                                                                                               |
| ion 内核加 pi 兼容 stdio 模式                         | ❌ 否决 | 为唯一消费方改内核协议层，违反 §0 白名单制；把 ion 演进绑死在 pi 线格式                                                                                                                             |
| IonRpcClient 直连 socket（**采纳**）                  | ✅      | Node 原生支持 AF_UNIX；RPC 短连接（一连接一命令）不复杂于 stdio，增量成本只有 subscribe 长连接泵（重连/epoch/snapshot 水合），`ion-webui/ion_client.py` 为已验证参考实现                            |

附加收益：多客户端同挂一个 host（桌面、web server、`ion rpc` 调试器可同时观察同一会话），会话不再被"哪个 server 进程 spawn 的"绑死；进程所有权归还 ion（app 的 LRU 进程池与 reaper 退役，预热改走 §2.1 的 RPC 预 spawn）。stdio 仍是 ion CLI 一次性任务（Scenario 1/2）的合法用法，与本集成链路无关。

## 3. 逐 channel 处置表（extension-first 落点）

| #   | app channel                                          | ion 现状                                                                                                | 处置归宿                                                                                                                                           | 形态        | 工作量估   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| 1   | file-review                                          | 内置 file-approval 已对齐（方法/事件/落盘三面）                                                         | **app 映射**                                                                                                                                       | 声明式      | ~2 人日    |
| 2   | bash-ext                                             | 内置 BashExtension 齐全                                                                                 | **app 映射**（subscribe_output → 事件订阅）                                                                                                        | 声明式      | ~2 人日    |
| 3   | file-snapshot                                        | 内置齐全（实测 restore_files/turn_file_diff 在）；缺 unrevert / restoreByHash；**扩展默认未加载需启用** | **ion 扩展补 2 个 RPC**（file_snapshot 扩展 on_extension_rpc 加分支）                                                                              | 内置扩展    | 2-3 人日   |
| 4   | rules-engine                                         | 内置齐全                                                                                                | **app 映射**                                                                                                                                       | 声明式      | ~1 人日    |
| 5   | memory（基础面）                                     | SQLite+FTS5，save/list/search/forget 对应清晰                                                           | **app 映射**                                                                                                                                       | 声明式      | 2-3 人日   |
| 6   | learning（curator 候选审批 5 方法）                  | 缺 curator 概念                                                                                         | **ion 扩展**：learning 扩展加 extension_on_rpc + 候选/审批状态落盘                                                                                 | 内置扩展    | 5-10 人日  |
| 7   | todo-ext 事件                                        | WASM 扩展无变更推送                                                                                     | **ion 扩展**：todo 扩展补事件推送（host_ui_notif/event_bus 出口已有）                                                                              | WASM 或内置 | 2-3 人日   |
| 8   | hooks 管理面（getLog/getConfig/setEnabled/skipRule） | 引擎扎实，仅缺 4 个管理 RPC                                                                             | **ion 扩展**：hooks 扩展加管理 RPC（读 hooks.json + 事件缓冲）                                                                                     | 内置扩展    | 3-5 人日   |
| 9   | loop-scheduler                                       | monitor 等价，缺 update、缺 scheduler 租约                                                              | **ion 扩展**：monitor 补 update 臂；becomeScheduler 语义做 active-claim 扩展逻辑                                                                   | 内置扩展    | 3-5 人日   |
| 10  | coordinator（委派索引）                              | 原语超集；缺持久化任务索引                                                                              | **ion 扩展**：新增 delegation-index 扩展（session data dir 落盘 tasks，对齐 coordinator-tasks.json 语义）；badge 数据 app 从订阅流 + 该扩展 RPC 取 | 内置扩展    | 5-8 人日   |
| 11  | remote-ssh 管理 RPC                                  | RemoteWorkerHost 强，缺 getStatus/configure/testConnection                                              | **ion 扩展**：3 个薄 RPC（读 config.json + get_overview 拼装）                                                                                     | 内置扩展    | 2-3 人日   |
| 12  | goal（契约审批 16 方法）                             | goal_supervisor 语义不同（自驱动闭环），无契约协商                                                      | **ion 扩展**：新建 goal-contract 扩展（vendor 语义移植，复用 ApprovalBus + goal_state 落盘），分两期见 §5 Phase 3                                  | 内置扩展    | 15-25 人日 |
| 13  | subagent 事件                                        | WorkerEvent 全家 + 转发齐全                                                                             | **app 映射**                                                                                                                                       | 声明式      | ~2 人日    |
| 14  | lsp                                                  | cargo-check 半成品                                                                                      | **降级**（capability flag 隐藏多语言功能）；真 LSP 客户端列为远期 ion 扩展，不阻塞                                                                 | 远期        | —          |

补充（非 channel 但 app 依赖的）：

| 能力                                     | 处置                                                                          | 归属            |
| ---------------------------------------- | ----------------------------------------------------------------------------- | --------------- |
| 默认系统提示词（pi 风格编码 prompt）     | **ion 扩展**：prompt-pack 扩展经 on_system_prompt 注入（先例：BashExtension） | 内置扩展        |
| `read` 工具图片输入（expectVisual 依赖） | 先验证扩展 after_tool_call 能否产出图片块；不能 → §4 白名单评审               | 待验证          |
| warm 池                                  | app 经 RPC 预 spawn worker，**ion 零改动**                                    | app             |
| Drel 推送/message-bridge                 | 已在 app 侧（notification.\* handler），不涉及 ion                            | app（既有）     |
| OAuth（anthropic/codex/copilot）         | 暂缓；ion 后端用 API key，capability flag 标注                                | §4 白名单（缓） |

## 4. ion 内核改动白名单（最小集，逐项评审）

| 候选项                     | 为什么可能是内核                     | 当前决策                                                                                     |
| -------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| read 图片输入              | 工具结果需携带图片块到模型上下文     | **先做扩展可行性验证**（after_tool_call 改写结果为 ImageContent）；验证失败才进内核          |
| OAuth                      | 位于 ion-provider 协议层，扩展够不着 | 进白名单但**缓做**（Phase 4 后再评估）                                                       |
| session 桶编码 pi 字节兼容 | ion 存储布局是内核 paths.rs          | **不进内核**：app 侧 session-paths.ts 适配 ion 布局（app 拥有扫描器）；ion 仅保持 env 可配置 |
| worker 预热/池化           | 看似 host 编排                       | **不进内核**：app RPC 预热即可，ion 保持"worker 可丢弃"设计立场                              |

规则：白名单外的一切内核改动需求，先回到 §0.2 决策树重新判定；确需新增白名单项，须在本文件追加评审记录。

## 5. 分阶段计划

> **架构决策（2026-10-09，用户定则）：直接适配 ion，不做 pi 格式兼容层。**
> 所有权划分：**app 拥有会话登记**（session.create 文件、pin、项目归属、tab 索引），**ion 拥有内容与运行态真相**（消息、树/leaf、流式状态、模型）。禁止散装"JSONL 读不到再回退"式补丁——消息读取统一走 `readIonMessages` 单缝（process-manager），client 不可用时才回落 JSONL（ion 模式下预期为空）。
> 由此产生的 **ion 侧待补清单**（host RPC 增强，按铁律属 ion 侧开发，非 app shim）：`list_sessions` 缺 `title` 字段与 `cwd` 过滤；`get_session_info` 缺 `title`/`updated_at`。补齐前：会话标题显示为 app 侧登记名（ion 自动标题暂不可见）、会话列表按 app 登记枚举（ion CLI 单独创建的会话不出现）。
> 已知降级：`getFullMessagesAround` 的 entryId 定位在 ion 游标语义下退化为尾部窗口（hasMoreAfter 恒 false）。

### Phase 0 — 契约矩阵审计（先行，~2 人日）

> **进展（2026-10-08）**：client 面首轮实测完成（faux，零 token，3 轮探针）——84 方法中 ~70 实测存在（含改名映射），真缺失 3 项；channel/事件面双源回填。产出 `docs/plans/ion-backend/contract-matrix.md` + 可复跑探针 `probe-ion-rpc.sh`。**剩余 Gate**：真 LLM 工具事件名、📦 扩展启用后 channel 复测、ui_respond 正向路径等（矩阵 §5 清单）。

交付物：`docs/plans/ion-backend/contract-matrix.md`，逐行枚举 **RpcClientAPI 全部 84 个公开方法 × 13 个 channel（89 个 channel 方法）× 24 种事件**（完整清单见附录 B），每行标注：

- ion 对应物（方法名/路径）
- 形状差异（响应 JSON、参数名，用 `ion rpc --method xxx` 实测，不信文档）
- **处置归宿**（app 映射 / ion 扩展 / §4 内核 / 降级隐藏）——直接引用 §3 表
- app 消费点（handler 文件）

验收：矩阵覆盖 app 实际调用的 100% 方法（以 `apiClient.call` 调用点清单为准），每行有实测证据或明确标注"待实测"。

### Phase 1 — 传输层打通（~5 人日）

> **✅ 完成（2026-10-08/09，未 commit）**：验证栈四层全绿 —— 单测 12/12 → 隔离 client smoke 14/14 → app 级 WS E2E 11/11（`run-app-e2e-ion.sh`）→ **浏览器级 E2E 7/7**（`run-browser-e2e-ion.sh`：隔离 host + 独立 server + Vite + 预种子配置 + Playwright；通过=页面加载/项目自动打开/新建会话/发送/**实时流式渲染**/刷新后历史恢复/会话列表）。
> **浏览器轮修掉的四个真 bug**：① 前端误判 streaming 走 steer + ion 空闲 steer 只进队列静默丢消息 → `steer/followUp` 空闲降级 prompt（忙闲判定只信事件流）；② `get_tree_with_leaf`（worker 级 RPC）被 phantom-running 拒绝后拖垮 `getFullMessages` → `fetchTree` 软失败（消息读走 host 直读）；③ 前端消费的 6 个资源方法形状数组化；④ **根因的根因**：create_session 触发的自动标题 turn 收尾窗口内（agent_end 后 ~100ms）发 prompt 会让 ion worker 挂死（agent_start 后零事件，phantom-running 之源）→ `start()` 返回前等标题 turn 结算（≤3s），关闭竞态窗口。
> **工具链坑**：playwright 驱动系统 Chromium 时 console 事件全丢（page.on/CDP 均假阴性）——浏览器诊断必须用 DOM 桥（模式沉淀在 browser-e2e-ion.mjs）。
> **剩余**：~15 个 client 方法显式抛错待补；channel 面未接；断线恢复场景未测。

- `IonRpcClient` 实现 `RpcClientAPI`（参照 `SandboxRpcClient` 接缝 + `ion_client.py` 协议语义）：hello 握手、subscribe 泵（snapshot 先行/epoch/stale_route 立即重订）、会话复活、600s 空闲重连。
- `PI_BACKEND` 环境变量切换，pi 保持默认。
- 范围：start/stop/send/abort/事件流/getFullMessages/getState/models 最小闭环。
- 验收：dual-backend E2E（复用 AGENTS.md 的 WS RPC E2E 方法）核心 case 对两个后端同过；流式渲染、中断、断线恢复三场景实测。

### Phase 2 — session 直读适配（~5 人日）

> **进展（2026-10-09）**：按"直接适配"决策完成核心部分 —— 消息读取单缝 `readIonMessages`（getFullMessages/getMessageNavPage/getFullMessagesAround 三路 ion 直读优先）；scanSessions 运行态富化（`fetchIonSessionStatuses`：一次 `list_sessions`，ion running→streaming，进程池状态优先，另一客户端在跑的会话也可见）；app E2E 扩到 **11/11**（含会话列表断言）。
> **剩余**：树导航 fallback 写 `leaf_pointer` 的 ion 等价（当前 app 不写 ion 的 JSONL，navigateTree 走 RPC 已可用）；`session.getEntries`/`todo.list`/`subagent` 等 JSONL 消费者的 ion 路由；ion 侧 list_sessions/get_session_info 增强（见 §5 头部清单）。

### Phase 3 — 能力扩展移植

> **壳模式落地（2026-10-09，用户定则："插件没有就没有，有的话就有"）**：动态能力发现替代静态降级开关 —— `ion-backend/capability.ts`（channel-map × ion 实际加载扩展 `get_extensions` 推导，纯函数）+ 三层暴露（client `getChannelCapabilities` / pm（等 client 就位 + last-known-good 缓存跨 client 重建）/ RPC `agent.getChannelCapabilities`）+ 前端 `use-capability-store` + `RightSidebar` 按 `PANEL_TAB_CHANNEL` 门控 PANEL_TABS。**pi 后端恒全有（UI 行为零变化）**。验证：单测 22/22、WS E2E 13/13（file-review on/goal off 断言）、**浏览器 10/10**（Learning/Goal 隐藏、审核显示、Git 壳能力恒在——三条显隐断言实拍）。
> 踩坑记录：get_extensions 也是 worker 级 RPC，重载后 running 窗口被拒 → client 层重试+实例缓存、pm 层 last-known-good（只缓存"至少一个可用"的结果，防假阴性固化）。

（按 §3 表排序执行，总量 ~45-70 人日）

> **进展（2026-10-09）：纯映射批第一批落地** —— `ion-backend/channel-map.ts` 声明式映射表 + `IonRpcClient.channel()` 真实现（call/invoke 走表，未映射显式抛错）。已接：**file-review**（6 方法 → review_pending/approve/reject/approve_all/reject_all/approvals，pending/approvals 出参适配 `{result:[...]}`）、**bash-ext**（list/kill/write_stdin→send/remove，list 出参取 processes）、**rules-engine**（getSnapshot→list）。**验证**：单测 17/17（含 5 条映射表覆盖）、WS E2E 12/12（新增 change-review.pending 走 channel 全链路，runner 已默认启用 file-snapshot）、浏览器 7/7、548 冒烟零回归。
> **剩余**：memory/learning 映射（等 ion 侧 memory 扩展补 name()）；subagent/todo 事件推送（onReceive 方向）；file-snapshot 的 unrevert/restoreByHash；goal-contract/delegation-index 等扩展批次。

> **P0 方法批（2026-10-09）**：respondUI ✅（UI 专用长连接 subscribe{ui:true} + 同连接 ui_respond（实测 G4 机制验证）+ ui_event→extension_ui_request 推送映射）；diff 三件套 ✅（getFileDiff/getBatchDiffs/getFileHistory，ion turn 系形状映射，getFileDiff 为箭头属性防操作层解构裸调丢 this）；switchAgent ✅（agentName|name 双键）；`send()` 修复 pi 原始协议 `type` 字段（曾把 switch_agent 误发成空 prompt 毒害会话）；**prompt settle 保护**：每次 prompt 前若刚结束一轮则等 is_running 归位+2.5s 竞态窗口（防用户连发触发 ion 双 turn 挂死）。notImplemented 23→18。WS E2E 15/15、浏览器 10/10、单测 22/22、548 冒烟零回归。
> **⚠️ ion P0 升级（实测复现）**：**连续两个 turn（间隔 <~3s）会永久锁死 worker**——第二 turn 的 text_delta 发出但 agent_end 永不发出、is_running 卡 true、message_count 变 null、worker 级 RPC 全拒（20s+ 不恢复）。app 侧 settle 保护已关闭该窗口，但根治必须 ion 修 turn 收尾/新 prompt 竞态。

执行顺序（依赖与价值排序）：

1. 纯映射批：file-review、bash、rules、memory、subagent（app 侧声明式表，~7 人日）
2. 小扩展批：file-snapshot 补 RPC、todo 事件、hooks 管理 RPC（~8 人日）
3. 调度批：loop-scheduler update + 租约、remote-ssh 薄 RPC（~6 人日）
4. 索引批：delegation-index 扩展 + app badge 改造（~7 人日）
5. curator 扩展 + app memory 面板接通（~8 人日）
6. goal-contract 扩展两期：一期契约状态机 + 审批（走 ApprovalBus）；二期 authority/amendment/weak-model 自愈（~15-25 人日）

规约：每个扩展是 ion 仓一个独立交付物（遵循 ion 仓惯例：Extension trait + `*_ci.sh` 验收脚本 + config 启停键），**带 validation packet**（自动 case + 人工验收 case + 证据）；app 侧同步更新 capability-flags。降级项（lsp、OAuth）在 flags 里明确标注而非静默缺失。

### Phase 4 — 双后端验收与转正（~5 人日）

- 把现有 e2e-llm 验证套件（goal 全生命周期、loop 生命周期、流式渲染、审批推送）跑成 **dual-backend 矩阵**。
- 转正标准（全部满足才允许 `PI_BACKEND` 默认切 ion）：矩阵全绿 + 长会话/大 tool output/并行 tool event 压测（复用 ion 的 e2e_stress + bench_read）+ 两周并行日常使用无 P0/P1 + §3 表无"降级"项阻塞日常流。
- pi 不删除：保留为 fallback 后端至少一个版本周期。

## 6. 风险与决策点

| 风险                                                                                                          | 应对                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ion 自曝待修 bug（远程 worker P3 活锁、P4 prompt 注入丢失；abort 对阻塞请求无效；host 重启 3-5s socket 窗口） | Phase 1 前与 ion 侧确认修复状态；未修项列入双后端 E2E 的已知差异清单                             |
| goal-contract 扩展工作量超估（vendor 语义 6.6k 行 TS）                                                        | 两期交付，一期只保审批主链路；期间 app 后端保持 pi，goal 面板不阻塞                              |
| app 直读 JSONL 与 ion 写入竞态（双写者）                                                                      | Phase 2 实测确定 leaf_pointer 写入权归属；原则：**谁后端谁写盘**，app 直写 fallback 仅限 pi 后端 |
| ion 高速演进（日均 5-10 commit）导致对齐漂移                                                                  | 契约矩阵纳入 Phase 4 的 CI 定期复跑；ion 侧锁 tag/commit 开发                                    |
| 单人仓 bus factor                                                                                             | 扩展交付物全部带 CI 脚本与文档，落 ion 仓惯例                                                    |

## 7. 附录 A — 四路调研结论摘要（2026-09-25）

**提升**：性能 1-2 个量级（179MB 会话 5ms/250x、host RSS 12MB、直读 2.5ms 零 worker）；崩溃一致性（原子写/flock/quarantine/墓碑/排队消息落盘）；subscribe 协议（snapshot/epoch/stale_route/ui_respond 同源）；统一审批总线；多 agent 原语超集（worktree 隔离/心跳/auto-respawn/peer 回报）；安全层（guard 三模式/路径守卫/secret 检测/动词闸）；tier 自动降档；bash timeoutBackground；远程 worker 零 key 桥接。测试约 1848 注解 + 121 CI 脚本，非空壳。

**削弱**：goal 契约审批 16 方法无对应物；TS 扩展生态清零（无 JS 运行时）；learning curator 缺失；LSP=cargo-check 仅 Rust；委派持久化索引缺失；loop-scheduler 缺 update/租约；OAuth 全缺；默认提示词一句话；edit 无批量编辑、read 无图片；无 warm 池（app RPC 预热对策）；message-bridge 等小件（app 侧已有，不涉 ion）。ion 自曝待修：远程 P3/P4、abort 盲区、host 重启窗口。

**核验方式**：四智能体独立调研，关键结论（OAuth 缺失、entry 同构、file-review 对齐、扩展语言壁垒）交叉一致；文档宣称均经代码/测试交叉验证。

## 附录 B — 契约面权威清单（Phase 0 矩阵的输入）

> 数据来源（代码为准，非调研约数）：
>
> - client 面：`src/sandbox/sandbox-rpc-client.ts`（`RpcClientAPI` 的 HTTP 第二实现，方法签名即接口全集），全文 704 行核对；
> - channel 面：`src/shared/constants/channel-methods.ts`（ESLint `rpc/valid-channel-method` 的权威名录）+ `src/shared/agent/agent-channel-registration.ts`。
> - 此前调研引用的"55 方法/60 channel 方法/goal 16 方法"为约数，以本附录为准（修正：client 面 84、channel 方法 89、goal 17）。

### B.1 RpcClientAPI 客户端方法面（84 个公开方法）

| 分组          | 方法                                                                                                                                                                  | 数  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 传输/生命周期 | `start` `stop` `onEvent` `getStderr` `send`(raw 兜底) `channel(name)`                                                                                                 | 6   |
| 消息/中断     | `prompt` `steer` `followUp` `abort` `sendMessage` `bash` `abortBash` `respondUI`                                                                                      | 8   |
| 会话操作      | `newSession` `clone` `fork` `navigateTree` `previewRollback` `setCwd` `reload` `setSessionName`                                                                       | 8   |
| 树/消息读取   | `getFullMessages` `getFullMessagesAround` `getMessageNavPage` `getTree` `getTreeWithLeaf` `getForkMessages` `getLastAssistantText` `deleteEntries` `summarizeEntries` | 9   |
| 导出          | `exportHtml`                                                                                                                                                          | 1   |
| 文件/diff     | `getModifiedFiles` `getFileDiff` `getBatchDiffs` `getFileHistory`                                                                                                     | 4   |
| 模型          | `setModel` `cycleModel` `getAvailableModels` `getTierModels` `setTierModels`                                                                                          | 5   |
| Thinking      | `setThinkingLevel` `cycleThinkingLevel`                                                                                                                               | 2   |
| 队列          | `setSteeringMode` `setFollowUpMode` `getQueue` `clearQueue` `promoteQueuedFollowUp`†                                                                                  | 5   |
| 压缩          | `compact` `setAutoCompaction`                                                                                                                                         | 2   |
| 重试          | `setAutoRetry` `abortRetry`                                                                                                                                           | 2   |
| 工具/上下文   | `getTools` `getAllTools` `getActiveTools` `setActiveTools` `getContextUsage` `getSystemPrompt`                                                                        | 6   |
| 资源/Agent    | `getCommands` `getSkills` `getExtensions` `getAgentsFiles` `getAgents` `switchAgent` `getCurrentAgent` `getAgentDetail` `getLatestAgentChange`                        | 9   |
| MCP           | `getMcpServers` `toggleMcpServer` `restartMcpServer`                                                                                                                  | 3   |
| 设置          | `getSettings` `setSettings`                                                                                                                                           | 2   |
| Flags         | `getFlags` `getFlagValues` `setFlag`                                                                                                                                  | 3   |
| 权限          | `setPermissionMode`                                                                                                                                                   | 1   |
| 状态          | `getSessionStats`                                                                                                                                                     | 1   |
| 远程工具      | `registerRemoteTool` `unregisterRemoteTool` `sendRemoteToolResult` `onRemoteToolCall`                                                                                 | 4   |
| 测试辅助‡     | `waitForIdle` `collectEvents` `promptAndWait`                                                                                                                         | 3   |

† `promoteQueuedFollowUp` 为可选方法：调用点有 `if (!managed.client.promoteQueuedFollowUp)` 守卫，SandboxRpcClient 未实现——接口漂移实例。Phase 0 矩阵须逐方法标注"真实 RpcClient / SandboxRpcClient / IonRpcClient"三列实现状态。
‡ 测试辅助 3 个不进契约矩阵。

### B.2 Channel 面（13 个名字，89 个方法）

注册接收（onReceive）11 个：`bash` `todo` `subagent` `lsp` `rules-engine` `memory` `coordinator` `goal` `file-snapshot` `file-review` `loop-scheduler`；仅出站（callChannel，不注册接收）2 个：`hooks-engine`/`hooks`、`remote-ssh`。

| channel         | 方法                                                                                                                                                                                                                                                                                        | 数  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| file-review     | `review.live` `review.history` `review.summary` `review.fileHistory` `review.clear` `review.pending` `review.approve` `review.reject` `review.approveAll` `review.rejectAll` `review.approvals`                                                                                             | 11  |
| file-snapshot   | `snapshot.list` `snapshot.rollback` `snapshot.unrevert` `snapshot.get` `snapshot.restoreByHash` `snapshot.gc` `snapshot.prune` `snapshot.stats` `snapshot.enforceLimit`                                                                                                                     | 9   |
| bash-ext        | `list` `kill` `background` `subscribe_output` `unsubscribe_output` `remove` `write_stdin`                                                                                                                                                                                                   | 7   |
| hooks-engine    | `hooks.getLog` `hooks.getConfig` `hooks.clear` `hooks.getStatus` `hooks.setEnabled` `hooks.skipRule` `hooks.unskipRule` `hooks.getSkippedRules`                                                                                                                                             | 8   |
| lsp             | `lsp.setMode` `getActiveLanguages` `getStatus`                                                                                                                                                                                                                                              | 3   |
| memory          | `learning.memory.list` `learning.memory.userRemember` `learning.memory.markIrrelevant` `learning.memory.getStatus` `learning.memory.removeRule` `learning.memory.addRule`                                                                                                                   | 6   |
| learning        | `learning.getSnapshot` `learning.setConfig` `learning.listCandidates` `learning.approveCandidate` `learning.rejectCandidate` `learning.runCurator`                                                                                                                                          | 6   |
| goal            | `getStatus` `startSetup` `submitContract` `approveContract` `approveAuthorityAmendment` `rejectAuthorityAmendment` `rejectContract` `getPendingContract` `refineContract` `clearGoal` `forceContinue` `disable` `enable` `getTaskReport` `getTriggerHistory` `refineGoal` `checkToolStatus` | 17  |
| rules-engine    | `getSnapshot`                                                                                                                                                                                                                                                                               | 1   |
| coordinator     | `session_delegate` `session_delegate_send` `session_delegate_status` `session_delegate_list` `session_delegate_stop` `session_delegate_remove` `session_delegate_clear_stopped` `session_delegate_fork` `session_delegate_sync`                                                             | 9   |
| remote-ssh      | `getStatus` `configure` `disable` `testConnection` `smokeTest`                                                                                                                                                                                                                              | 5   |
| loop-scheduler  | `list` `create` `update` `toggle` `remove` `getStatus` `becomeScheduler`                                                                                                                                                                                                                    | 7   |
| todo / subagent | 仅事件推送（app 只收不发）                                                                                                                                                                                                                                                                  | —   |

### B.3 事件面（24 种）

上游 10：`agent_start` `agent_end` `turn_start` `turn_end` `message_start` `message_update` `message_end` `tool_execution_start` `tool_execution_update` `tool_execution_end`；
fork 扩展 14：`compaction_start` `compaction_end` `queue_update` `extension_ui_request` `extension_ui_resolved` `channel_data` `custom_entry` `session_rename` `session_info_changed` `auto_retry_start` `auto_retry_end` `auto_continue` `extension_llm_error` `mcp_connection_change`。

## 里程碑定调（2026-10-09，用户决策）

**最小壳 + 少量核心插件 = 当前接受态（MVP 达成）**："先用最简单的，不需要太多插件，然后慢慢调整"。已达成：聊天闭环/流式渲染/历史分页/会话列表/变更审查/壳模式显隐/审批连接层/diff/agent 切换，验证栈四层全绿（WS E2E 15/15、浏览器 10/10、单测 22/22、548 冒烟）。

**由此的优先级调整**：附录 C 中 channel 扩展批次（onReceive 推送、memory/learning/hooks/goal/coordinator/loop-scheduler 映射）与 P1/P2 方法批**降级为按需迭代**——用户用到哪个再接哪个，壳模式保证不接的功能自动隐藏、零报错。**转正前仍必做**（Phase 4 门槛不变）：ion 侧 P0 修复（双 turn 挂死最优先）+ dual-backend E2E 矩阵 + 真实使用期观察。

## 附录 C — 待补总清单（2026-10-09 盘点，唯一台账）

> 状态标记：✅ 已完成 ｜ 🔨 app 侧待做 ｜ 🧱 ion 仓待做 ｜ ⛔ 被 ion 侧缺口阻塞 ｜ 🧪 测试验收
> 优先级：P0=日常使用会碰到 ｜ P1=功能面完整性 ｜ P2=长尾/远期

### C.1 app 仓 · RpcClientAPI 未实现方法（23 个，调用即抛错）

| 优先级 | 方法                                                                                                                     | 说明                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| ✅     | ~~respondUI~~ 已实现（UI 长连接+同连接 ui_respond+ui_event 映射）                                                        |
| ✅     | ~~getFileDiff / getBatchDiffs / getFileHistory~~ 已实现（getFileHistory 非 app RPC，client 方法留作 channel 用）         |
| ✅     | ~~switchAgent~~ 已实现                                                                                                   |
| P1     | fork / getForkMessages                                                                                                   | 参数适配（entryId↔turnId:number 转换）     |
| P1     | setSettings / setAutoRetry / abortRetry                                                                                  | 直映射                                     |
| P1     | getFlags / getFlagValues / setFlag                                                                                       | 参数名适配（extension+flag+value）         |
| P1     | getAgentsFiles / getLatestAgentChange                                                                                    | 资源清单补全                               |
| P1     | toggleMcpServer / restartMcpServer / registerRemoteTool / unregisterRemoteTool / sendRemoteToolResult / onRemoteToolCall | MCP/远程工具面                             |
| ⛔     | getSystemPrompt                                                                                                          | ion 实测返回用户消息（疑 bug），等上游确认 |

### C.2 app 仓 · channel 面未映射（channel-map.ts 扩表）

| 优先级 | channel                                | 缺的方法                                                                                                            | 阻塞                                                                                       |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P0     | file-snapshot（9 方法全缺）            | snapshot.list/rollback/unrevert/get/restoreByHash/gc/prune/stats/enforceLimit                                       | 部分可用顶层 RPC 替代（restore_files/turn_file_diff 等），unrevert/restoreByHash 需 ion 补 |
| P0     | todo / subagent 事件（onReceive 方向） | agent-channel-registration 注册了 11 个 channel 的 onReceive，ion 推送事件（extension_event→channel_data 映射）未接 | 事件映射在 event-map                                                                       |
| P1     | bash-ext                               | background / subscribe_output / unsubscribe_output                                                                  | 事件广播替代（process\_\* 事件）                                                           |
| P1     | file-review                            | review.live/history/summary/fileHistory/clear（5 个）                                                               | review.live≈get_modified_files 可映射                                                      |
| ⛔     | memory（6 方法）                       | learning.memory.\*                                                                                                  | ion memory 扩展匿名（缺 name()）路由不到                                                   |
| ⛔     | learning（6 方法）                     | curator 候选审批全家                                                                                                | ion 未实现方法                                                                             |
| ⛔     | hooks-engine（8 方法）                 | getLog/getConfig/setEnabled/skipRule 等                                                                             | ion 侧无管理 RPC                                                                           |
| ⛔     | loop-scheduler（7 方法）               | list/create/update/toggle/remove/getStatus/becomeScheduler                                                          | ion monitor 缺 update 臂 + 注册不稳定                                                      |
| ⛔     | remote-ssh（5 方法）                   | getStatus/configure/testConnection/smokeTest/disable                                                                | ion 侧无同名 RPC                                                                           |
| ⛔     | coordinator（9 方法）                  | session_delegate\* 全家                                                                                             | ion 无持久化任务索引（delegation-index 扩展）                                              |
| ⛔     | goal（17 方法）                        | 契约审批全家                                                                                                        | ion 语义不同（goal-contract 新扩展，两期）                                                 |
| P2     | lsp（3 方法）                          | setMode/getActiveLanguages/getStatus                                                                                | ion 仅 cargo-check，长期降级或等真 LSP                                                     |

### C.3 app 仓 · 事件面（event-map.ts 扩展）

| 优先级 | 项                                                                                     | 说明                                                                         |
| ------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P0     | extension_event → channel_data 映射                                                    | ion 推送事件（todo/subagent/bash/memory/rules）进 app 事件路由               |
| P0     | ui_event → extension_ui_request                                                        | 审批请求推送（配合 respondUI）                                               |
| P1     | compaction_start/end、queue_update、custom_entry、session_rename、session_info_changed | fork 扩展事件 14 种中已映射 0 种（agent*start/end/message*\_/tool\_\_ 已接） |
| P1     | auto*retry*\*、auto_continue、extension_llm_error、mcp_connection_change               | 同上                                                                         |
| 🧪     | turn_start/turn_end 合成验证                                                           | 已实现（agent 边界合成），需真实多轮场景验证                                 |

### C.4 app 仓 · 架构与流程

| 优先级 | 项                                                                                                                           | 说明                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P0     | **代码 commit**                                                                                                              | 目前全部工作未 commit（约 10 个文件 + 4 个 E2E runner + 文档）                    |
| ✅     | ~~capability-flags.ts~~ → 已升级为动态能力发现（capability.ts + getChannelCapabilities RPC + RightSidebar 门控，2026-10-09） | 静态开关不再需要；插件面板按实际能力显隐                                          |
| P1     | warm 池语义                                                                                                                  | 当前 PI_WARM_POOL=off 绕过；方案定的"app 经 RPC 预 spawn worker"未做              |
| P1     | 断线恢复/stale_route app 级测试                                                                                              | 泵的重连逻辑有单测级实现，app 级场景（host 重启→会话复活→前端自愈）未测           |
| P1     | session.getEntries / todo.list / subagent JSONL 消费者的 ion 路由                                                            | Phase 2 剩余直读点                                                                |
| P1     | 树导航 fallback 写 leaf_pointer 的 ion 等价                                                                                  | app 直写 JSONL 仅 pi 后端；ion 走 navigateTree RPC（已实现，fallback 语义未对齐） |
| P2     | dual-backend E2E 矩阵化（Phase 4 验收）                                                                                      | 同一套 case 跑 pi 和 ion；e2e-llm 套件（goal/loop 全生命周期）跑 ion 后端         |

### C.5 ion 仓待补（🧱，全部在 ~/Project/study-rust/ion）

**Bug 类（P0，修掉可删 app 侧绕法）**：

| 项                             | 现状                                                                                                                                          | app 侧当前绕法                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **双 turn 挂死（P0 升级）**    | 实测复现：间隔 <~3s 的连续 prompt → 第二 turn 半执行后永久锁死（text_delta 发出、agent_end 永不发出、is_running 卡 true、message_count null） | prompt 前 settle（2.5s 窗口 + is_running 轮询）；根治须 ion 修 |
| 空闲 steer 静默入队            | steer 后 message_count 不变，消息永久滞留 steering 队列                                                                                       | steer/followUp 空闲降级 prompt                                 |
| memory 扩展匿名                | MemoryExtension 未 override name()，extension_rpc 路由不到                                                                                    | 无（⛔ 阻塞 memory channel）                                   |
| worker 级 RPC running 即拒     | get_tree_with_leaf/get_queue/get_context_usage/get_tools 在 running 时抛 "please wait"                                                        | fetchTree 软失败 + host 直读消息                               |
| get_system_prompt 返回用户消息 | 疑 bug                                                                                                                                        | ⛔ 阻塞该方法                                                  |

**功能类**：

| 优先级 | 项                                                                                                                   | 说明                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P0     | list_sessions 补 title + cwd 过滤                                                                                    | 会话列表标题/项目归属                                                      |
| P0     | is_running/agent_end 对齐（或 running 时 RPC 排队）                                                                  | 根治 phantom 系问题                                                        |
| P1     | get_session_info 补 title/updated_at                                                                                 | 列表富化                                                                   |
| P1     | hooks 管理 RPC ×4（getLog/getConfig/setEnabled/skipRule）                                                            | 引擎已有                                                                   |
| P1     | monitor 补 update 臂 + 注册条件查明（两轮实测矛盾）                                                                  | loop-scheduler 依赖                                                        |
| P1     | learning curator 5 方法                                                                                              | auto-memory 候选审批                                                       |
| P1     | remote-ssh 管理 RPC ×3                                                                                               | 薄 RPC                                                                     |
| P1     | file-snapshot 补 unrevert/restoreByHash ×2                                                                           | 快照 UI 完整性                                                             |
| P1     | coordinator-tasks.json 持久化任务索引（delegation-index 扩展）                                                       | 委派徽标依赖                                                               |
| P1     | todo 扩展事件推送                                                                                                    | WASM 出口走 event_bus                                                      |
| P1     | prompt-pack 扩展（pi 级默认编码提示词，on_system_prompt 钩子）                                                       | 开箱体验差距最大项                                                         |
| P1     | read 工具图片输入                                                                                                    | goal browser_check expectVisual 依赖（先验证扩展可表达，否则进内核白名单） |
| P2     | goal-contract 扩展（两期，最大单项 ~15-25 人日）                                                                     | 契约审批全家 17 方法                                                       |
| P2     | OAuth 三家（anthropic/codex/copilot）                                                                                | provider 协议层，内核白名单                                                |
| P2     | 真 LSP 客户端（多语言）                                                                                              | 或长期降级                                                                 |
| P2     | edit 批量编辑/replaceAll、openai-responses 系图片输入、abort 阻塞请求、host 重启窗口（launchd）、远程 P3/P4 自曝 bug | 长尾                                                                       |
