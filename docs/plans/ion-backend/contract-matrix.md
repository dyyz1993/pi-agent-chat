# ion 后端契约矩阵（Phase 0）

> **状态**：client 面首轮实测完成（2026-10-08，faux provider，零 token）；**Gate①②⑤ 已清**（2026-10-08 第二轮：真 LLM glm-5.3-flash 事件实测 + 扩展启用复测）；channel/事件面为实测+调研双源。**Phase 1 实现期新增实测（2026-10-08）**：RPC 与 subscribe 的 `session` 均为请求**顶层字段**（与 method 平级，塞进 params 会变成无会话路由的全局流且帧形状不同）；事件帧有第二信封 `{customType, data:{event}|data 平铺, extension, persisted}`（全局流/customType 信封），会话订阅正常走 `instance_event`；`agent_end.data.messages` 是**数字**（消息条数）不是数组——pi 侧需要数组，adapter 发 `[]`。
> **复跑**：`bash docs/plans/ion-backend/probe-ion-rpc.sh`（隔离 host：私有 HOME/socket/session dir，不碰正式 `~/.ion/host.sock`；证据落 `/tmp/ion-probe-evidence*.jsonl`）。
> **探针卫生**：① create_session 必须显式传 `cwd`（缺省会落到启动 shell 的当前目录，file-snapshot 会去扫真 repo——只读无害但污染隔离）；② 覆盖 HOME 后 `~` 展开的是隔离目录，读真实凭据必须用绝对路径。
> **环境**：ion debug 二进制 2026-09-23 构建；协议 hello `protocolVersion:1`；真 LLM 轮用 zai/glm-5.3-flash（凭据从真实 `~/.ion/{auth,config}.json` 复制进隔离 HOME）。
> **输入清单**：方案附录 B（84 client 方法 / 13 channel 89 方法 / 24 事件）。

**图例**：✅ 实测 ok（success:true，形状可用）｜🔶 实测存在但有形状/语义差异｜➡️ 改名可映射｜❌ 缺失｜⏳ 待实测（需真 LLM/特定状态/参数）｜📦 方法在但对应扩展默认未加载，需 worker 配置启用

## 0. 一句话结论

client 面命中率远超预期：**84 个方法中 ~70 个实测存在**（含 4 个改名映射），真缺失仅 3 个（`previewRollback`→`rollback_preview` 存在，实际缺的是……见 §4 差异清单）；**真正的适配工作量集中在形状层**（枚举消息、soft-error 模式、分页游标、事件名）和 **channel 层**（扩展默认不加载 + 方法集不同）。

## 1. Client 方法面（实测）

### 1.1 消息/中断

| pi 方法              | ion 方法   | 状态 | 形状差异 / 备注                                                                                                                               |
| -------------------- | ---------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| prompt               | prompt     | ✅   | data:null                                                                                                                                     |
| steer                | steer      | ✅   | data:null                                                                                                                                     |
| followUp             | follow_up  | ➡️✅ | data:null                                                                                                                                     |
| abort                | abort      | ✅   | data:null（对阻塞 LLM 请求无效是 ion 已知问题）                                                                                               |
| sendMessage(=prompt) | prompt     | ➡️✅ |                                                                                                                                               |
| bash                 | bash       | ✅   | `{exitCode,output,stderr,stdout}`                                                                                                             |
| abortBash            | abort_bash | ➡️✅ | 参数是 `bid`                                                                                                                                  |
| respondUI            | ui_respond | 🔶   | **host 级**且要求同连接先 `subscribe {"ui":true}`（实测跨连接被拒："ui_respond rejected"）；app 需 UI 专用长连接（参照 webui `UiConnection`） |

### 1.2 会话/树

