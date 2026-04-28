# 剪贴板（复制）功能统一规范

项目中所有涉及"复制到剪贴板"的功能，必须使用以下三个统一入口之一，禁止自行调用 `navigator.clipboard.writeText()` 或 `document.execCommand("copy")`。

## 统一入口

### 1. 底层工具函数：`copyToClipboard()`
- 路径：`src/mainview/utils/clipboard.ts`
- 适用场景：在非 React 组件中复制文本（如 store action、工具函数）
- 特性：自动检测 `isSecureContext`，提供 `execCommand("copy")` fallback

### 2. React Hook：`useClipboard()`
- 路径：`src/mainview/components/chat/preview/use-clipboard.ts`
- 适用场景：需要"已复制"视觉反馈的 React 组件
- 返回：`{ copied: boolean, copy: (text: string) => void }`
- 内部已集成 `copyToClipboard()`

### 3. React 组件：`CopyButton`
- 路径：`src/mainview/components/chat/CopyButton.tsx`
- 适用场景：需要一个独立的复制图标按钮
- Props：`{ text: string, size?: "xs" | "sm", className?: string, title?: string }`
- 内部已集成 `copyToClipboard()`，自带 copied/Check 图标切换

## 禁止行为

- 禁止直接调用 `navigator.clipboard.writeText()`（缺少 fallback，非 HTTPS 环境会静默失败）
- 禁止自行用 `useState` + `setTimeout` 管理 copied 状态（应使用 `useClipboard` hook）
- 禁止在组件中内联编写复制逻辑（应使用 `CopyButton` 或 `useClipboard`）

## 选择指南

| 场景 | 使用 |
|------|------|
| 需要一个独立的复制按钮 | `CopyButton` 组件 |
| 需要自定义 UI 但要 copied 状态 | `useClipboard` hook |
| 非 React 环境或简单复制 | `copyToClipboard()` |
| 上下文菜单项中的复制 | `copyToClipboard()`（菜单关闭后无法显示反馈） |
