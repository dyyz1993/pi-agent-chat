# Pi-Agent-Chat 测试话术手册：附录

[返回总览](./test-dialogues.md)

## 附录 A: 扩展-Channel-RPC 映射表

| 扩展               | Channel                | 注册的工具                                                                                                                            | Handler RPC                                                                                                |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| bash-ext           | bash                   | bash, get_background_process                                                                                                          | bash.list, bash.command, bash.readLog, bash.watchLog, bash.unwatchLog                                      |
| todo-ext           | todo                   | todo                                                                                                                                  | todo.list                                                                                                  |
| subagent           | subagent               | subagent, subagent_parallel, subagent_chain                                                                                           | subagent.listBySession, subagent.rename, subagent.delete                                                   |
| auto-memory        | memory                 | remember, memory_prefetch, memory_extract, memory_dream                                                                               | memory.listFiles, memory.readFile, memory.remember                                                         |
| rules-engine       | rules-engine           | (无，hook-based)                                                                                                                      | rules.list, rules.requestSnapshot                                                                          |
| coordinator        | coordinator            | session_delegate, session_delegate_send, session_delegate_status, session_delegate_list, session_delegate_stop, session_delegate_fork | (通过 process-manager)                                                                                     |
| ask-tools          | (extension_ui_request) | ask-confirm, ask-select, ask-input, ask-editor, ask-notify                                                                            | agent.respondUI                                                                                            |
| lsp                | lsp                    | lsp\_\*                                                                                                                               | lsp.status, lsp.setMode                                                                                    |
| file-snapshot      | file-snapshot          | (无，hook-based)                                                                                                                      | snapshot.list, snapshot.get, snapshot.rollback, snapshot.unrevert, snapshot.navigateTree, snapshot.getTree |
| preview            | —                      | preview                                                                                                                               | —                                                                                                          |
| auto-session-title | —                      | (无，hook-based)                                                                                                                      | —                                                                                                          |
| agent-permissions  | —                      | (无，hook-based)                                                                                                                      | —                                                                                                          |

---

## 附录 B: Mock-LLM Harness 接入指南

### B.1 基本架构

```
用户话术 → [Mock LLM] → 预设的工具调用序列 → Channel 事件 → UI 渲染
```

### B.2 Mock 策略

**话术匹配**：根据用户输入匹配预设的 Agent 响应模板
**工具调用模拟**：Mock LLM 直接返回预设的 tool_call，触发对应的工具执行
**事件注入**：直接通过 WebSocket/IPC 注入 Channel 事件，绕过 Agent 进程

### B.3 每个测试用例需要预设

1. **用户输入**：话术文本
2. **Agent 响应序列**：按顺序的 tool_call + text 块
3. **Channel 事件**：需要注入的事件和时序
4. **断言**：UI 元素的存在性/文本/状态/可见性

### B.4 分层测试策略

| 层级          | 覆盖范围           | Mock 程度                      |
| ------------- | ------------------ | ------------------------------ |
| L1 单组件     | 单个工具渲染器     | 100% mock events               |
| L2 单扩展     | 单个扩展的完整流程 | mock Agent，真实 Channel       |
| L3 多扩展串联 | T30.1 综合场景     | mock Agent，真实 Channel + RPC |
| L4 全链路     | 完整对话→UI→交互   | 真实 Agent，仅 mock LLM        |

### B.5 推荐优先级

1. **P0 (Smoke)**: T1.1, T1.2, T2.1, T3.1, T3.2, T9.1, T15.2
2. **P1 (Core)**: T2.2-T2.6, T4.1-T4.4, T5.1, T6.1, T8.1, T10.1, T14.1, T17.1-T17.5
3. **P2 (Complete)**: T5.2-T5.4, T7.1-T7.3, T8.2-T8.6, T11.1-T11.4, T12.1-T12.6, T16.1-T16.3
4. **P3 (Edge)**: T19.1, T20.1-T20.4, T23.1-T23.4, T24.1-T24.3, T26.1-T26.7, T29.1-T29.2
5. **P4 (Stress)**: T30.1-T30.5