| pi 方法          | ion 方法                               | 状态 | 形状差异 / 备注                                                                                  |
| ---------------- | -------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| newSession       | new_session                            | ➡️✅ | 实例级 `{sessionId}`；另有 manager 级 create_session                                             |
| clone            | clone                                  | ✅   | `{sessionId}`                                                                                    |
| fork             | fork                                   | 🔶   | **参数不同**：ion 要 `turnId:number`，pi 是 `entryId:string`——entryId↔turnId 转换要在 adapter 做 |
| navigateTree     | navigate_tree                          | ➡️✅ | 返回线性节点列表（`nodes[{id,brief,isCurrentLeaf…}]`+currentLeaf），非 pi 树形                   |
| previewRollback  | rollback_preview                       | ➡️✅ | 注意方向：ion 名是 rollback_preview（探针曾用 pi 名误报缺失）                                    |
| setCwd           | set_cwd                                | ➡️✅ |                                                                                                  |
| reload           | reload                                 | ✅   |                                                                                                  |
| setSessionName   | set_session_name / append_session_name | ✅   | 两个都有（append\_\* 会落 session_info entry）                                                   |
| getTree          | get_tree                               | 🔶   | structure 模式 `nodes:[]`（faux 会话无 brief？待真会话复测）；`currentLeaf/compactionPoints` 有  |
| getTreeWithLeaf  | get_tree_with_leaf                     | ➡️✅ | `{tree,pathToLeaf,currentLeaf,branches}`                                                         |
| getForkMessages  | get_fork_messages                      | ➡️✅ | `{count,inputs[{entryId,text,turnId}]}`（pi 是 `[{entryId,text}]`，超集）                        |
| deleteEntries    | delete_entries                         | ➡️✅ | soft-error：`success:true`+`data.error`（no matching entries）                                   |
| summarizeEntries | summarize_entries                      | ➡️✅ | 同上                                                                                             |
| switch_session   | switch_session                         | 🔶   | webui 文档称"空 stub"（实测 data:null），语义待确认                                              |

### 1.3 消息读取/分页

| pi 方法               | ion 方法                  | 状态 | 形状差异 / 备注                                                                                                          |
| --------------------- | ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| getFullMessages       | get_full_messages         | ➡️✅ | **Rust 枚举形态**：`messages:[{User:{content:[{Text:{text}}]}}]`——必须 flatten（参照 webui `flatten_messages`）          |
| getFullMessagesAround | get_messages + cursor     | 🔶   | ion 有 `from:"head"`（首 N 条+`nextCursor`）和 `limit`（尾 N 条）双向游标；"around 定位"要用 head/tail 组合在 adapter 拼 |
| getMessageNavPage     | get_messages {from,limit} | ➡️✅ | `{messages,hasMore,compactionPoints}`                                                                                    |
| getMessages           | get_messages              | ✅   | 枚举形态同上；`get_session_messages` 是 host 零 worker 直读（实测可用，命令名回显 get_messages）                         |
| getLastAssistantText  | get_last_assistant_text   | ➡️✅ | data 直接是字符串                                                                                                        |
| list_inputs           | list_inputs               | ✅   | ion 增强（大纲零拉起）                                                                                                   |

### 1.4 文件/diff（✅ 已实测：config.json 显式启用 file-snapshot 后全通）

启用方式：`~/.ion/config.json` 的 `extensions:{"file-snapshot":{"enabled":true}}`（DEFAULT_DISABLED 仅 `file-snapshot`/`dev_server_detector` 两项；file-approval 随 file-snapshot 连带启用，get_extensions 显示为 `file-approval` + `file_snapshot`（下划线名））。

| pi 方法                           | ion 方法                    | 状态 | 形状差异 / 备注                                                             |
| --------------------------------- | --------------------------- | ---- | --------------------------------------------------------------------------- |
| getModifiedFiles                  | get_modified_files          | ✅   | `{files:[],summary:{added,deleted,modified}}`                               |
| getFileDiff                       | get_file_diff               | ✅   | 参数 `filePath`                                                             |
| getBatchDiffs                     | get_batch_diffs             | ✅   |                                                                             |
| getFileHistory                    | get_file_history            | ✅   |                                                                             |
| restoreFilesFromSnapshot          | restore_files               | ➡️✅ | 参数 `toTurn:turnId`                                                        |
| —（增强）                         | turn_file_diff              | ✅   | 三基准 diff（base=before/prev/disk）                                        |
| —（增强）                         | turn_changes                | ✅   | `{files,summary,turnId}`                                                    |
| snapshot.unrevert / restoreByHash | —                           | ❌   | 无对应（方案 §3 #3 小补项）                                                 |
| ⚠️                                | rollback_preview            | 🔶   | 首轮 data:null ✅、二轮偶发 `worker dropped response channel`——稳定性待观察 |
| ⚠️                                | extension_rpc→file_snapshot | ❌   | 按名路由报 "singleton extension not found"——快照操作只能走顶层 RPC          |

