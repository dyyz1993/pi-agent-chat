# Testing Architecture

## 概述

项目使用 **5 种测试方法**，按速度从快到慢排列：

| 类型        | 工具                       | 配置文件               | 数量 | 速度 | 触发命令                   |
| ----------- | -------------------------- | ---------------------- | ---- | ---- | -------------------------- |
| Unit        | vitest (happy-dom)         | `vitest.config.ts`     | ~130 | 极快 | `bun run test:unit`        |
| Integration | vitest (happy-dom)         | `vitest.config.ts`     | ~100 | 慢   | `bun run test:integration` |
| Regression  | vitest (happy-dom)         | `vitest.config.ts`     | ~30  | 中   | `bun run test:regression`  |
| Smoke       | vitest (happy-dom)         | `vitest.config.ts`     | ~13  | 极快 | `bun run test:smoke`       |
| E2E-LLM     | vitest (node, single fork) | `vitest.config.e2e.ts` | ~11  | 极慢 | `bun run test:e2e-llm`     |
| Browser E2E | Playwright (chromium)      | `playwright.config.ts` | 17   | 慢   | `bunx playwright test`     |

> **默认 `bun run test`** 跑 Unit + Integration + Regression + Smoke（不含 E2E-LLM 和 Playwright）。

---

## 测试目录结构

```
test/                           # vitest 测试根目录
├── unit/                       # 单元测试 — 隔离测试单一模块
│   ├── stores/                 #   Zustand store 状态管理 (~50 文件)
│   ├── handlers/               #   RPC Handler 请求处理 (17 文件)
│   ├── utils/                  #   工具函数 / 纯逻辑 (15 文件)
│   ├── lib/                    #   项目配置 / 持久化 (1 文件)
│   └── components/             #   React 组件渲染 / DOM 交互 (19 文件)
├── integration/                # 集成测试 — 跨模块协作
│   ├── agent/                  #   Agent 运行时 + 进程池 (~35 文件)
│   ├── session/                #   Session 会话管理 (15 文件)
│   ├── chat/                   #   Chat 流式 + 渲染 (11 文件)
│   ├── coordinator/            #   Coordinator 协调层 (12 文件)
│   ├── compaction/             #   压缩与历史 (9 文件)
│   ├── render-cache/           #   渲染缓存 (3 文件)
│   ├── git/                    #   Git 集成 (3 文件)
│   ├── memory/                 #   Memory 集成 (2 文件)
│   ├── notification/           #   通知系统 (1 文件)
│   ├── tabbar/                 #   TabBar 集成 (2 文件)
│   └── cross/                  #   跨模块 (3 文件)
├── regression/                 # 回归测试 — Bug 修复保护
│   ├── rollback/               #   回滚相关 bug (~20 文件)
│   ├── agent/                  #   Agent 相关 bug (2 文件)
│   ├── change-review/          #   ChangeReview bug (3 文件)
│   └── chat/                   #   Chat 相关 bug (1 文件)
├── smoke/                      # 冒烟测试 — 快速健康检查
│   ├── phase/                  #   p0-p4 阶段验证 (5 文件)
│   └── batch/                  #   批次验证 (7 文件)
├── e2e-llm/                    # 真实 LLM 端到端 (独立配置)
│   ├── rpc/                    #   RPC 端到端流程 (5 文件)
│   ├── hooks/                  #   Hooks 引擎 (6 文件)
│   └── verify/                 #   验证类 (3 文件)
├── helpers/                    # 测试辅助工具
│   ├── event-fixtures*.ts      #   事件 mock fixture
│   ├── mock-llm.ts             #   LLM mock
│   ├── integration-server.ts   #   集成测试服务器
│   └── ...
├── setup.ts                    # vitest 全局 setup
└── fixtures.ts                 # 共享测试 fixture

e2e/                            # Playwright 浏览器 E2E (独立运行)
└── *.spec.ts                   #   17 个浏览器测试文件
```

---

## 各测试类型详解

### 1. Unit Tests（单元测试）

- **路径**: `test/unit/**/*.test.{ts,tsx}`
- **工具**: vitest + happy-dom + @testing-library/react
- **速度**: 极快（单文件 < 1s）
- **范围**: 隔离测试单一模块、函数、组件
- **特点**: 全部 mock 外部依赖，不依赖真实服务器或 CLI 进程

| 子目录        | 测试对象                           | 文件数 |
| ------------- | ---------------------------------- | ------ |
| `stores/`     | Zustand store 状态、action、hook   | ~50    |
| `handlers/`   | RPC handler 请求路由和业务逻辑     | 17     |
| `utils/`      | 纯函数、工具方法                   | 15     |
| `components/` | React 组件渲染、DOM 交互、用户事件 | 19     |
| `lib/`        | 持久化、配置读写                   | 1      |

### 2. Integration Tests（集成测试）

- **路径**: `test/integration/**/*.test.{ts,tsx}`
- **工具**: vitest + happy-dom
- **速度**: 慢（涉及多模块协作、文件系统操作）
- **范围**: 跨模块协作测试，如 store + handler + process-manager 联动
- **特点**: 部分 mock，保留真实模块间交互；agent/ 子目录使用 `@vitest-environment node` 做文件系统操作

### 3. Regression Tests（回归测试）

- **路径**: `test/regression/**/*.test.{ts,tsx}`
- **工具**: vitest + happy-dom
- **速度**: 中等
- **范围**: 针对已修复 bug 的保护性测试
- **特点**: 每个 test 文件对应一个已知 bug，防止复现；rollback/ 子目录最密集

### 4. Smoke Tests（冒烟测试）

- **路径**: `test/smoke/**/*.test.{ts,tsx}`
- **工具**: vitest + happy-dom
- **速度**: 极快
- **范围**: 快速健康检查，验证核心流程不挂
- **特点**: 分 phase（p0-p4 优先级递减）和 batch（按开发批次分组）

