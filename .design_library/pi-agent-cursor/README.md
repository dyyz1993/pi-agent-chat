# pi-agent-cursor 设计系统

**风格**: Cursor/Windsurf 紧凑扁平工具风格

## 设计理念

- 深色暗蓝背景，不使用纯黑
- 紧凑信息密度，最小化间距
- 扁平卡片：无边框圆角，仅上下边框
- 左侧 3px 彩色条纹标识工具类型
- 深色语义色（不刺眼）
- 代码优先，终端风格输出
- 紧凑交互，快速操作

## 色彩体系

- 语义色全部使用深色调：tool=#008095, agent=#7f55cc, memory=#1e8c71
- 强调色 Violet (#746cff)
- 背景三层：#0b111a → #111827 → #121b28

## 典型卡片样式

- border-radius: 0（无圆角）或 2px
- 无左右边框，仅 border-top + border-bottom
- header 左侧 3px 条纹（语义色）
- 无 box-shadow
- 图标直接渲染（14px，无容器背景）
- 紧凑 padding：6px 12px header

## 适用场景

- 紧凑高效的 AI 编码助手
- 类似 Cursor IDE、Windsurf 的工具型界面
