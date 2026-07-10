# pi-agent-apple 设计系统

**风格**: Apple HIG 暗色风格 (macOS 原生暗色应用)

## 设计理念

- macOS 暗色灰阶背景（#1c1c1e）
- 毛玻璃效果（backdrop-filter: blur + saturate）
- 半透明层次，不使用实色背景
- 精致 10px 圆角
- Apple 蓝强调色（#0a84ff）
- 半透明边框（rgba 8% 白色）+ 0.5px 外发光线
- 分段控制器（Segmented Control）替代普通 tab
- 按钮有 press 态缩放

## 色彩体系

- 背景使用 macOS 标准灰阶
- 语义色使用 Apple HIG 标准色：success=#30d158, error=#ff453a
- 强调色 Apple Blue（#0a84ff）
- 所有面板和卡片都是半透明 rgba 背景

## 典型卡片样式

- border-radius: 10px
- border: 0.5px solid rgba(255,255,255,0.08) + 0.5px 外发光
- background: rgba(44,44,46,0.7) + backdrop-filter: blur(8px)
- 无左侧条纹，用图标颜色区分
- 图标 20px，Apple SF Symbols 风格线条
- macOS 窗口感：半透明 + 模糊

## 适用场景

- macOS 原生质感的 AI 编码助手
- 追求精致系统级体验的用户
