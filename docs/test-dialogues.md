# Pi-Agent-Chat 全面测试话术手册

> **用途**：通过预设话术引导 Agent 对话，覆盖全部 UI 功能、12 个扩展、7 个 Channel、35+ 个 Agent RPC 方法和所有交互式组件。每个话术都标注了触发的扩展/Channel/UI 元素，可用于 harness mock-LLM 自动化测试。
>
> **约定**：
>
> - `🗣️ 用户话术` — 输入到聊天框的文本
> - `🤖 Agent 预期行为` — Agent 应调用的工具/触发的事件
> - `👁️ UI 验证点` — 界面上应该出现/可操作的元素
> - `📦 扩展` — 涉及的扩展名
> - `📡 Channel` — 涉及的 channel 名
> - `🔌 RPC` — 涉及的 RPC 方法
> - `📱 响应式` — 涉及的响应式断点

---

---

## 分卷目录

- [第 1 卷：基础流程与核心扩展 T1-T15](./test-dialogues-part-1.md)
- [第 2 卷：高级功能与压力场景 T16-T30](./test-dialogues-part-2.md)
- [附录：扩展映射与 Mock-LLM Harness](./test-dialogues-appendix.md)

> 说明：原手册按分卷拆分，避免单个 Markdown 文件过长；各分卷保留原测试编号和章节标题。
