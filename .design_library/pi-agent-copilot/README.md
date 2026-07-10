# pi-agent-copilot 设计系统

**风格**: GitHub Copilot 简洁折叠风格

## 设计理念

- GitHub Dark 色系（#0d1117 基础灰）
- 工具结果默认折叠为一行摘要（如 "✓ Bash: ls auth/ — 1.2s"）
- 点击 chevron 展开完整输出
- 极简信息密度，只显示关键摘要
- GitHub Blue 强调色（#58a6ff）
- 圆角 6-8px
- 代码块 GitHub 暗色风格（带语言标识 + 复制按钮）

## 折叠规则

- Bash/Read/Write 等工具卡片：默认折叠，只显示工具名 + 命令/路径 + 状态 + 时长
- 错误卡片：默认展开（必须让用户看到）
- Thinking：默认折叠，只显示 "思考了 X.Xs"
- Memory：默认折叠，只显示 "已保存会话上下文"
- 文字回复：始终展开
- 折叠状态使用 chevron-right 图标，展开用 chevron-down

## 典型折叠样式

```
折叠态（一行）:
▼ ✓ Bash  ls auth/                                1.2s
  （灰色小字，左侧绿色 ✓ 图标，右侧时长 badge）

展开态（完整）:
▼ ✓ Bash  ls auth/                                1.2s
  ┌─────────────────────────────────────────────┐
  │ auth/                                       │
  │ src/                                        │
  │ TokenService.ts                             │
  │ OAuthClient.ts                              │
  └─────────────────────────────────────────────┘
```

## 适用场景

- 追求简洁高效、只看关键信息的用户
- 类似 GitHub Copilot Chat、Claude.ai 的交互模式