### 1.5 模型/tier/thinking/queue/compaction/retry/权限

| pi 方法                           | ion 方法               | 状态 | 形状差异 / 备注                                                                                        |
| --------------------------------- | ---------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| setModel                          | set_model              | ✅   | 参数 `modelId,provider`（不是 model）；返回 get_state 形状                                             |
| cycleModel                        | cycle_model            | ✅   | `{modelId,previousModel,provider}`                                                                     |
| getAvailableModels                | get_available_models   | ✅   | `[{id,name,provider,contextWindow…}]`（内置模型仅 5 个，写死作者栈；兼容读 `~/.pi/agent/models.json`） |
| getTierModels                     | get_tier_models        | ✅   | `{fast,pro,max}` 全键                                                                                  |
| setTierModels                     | set_tier_models        | 🔶   | **ion 按单个 tier 设**（missing 'tier' or 'model'）；pi 一次传整个 map——adapter 拆分调用               |
| setThinkingLevel                  | set_thinking_level     | ✅   |                                                                                                        |
| cycleThinkingLevel                | cycle_thinking_level   | ✅   | `{previousLevel,thinkingLevel}`                                                                        |
| setSteeringMode / setFollowUpMode | 同名 snake             | ✅   |                                                                                                        |
| getQueue                          | get_queue              | ✅   | `{steering,steeringCount,followUp,followUpCount}`（扁平，pi 是嵌套队列对象）                           |
| clearQueue                        | clear_queue            | ✅   | `{cleared,steeringCleared,followUpCleared}`                                                            |
| promoteQueuedFollowUp             | promote_follow_up      | ➡️✅ |                                                                                                        |
| compact                           | compact                | ✅   | 真跑（faux 下 beforeMessages/afterMessages 正常回包）                                                  |
| setAutoCompaction                 | set_auto_compaction    | ✅   |                                                                                                        |
| setAutoRetry / abortRetry         | set_auto_retry / abort | ✅   |                                                                                                        |
| setPermissionMode                 | set_permission_mode    | ✅   | 取值 `open/blacklist/whitelist`                                                                        |
| getSessionStats                   | get_session_stats      | ➡️✅ | `{assistantMessages,cost,lastEntryId…}`                                                                |

### 1.6 资源/上下文/设置/flags/MCP/agent

| pi 方法                                                                           | ion 方法                                                              | 状态  | 形状差异 / 备注                                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| getCommands                                                                       | get_commands                                                          | ✅    |                                                                                                                     |
| getSkills                                                                         | get_skills                                                            | ✅    | `{count,skills:[]}`（空——skill 目录扫描根不同：`~/.ion/agent/skills`、项目 `.ion/skills`、兼容 `~/.agents/skills`） |
| getExtensions                                                                     | get_extensions                                                        | ✅    | 默认 worker 实测 16 个（见 §2 备注）                                                                                |
| getTools / getActiveTools / setActiveTools                                        | 同名                                                                  | ✅    |                                                                                                                     |
| getAllTools                                                                       | get_all_tools                                                         | 🔶    | 实测返回 `[]` 而 get_tools 有列表——语义差异待查（可能是"扩展注册的工具"）                                           |
| getContextUsage                                                                   | get_context_usage                                                     | ✅    | `{estimatedTokens,contextWindow,usagePercent?,autoCompaction}`                                                      |
| getSystemPrompt                                                                   | get_system_prompt                                                     | 🔶    | **实测返回了最后一条用户消息**（"probe round one"）——疑似 ion bug，需上游确认                                       |
| getSettings / setSettings                                                         | 同名                                                                  | ✅    | soft-error 模式；api_key 脱敏                                                                                       |
| getFlags / getFlagValues / setFlag                                                | 同名                                                                  | ✅    | flags 按扩展分组 `{ext:{flag:val}}`；set_flag 参数是 `extension+flag+value`（pi 是 name+value）                     |
| getMcpServers / toggleMcpServer / restartMcpServer                                | get_mcp_servers / mcp_toggle_server / mcp_restart_server              | ✅/⏳ | 列表实测 ✅（空）；toggle/restart 名字来自对齐文档，未实测                                                          |
| getAgentsFiles                                                                    | get_agents_files                                                      | ➡️✅  | 实测 `[]`（扫描目录不同，待配目录复测）                                                                             |
| getAgents / getCurrentAgent / switchAgent / getAgentDetail / getLatestAgentChange | get_agents / get_current_agent / switch_agent / get_agent_detail / ⏳ | ✅/⏳ | getLatestAgentChange 未实测（对齐文档有 append_agent_change 支持）                                                  |
| exportHtml                                                                        | export_html                                                           | ➡️✅  | `{path}`（无参时 path 空，参数形态待测）                                                                            |
| registerRemoteTool / unregisterRemoteTool                                         | 同名                                                                  | ✅    | 参数校验在（missing name/url）                                                                                      |
| getState                                                                          | get_state                                                             | ✅    | `{model,provider,is_running,message_count,follow_up_queue…}`                                                        |

