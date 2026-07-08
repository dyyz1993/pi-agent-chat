# PiAgentChat 部署文档

本文档说明如何将 PiAgentChat 部署到用户端（macOS / Linux）以及部署 Web 服务器版本。

---

## 📦 一、桌面端部署

### 方式 1：直接下载（推荐）

发布 Release 后，从 GitHub Releases 下载对应系统的安装包：

| 平台  | 架构                     | 下载文件                             |
| ----- | ------------------------ | ------------------------------------ |
| macOS | Apple Silicon (M1/M2/M3) | `PiAgentChat-v1.x.x-macos-arm64.dmg` |
| macOS | Intel                    | `PiAgentChat-v1.x.x-macos-x64.dmg`   |
| Linux | x86_64                   | 见下方说明                           |

**macOS 安装步骤：**

1. 下载 `.dmg` 文件
2. 双击打开
3. 将 `PiAgentChat.app` 拖入 `Applications` 文件夹
4. 首次启动：右键 → 打开（因为使用 ad-hoc 签名，不是付费开发者证书）
5. 后续版本会自动检查更新并提示

> ⚠️ **注意**：本应用使用 ad-hoc 签名（非 Apple Developer 付费证书），
> macOS 首次启动时会提示"无法验证开发者"。
> 在 **系统设置 → 隐私与安全性** 中点击"仍要打开"即可。
> 之后启动不会再提示。

**Linux 安装步骤：**

Linux 版本使用 Electrobun 的 native webview（webkit2gtk），不打包 CEF。
安装命令：

```bash
# 方式 A：一键安装脚本
curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install.sh | bash

# 方式 B：手动安装
# 1. 下载应用包
curl -fsSL https://github.com/dyyz1993/pi-agent-chat/releases/latest/download/stable-linux-x64-PiAgentChat.tar.zst \
  -o /tmp/pi-agent-chat.tar.zst

# 2. 解压
mkdir -p ~/.pi-agent-chat
zstd -d /tmp/pi-agent-chat.tar.zst -o /tmp/pi-agent-chat.tar
tar xf /tmp/pi-agent-chat.tar -C ~/.pi-agent-chat
rm -f /tmp/pi-agent-chat.tar /tmp/pi-agent-chat.tar.zst

# 3. 启动
~/.pi-agent-chat/bin/launcher

# 或创建 PATH 链接
ln -sf ~/.pi-agent-chat/bin/launcher ~/.local/bin/pi-agent-chat
export PATH=$HOME/.local/bin:$PATH
pi-agent-chat
```

**Linux 系统依赖：**

需要安装 WebKitGTK 库：

```bash
# Debian / Ubuntu
sudo apt-get install -y libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel

# Arch
sudo pacman -S webkit2gtk
```

### 方式 2：安装脚本

```bash
# 安装最新版
curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install.sh | bash

# 安装指定版本
curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install.sh | bash -s v1.0.0
```

### 方式 3：从源码构建

```bash
# 克隆仓库
git clone https://github.com/dyyz1993/pi-agent-chat.git
cd pi-agent-chat

# 安装依赖
bun install

# 构建前端 + 桌面端
bun run build:desktop

# 产物在 build/ 目录下
open build/stable-macos-arm64/PiAgentChat.app  # macOS
# 或
./build/stable-linux-x64/PiAgentChat/bin/launcher  # Linux
```

---

## 🔄 二、自动更新

桌面端内置了自动更新机制（基于 Electrobun Updater）。

### 工作原理

1. 每次发布 Release 时，CI 自动在 GitHub Releases 上上传以下文件：
   - `stable-macos-arm64-PiAgentChat.app.tar.zst` — macOS ARM64 完整包
   - `stable-macos-arm64-update.json` — 更新元数据
   - `stable-macos-x64-PiAgentChat.app.tar.zst` — macOS x64 完整包
   - `stable-macos-x64-update.json` — 更新元数据
   - `stable-linux-x64-PiAgentChat.tar.zst` — Linux x64 完整包
   - `stable-linux-x64-update.json` — 更新元数据

2. 用户启动 App 后，自动检查 `https://github.com/dyyz1993/pi-agent-chat/releases/latest/download/stable-{platform}-update.json`

3. 如果检测到新版本，自动下载并提示用户重启

> 💡 **不需要任何自建服务器**。自动化更新完全基于 GitHub Releases 提供的 CDN。

### CI 自动发布流程

当推送 `v*` 标签（如 `v1.0.1`）到 GitHub 时，自动触发：

1. macOS ARM64 构建 → DMG + tar.zst + update.json → 上传为 Release 附件
2. macOS x64 构建 → DMG + tar.zst + update.json → 上传为 Release 附件
3. Linux x64 构建 → tar.zst + update.json → 上传为 Release 附件
4. 全部构建成功后 → 自动创建 GitHub Release

---

## 🌐 三、Web 服务器部署

PiAgentChat 也可以作为 Web 服务运行（适合团队使用、远程访问）。

### 手动部署

```bash
# 1. 构建
bash scripts/build-server.sh

# 2. 配置
cp .env.example .env
# 编辑 .env，配置以下必要项：
#   AUTH_TOKEN=your-secret-token
#   PI_CLI_PATH=/path/to/pi

# 3. 启动
bun src/server.ts

# 4. 使用 pm2 持久化
pm2 start ecosystem.config.js
```