### 5. E2E-LLM Tests（真实 LLM 端到端）

- **路径**: `test/e2e-llm/**/*.test.ts`
- **工具**: vitest + ws（单线程顺序执行）
- **配置**: `vitest.config.e2e.ts`（`fileParallelism: false`, `singleFork: true`）
- **速度**: 极慢（需要真实 LLM API 响应）
- **范围**: 完整链路验证 — WebSocket → RPC → CLI 进程 → LLM → 消息回传
- **前提**: Dev server 运行中 + LLM API 可用

### 6. Browser E2E Tests（浏览器端到端）

- **路径**: `e2e/*.spec.ts`
- **工具**: Playwright (chromium, headless)
- **配置**: `playwright.config.ts`
- **速度**: 慢（启动真实浏览器 + dev server）
- **范围**: 真实浏览器中验证 UI 交互、视觉状态、响应式布局
- **前提**: 自动启动 dev server（端口 3100 + 5173）

---

## 配置文件对照

| 文件                           | 用途                                            | include 范围                                                                                             |
| ------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `vitest.config.ts`             | 默认（Unit + Integration + Regression + Smoke） | `test/{unit,integration,regression,smoke}/**/*.test.{ts,tsx}`                                            |
| `vitest.config.integration.ts` | 需要真实服务器的集成测试                        | `test/integration/session/ready.test.ts` + `test/integration/agent/refresh-recovery-integration.test.ts` |
| `vitest.config.e2e.ts`         | 真实 LLM E2E                                    | `test/e2e-llm/**/*.test.ts`                                                                              |
| `playwright.config.ts`         | 浏览器 E2E                                      | `e2e/*.spec.ts`                                                                                          |

---

## 运行命令速查

```bash
# 默认 — 跑 vitest.config.ts 范围（unit + integration + regression + smoke）
bun run test

# 按类型
bun run test:unit           # test/unit/**
bun run test:integration    # test/integration/**
bun run test:regression     # test/regression/**
bun run test:smoke          # util + handler（最快）
bun run test:e2e-llm        # 真实 LLM（需 dev server）

# 按业务模块（跨类型聚合）
bun run test:chat           # 聊天相关
bun run test:agent          # Agent 相关
bun run test:rollback       # Rollback 相关
bun run test:process-manager
bun run test:coordinator
bun run test:bash / session / git / memory / theme / settings

# 高级
bash run-tests.sh list      # 列出所有分类
bash run-tests.sh check     # 检查文件完整性
bash run-tests.sh failed    # 只重跑上次失败

# 浏览器 E2E
bunx playwright test
```

---

## 散落文件收拢（已完成）

以下测试文件原位于 `test/` 根目录，已归入对应分类子目录：

| 原路径                                     | 新路径                                                      | 归类                   |
| ------------------------------------------ | ----------------------------------------------------------- | ---------------------- |
| `test/session-scanner.test.ts`             | `test/unit/lib/session-scanner.test.ts`                     | unit/lib               |
| `test/streaming-status.test.ts`            | `test/unit/stores/streaming-status.test.ts`                 | unit/stores            |
| `test/status-visibility-harness.test.ts`   | `test/unit/stores/status-visibility.test.ts`                | unit/stores            |
| `test/rollback-scenarios.test.ts`          | `test/regression/rollback/scenarios.test.ts`                | regression/rollback    |
| `test/rollback-managed-restart.test.ts`    | `test/regression/rollback/managed-restart.test.ts`          | regression/rollback    |
| `test/rollback-leafid-persistence.test.ts` | `test/regression/rollback/leafid-persistence.test.ts`       | regression/rollback    |
| `test/rollback-e2e-backtest.test.ts`       | `test/regression/rollback/e2e-backtest.test.ts`             | regression/rollback    |
| `test/process-manager-linecount.test.ts`   | `test/regression/agent/linecount-cache.test.ts`             | regression/agent       |
| `test/change-review-handler.test.ts`       | `test/unit/handlers/change-review.test.ts`                  | unit/handlers          |
| `test/agent-config.test.ts`                | `test/unit/utils/agent-config.test.ts`                      | unit/utils             |
| `test/getfullmessages-cache.test.ts`       | `test/integration/compaction/getFullMessages-cache.test.ts` | integration/compaction |

---

## 编写新测试指南

| 改动类型                   | 应放在                                        | 命名建议                                          |
| -------------------------- | --------------------------------------------- | ------------------------------------------------- |
| 新 Zustand store           | `test/unit/stores/<name>.test.ts`             | `chat.test.ts`                                    |
| 新 RPC handler             | `test/unit/handlers/<name>.test.ts`           | `bash.test.ts`                                    |
| 新工具函数                 | `test/unit/utils/<name>.test.ts`              | `clipboard.test.ts`                               |
| 新 React 组件              | `test/unit/components/<Component>.test.tsx`   | `MessageBubble.test.tsx`                          |
| 跨 store+component+handler | `test/integration/<domain>/<feature>.test.ts` | `integration/chat/refresh-recovery.test.ts`       |
| Bug 修复保护               | `test/regression/<domain>/<bug-name>.test.ts` | `regression/rollback/targetid-resolution.test.ts` |
| 快速冒烟                   | `test/smoke/<phase\|batch>/<n>.test.ts`       | `smoke/phase/p5.test.ts`                          |
| 真实 LLM 验证              | `test/e2e-llm/<category>/<feature>.test.ts`   | `e2e-llm/verify/auth-flow.test.ts`                |
| 浏览器交互                 | `e2e/<feature>.spec.ts`                       | `e2e/chat-pagination.spec.ts`                     |