### 1.7 真缺失/待定清单

| 项                                                                   | 状态                     | 处置建议                        |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------- |
| instance 级 get_overview                                             | ❌（仅 manager 级有）    | app 映射到 manager get_overview |
| respond_ui                                                           | ❌（名不存在）           | 走 ui_respond + UI 长连接       |
| export                                                               | ❌（正确名 export_html） | 改名映射                        |
| sendRemoteToolResult / onRemoteToolCall                              | ⏳                       | remote tool 回流路径未实测      |
| getLatestAgentChange / mcp_toggle / mcp_restart / switchAgent 副作用 | ⏳                       | Phase 1 补测                    |

## 2. Channel 面（实测 + 调研）

**扩展启用机制（实测确认）**：`~/.ion/config.json` 的 `extensions:{<name>:{enabled:bool}}`；未配置项默认启用，仅 `file-snapshot`、`dev_server_detector` 默认关闭。默认 worker 加载 16 个；**memory 扩展实际加载但匿名**（MemoryExtension 未 override `name()`，get_extensions 里是三个 "anonymous" 之一）→ extension_rpc 按名路由不到；**hooks 只在项目有非空 hooks.json 时注册**（`has_hooks` 门控，空 `[]` 不加载）；monitor 两次结果矛盾（一次 ok 一次 not found，信封也不同——host 直答 vs worker 转发路径差异），标 ⚠️ 不稳定待查。

| app channel             | ion 目标                            | 实测                                                                                                                                                                                                             | 处置（对应方案 §3）                                                  |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| file-review             | file-approval 扩展                  | ✅ **已接（channel-map.ts）**：6 方法映射 review_pending/approve/reject/approve_all/reject_all/approvals（worker_rpc 顶层），pending/approvals 出参适配 `{result:[...]}`；WS E2E change-review.pending 全链路 ✅ | 完成（review.live/history/summary/fileHistory/clear 未映射，缺即抛） |
| file-snapshot           | file_snapshot                       | ✅ 启用后 §1.4 全通（unrevert/restoreByHash 除外）                                                                                                                                                               | 启用 + 映射 + 小补 2 方法                                            |
| bash-ext                | bash 扩展                           | ✅ **已接**：list/kill/write_stdin→send/remove（extension_rpc），list 取 processes；background/subscribe_output 未映射（事件广播替代，onReceive 批次接）                                                         | 基本完成                                                             |
| hooks-engine            | hooks                               | 🔶 条件加载（非空 hooks.json）；getLog/getConfig 等方法未实测到                                                                                                                                                  | 启用 + ion 侧补 4 管理 RPC（方案 §3 #8）                             |
| lsp                     | lsp                                 | ✅ 已加载（但语义=cargo check）                                                                                                                                                                                  | 降级 flag                                                            |
| memory                  | memory 扩展                         | 🔶 **加载但匿名**——extension_rpc 不可路由（ion 侧一行修复：补 name()）；方法面 save/list/search/forget 待路由修复后复测                                                                                          | ion 修复 + 方法映射                                                  |
| learning                | learning                            | 🔶 已加载但 getSnapshot 未实现（"method not implemented"）                                                                                                                                                       | ion 侧补 curator 5 方法（方案 §3 #6）                                |
| goal                    | goal_supervisor                     | 🔶 已加载但语义不同（自驱动闭环，非契约审批）                                                                                                                                                                    | goal-contract 扩展新建（方案 §3 #12）                                |
| rules-engine            | rules-engine                        | ✅ **已接**：getSnapshot→extension_rpc list                                                                                                                                                                      | 完成                                                                 |
| coordinator             | spawn_worker 体系 + worker_registry | ⏳ 原语调研确认；无 coordinator-tasks.json                                                                                                                                                                       | delegation-index 扩展（方案 §3 #10）                                 |
| remote-ssh              | RemoteWorkerHost                    | ⏳ 调研确认 M1-M4.5 完成；无同名 RPC                                                                                                                                                                             | 3 薄 RPC（方案 §3 #11）                                              |
| loop-scheduler          | monitor                             | ⚠️ 不稳定（一轮 ok `{monitors:[]}`、一轮 not found）                                                                                                                                                             | 查明注册条件 + 补 update 臂（方案 §3 #9）                            |
| todo / subagent（事件） | todo(WASM)/WorkerEvent              | ⏳                                                                                                                                                                                                               | todo 事件推送要补；subagent 走订阅流（onReceive 批次）               |

