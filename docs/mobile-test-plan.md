# Pi-Agent-Chat 移动端测试方案 (T26.x)

> 使用 @ui-tester (agent-browser) + Playwright 驱动

## 架构

```
ui-tester subagent (验证驱动)
  │
  ├─ ① Bootstrap → 启动 dev server
  ├─ ② Plan → 加载 T26.x 话术清单
  ├─ ③ Explore → agent-browser 设置 mobile viewport
  ├─ ④ Execute → 逐条执行 7 个移动端场景
  ├─ ⑤ Persist → 沉淀选择器/路径到 .ui-tester/knowledge/
  └─ ⑥ Report → 输出测试报告
```

## 7 个移动端场景 (T26.1 ~ T26.7)

| ID    | 场景               | Viewport | Playwright 文件          | ui-tester 验证点                   |
| ----- | ------------------ | -------- | ------------------------ | ---------------------------------- |
| T26.1 | QuickActionToolbar | 375×812  | e2e/mobile-smoke.spec.ts | 输入框聚焦后工具栏出现             |
| T26.2 | @ 弹窗             | 375×812  | e2e/mobile-smoke.spec.ts | 三 Tab 切换 + 搜索过滤             |
| T26.3 | / 弹窗             | 375×812  | e2e/mobile-smoke.spec.ts | Commands/Skills Tab                |
| T26.4 | 侧边栏覆盖层       | 375×812  | e2e/mobile-smoke.spec.ts | 85%宽度 + bg-black/50 + 点背景关闭 |
| T26.5 | ProjectPicker 全屏 | 375×812  | (需要引导)               | Tab 切换 + 搜索 + safe-area        |
| T26.6 | Tab 关闭按钮       | 375×812  | e2e/mobile-smoke.spec.ts | 始终可见 + 44px 触摸目标           |
| T26.7 | Diff 强制 unified  | 375×812  | e2e/mobile-smoke.spec.ts | 非 split 视图                      |

## Playwright 运行方式

```bash
# 纯 Playwright 运行（无 ui-tester 辅助）
npx playwright test e2e/mobile-smoke.spec.ts --project=chromium

# 用 ui-tester 驱动验证
Task(
  subagent_type: "ui-tester",
  description: "Mobile smoke test T26.x",
  prompt: "测试移动端 7 个场景，viewport=375×812，URL=http://localhost:5173?token=test-ci-token"
)
```

## 进度追踪

monitor 每 30min 检测一次，看到 T26.x 从 remaining 消失 → 自动标记完成。