### 环境变量

| 变量                  | 必填   | 默认值        | 说明                                  |
| --------------------- | ------ | ------------- | ------------------------------------- |
| `PORT`                | 否     | `3100`        | HTTP 服务端口                         |
| `AUTH_TOKEN`          | **是** | —             | API 认证令牌，WebSocket 连接需要      |
| `PI_CLI_PATH`         | **是** | —             | pi CLI 二进制路径（如 `/usr/bin/pi`） |
| `PI_CODING_AGENT_DIR` | 否     | `~/.pi/agent` | Agent 配置目录                        |
| `LOG_DIR`             | 否     | `./logs`      | 日志目录                              |
| `SANDBOX_ENABLED`     | 否     | `false`       | 是否启用沙箱                          |
| `REMOTE_SSH_HOST`     | 否     | —             | 远程 SSH runtime 主机                 |
| `REMOTE_SSH_PORT`     | 否     | `22`          | SSH 端口                              |
| `REMOTE_SSH_USER`     | 否     | `root`        | SSH 用户                              |
| `REMOTE_SSH_KEY_PATH` | 否     | —             | SSH 私钥路径                          |

### CI/CD 自动部署

该仓库包含 GitHub Actions 工作流 `.github/workflows/deploy-web.yml`，支持自动部署到服务器。

**前置条件：** 在 GitHub 仓库的 Settings → Secrets 中配置：

| Secret 名称      | 说明                                 |
| ---------------- | ------------------------------------ |
| `DEPLOY_HOST`    | 服务器 IP 或域名                     |
| `DEPLOY_PORT`    | SSH 端口（默认 22）                  |
| `DEPLOY_USER`    | SSH 用户（默认 root）                |
| `DEPLOY_SSH_KEY` | SSH 私钥内容                         |
| `DEPLOY_PATH`    | 服务端部署路径（默认 /root/pi-chat） |
| `APP_PORT`       | 应用端口（用于健康检查，默认 3100）  |

**触发方式：**

- **自动**：推送代码到 `main` 分支且修改了 `src/`、`package.json` 等文件
- **手动**：在 GitHub Actions 页面选择 `Deploy Web Server` → `Run workflow`

---

## 🔧 四、发布新版本

完整的发版流程：

```bash
# 1. 确保代码已合并到 main
git checkout main
git pull

# 2. 更新版本号（遵循语义化版本）
#    - 修改 package.json 中的 version 字段
#    - 或使用 npm version 命令
npm version patch   # 修复: 1.0.0 → 1.0.1
npm version minor   # 功能: 1.0.0 → 1.1.0
npm version major   # 不兼容: 1.0.0 → 2.0.0

# 3. 推送标签（触发 CI 构建 + 发布）
git push --follow-tags
```

CI 自动执行：

1. 构建 macOS ARM64 + x64 桌面端
2. 构建 Linux x64 桌面端
3. 构建 Windows x64 桌面端
4. 生成自动更新所需的所有文件（tar.zst + update.json）
5. 发布 GitHub Release（含自动生成 Release Notes）

---

## 📋 五、部署检查清单

首次部署后验证：

- [ ] 桌面端：下载 DMG → 安装 → 打开 → 正常显示聊天界面
- [ ] 桌面端：自动更新检测正常（启动 5 秒后静默检查）
- [ ] Web 端：`curl http://localhost:3100/health` 返回 200
- [ ] Web 端：WebSocket 连接正常
- [ ] 配置：AUTH_TOKEN 生效
- [ ] 配置：pi CLI 路径正确，可调用
- [ ] 自动更新：`stable-{platform}-update.json` 可通过公网访问

---

## 🏗 六、架构概览

```
┌──────────────────────────────────────────────────┐
│ GitHub Repository (dyyz1993/pi-agent-chat)       │
│                                                  │
│  ┌─ .github/workflows/                          │
│  │  ├─ ci.yml          ← PR/推送: lint + test    │
│  │  ├─ release.yml     ← v* 标签: 构建+发布      │
│  │  └─ deploy-web.yml  ← main推送: 部署 Web 服务  │
│  └───────────────────────────────────────────────│
│                                                  │
│  ┌─ scripts/                                     │
│  │  ├─ install.sh     ← 用户一键安装脚本          │
│  │  ├─ start.sh       ← 启动桌面端/Web端          │
│  │  ├─ deploy.sh      ← 手动 Web 部署 (备用)      │
│  │  └─ ci-generate-update-artifacts.sh ← CI 更新  │
│  └───────────────────────────────────────────────│
└──────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
  ┌──────────────┐      ┌────────────────┐
  │ GitHub       │      │ Web 生产服务器   │
  │ Releases     │      │ pm2 → server.js │
  │ (CDN +       │      │ → :3100        │
  │  存储)       │      │ → WebSocket    │
  │              │      │ → Agent CLI    │
  │ DMG/tar.zst/ │      └────────────────┘
  │ update.json  │
  └──────┬───────┘
         │ auto-update
         ▼
  ┌──────────────┐
  │ 用户桌面端     │
  │ macOS / Linux │
  └──────────────┘
```