## 3. 事件面（✅ 真 LLM 实测 + 映射）

**faux 流捕获**：`agent_start` `agent_end` `message_start` `message_end` `text_delta` `extension_event` `worker_ready` `rpc_response`。
**真 LLM 流捕获**（glm-5.3-flash + read 工具，全链路正确完成任务）：
`agent_start` → `message_start`(×3) → `text_delta`(×29) → **`tool_call_delta`(×2)** → **`tool_execution_start`** → **`tool_execution_update`** → **`tool_execution_end`** → `message_end` → `agent_end` + `extension_event`。

**工具事件实测形状（好消息：命名与 pi 一致）**：

```jsonc
tool_execution_start  {toolCallId:"call_8514…", toolName:"read", args:{file_path:"f.txt"}, sessionId, timestamp}
tool_execution_update {toolCallId, toolName, partialResult:"1\tfirst line…", sessionId}
tool_execution_end    {toolCallId, toolName, …}   // 同族
tool_call_delta       {delta:"{\"file_path\":\"f.txt\"}", toolName:"", sessionId, timestamp}  // ion 特有：工具参数流式增量
```

**pi→ion 映射**：

| pi 事件                                                                                                                                                                                                                     | ion 对应                                     | 状态                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| message_update（含 assistantMessageEvent.text_delta）                                                                                                                                                                       | **text_delta**（扁平）                       | ✅ 实测；adapter 转换                                                    |
| message_start/end                                                                                                                                                                                                           | 同名                                         | ✅ 实测                                                                  |
| agent_start/end                                                                                                                                                                                                             | 同名                                         | ✅ 实测                                                                  |
| tool_execution_start/update/end                                                                                                                                                                                             | 同名（字段名一致：toolCallId/toolName/args） | ✅ 实测；args 参数名是工具 schema 决定（ion read 用 `file_path`）        |
| —（pi 无）                                                                                                                                                                                                                  | tool_call_delta                              | ✅ ion 特有，adapter 可忽略或聚合                                        |
| turn_start/turn_end                                                                                                                                                                                                         | **不存在**                                   | ❌ 实测缺席；app 若依赖需 adapter 在 agent_start/end 边界合成            |
| compaction*start/end、queue_update、extension_ui_request、extension_ui_resolved、channel_data、custom_entry、session_rename、session_info_changed、auto_retry*\*、auto_continue、extension_llm_error、mcp_connection_change | extension_event / ui_event / 对应 RPC 帧     | ⏳ 部分对应（审批走 ui_event+approval_bus），逐个在 Phase 1 挂真实源验证 |

## 4. 关键差异清单（adapter 必须处理的"金块"）

1. **消息枚举形态**：所有 get\*\_messages 都是 `User:{content:[{Text:{…}}]}` Rust 枚举——flatten 层必须做（webui flatten_messages 为参考）。
2. **soft-error 模式**：`success:true` + `data.error`——**客户端不能只看 success**，要检查 data.error 字段。
3. **fork 参数**：turnId:number vs entryId:string。
4. **setTierModels 粒度**：单 tier vs 整 map。
5. **事件名**：text_delta vs message_update；turn_start/turn_end 不存在（adapter 合成）；多出 tool_call_delta。
6. **分页**：ion 游标（from:head/limit+hasMore）vs pi 的 navPage/around 语义——adapter 拼装。
7. **respondUI 路径**：必须 UI 专用长连接 + 同连接 ui_respond（跨连接实测被拒）。
8. **响应包壳两态**：worker 转发 `{command,data,success,type:"response"}` vs host 直答 `{data,session,success}`（无 command/type）——传输层统一归一。
9. **get_system_prompt 异常**：返回用户消息，疑 ion bug，需上游确认。
10. **扩展启用/路由三坑**：file-snapshot 默认关（config 开）；memory 匿名不可按名路由（需补 name()）；extension_rpc 错误不区分"没加载/没实现"，且 file_snapshot 单例路由另有 bug。
11. **set_flag / set_model 参数名**：extension+flag、modelId+provider。
12. **queue 形状扁平**、**navigate_tree 是线性列表**、**get_queue/get_tree 顶层键与 pi 不同**。
13. **rollback_preview 稳定性**：偶发 `worker dropped response channel`。
14. **monitor 注册不稳定**：两轮结果矛盾（ok vs not found），注册条件待查。

## 5. Phase 1 前必须补的实测（Gate）

- [x] ~~真 LLM 会话：tool*execution*\* 事件名与形状~~（✅ 2026-10-08，glm-5.3-flash + read 工具）
- [x] ~~turn_start/turn_end 是否存在~~（❌ 不存在，adapter 合成）
- [x] ~~启用 file-snapshot/file-approval 后复测~~（✅ §1.4/§2 已更新）
- [ ] mcp_toggle_server / mcp_restart_server / switch_agent / getLatestAgentChange
- [ ] export_html 参数形态、get_all_tools 语义、get_tree structure 模式非空会话
- [ ] monitor 注册条件查明（两轮矛盾）；hooks 非空 hooks.json 正向路径；memory 补 name() 后复测方法面
- [ ] get_system_prompt 异常上游确认
- [ ] ui_respond 同连接正向路径（审批回路端到端）

## 6. 证据

- 探针脚本：`docs/plans/ion-backend/probe-ion-rpc.sh`（本轮已跑 3 轮：/tmp/ion-probe-evidence.jsonl 73 行、evidence2 93 行、第三轮内联输出）
- ion 侧协议参考：`~/Project/study-rust/ion/tests/subscribe_protocol_ci.sh`（G1-G6）、`ion-webui/ion_client.py`
- **app 级 E2E**：`docs/plans/ion-backend/run-app-e2e-ion.sh`（11/11，含事件流/会话列表/状态富化）

## 7. ion 侧待补清单（直接适配决策产生，host RPC 增强）

| 项                                             | 现状                                                                                                                                                                                           | 影响                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `list_sessions` 缺 `title` 字段                | 实测只有 agent/model/status/started_at/latest_output                                                                                                                                           | ion 自动会话标题在 app 列表不可见                                                                    |
| `list_sessions` 不支持 `cwd` 过滤              | 实测传 cwd 返回全部                                                                                                                                                                            | 会话列表按 app 登记枚举；ion CLI 单独创建的会话不出现                                                |
| `get_session_info` 缺 `title`/`updated_at`     | 实测有 counts/model/is_running，无 title（set_session_name 后也无）                                                                                                                            | 列表富化只能拿运行态                                                                                 |
| `get_system_prompt` 返回用户消息               | 实测                                                                                                                                                                                           | 疑上游 bug，待确认                                                                                   |
| **`is_running` phantom-running（根因已定位）** | 实测根因：create_session 触发的自动标题 turn 收尾窗口内（agent_end 后 ~100ms）发 prompt → worker 挂死（agent_start 后零 text_delta、零 agent_end）→ is_running 永卡 true，worker 级 RPC 全被拒 | app 侧已绕（start() 等标题 turn 结算 ≤3s 关闭竞态窗口）；**ion 侧应修**：turn 收尾与新 prompt 的竞态 |
| `steer` 空闲时静默入队                         | 实测 steer 后 message_count 不变，消息永久滞留 steering 队列                                                                                                                                   | adapter 已绕（空闲降级 prompt）；ion 侧语义应对齐 pi（空闲 steer=投递）                              |
