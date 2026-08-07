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

PiAgentChat 可以作为 Web 服务运行（适合团队共享、远程访问、无桌面的服务器）。

支持 **macOS** 和 **Linux**（包括容器环境）。一行命令完成安装。

---

### 快速开始（一行安装）

在目标服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install-web.sh \
  | AUTH_TOKEN=your-secret-token bash
```

脚本会自动完成：

1. 安装 bun（服务器运行时）
2. 检查/升级 node 到 ≥ v22（Agent CLI 需要）
3. 下载预构建的 `pi-chat-web.tar.gz`（无需 clone 源码）
4. 生成 `.env` 配置
5. 配置守护进程（崩溃自动重启 + 开机自启）
6. 启动服务 + 健康检查

---

### 前置条件

| 条件             | 说明                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **SSH 访问权限** | 能 ssh 登录到目标服务器                                                                            |
| **AUTH_TOKEN**   | 自定义一个密码，用于 WebSocket 鉴权（浏览器登录时也要输入）                                        |
| **授权文件**     | `~/.pi/agent/` 下需要有 `auth.json` 和 `models.json`（LLM API Key），**缺失则 Agent 无法调用 LLM** |
| **网络**         | 服务器能访问 `github.com`（下载 Release 资产）和 `bun.sh`（安装运行时）                            |

> ⚠ **授权文件是唯一需要手动准备的**。服务能启动，但缺授权文件时发消息会报错。

---

### 完整部署流程

#### 1. 准备授权文件（在已有 pi 的机器上操作）

从你本机或其他已配置好的服务器，把授权文件拷到目标服务器：

```bash
# 先在目标服务器创建目录
ssh 目标服务器 'mkdir -p ~/.pi/agent'

# 拷贝授权文件（在源机器执行）
scp ~/.pi/agent/auth.json     目标服务器:~/.pi/agent/
scp ~/.pi/agent/models.json   目标服务器:~/.pi/agent/
scp ~/.pi/agent/settings.json 目标服务器:~/.pi/agent/
```

> 这些文件包含你的 LLM API Key。`auth.json` 权限应为 `600`。

#### 2. 一行安装（在目标服务器上执行）

```bash
curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install-web.sh \
  | AUTH_TOKEN=your-secret-token PORT=3100 bash
```

安装完成后会输出访问地址和验证结果。

#### 3. 开放网络访问

**局域网服务器（如 xyz-mac）**：通常无需额外配置，直接访问 `http://服务器IP:3100`。

**云服务器（如腾讯云/阿里云）**：需要在云控制台 → 安全组 → 添加入站规则：

- 协议端口：`TCP:3100`
- 来源：`0.0.0.0/0`（或限制为你的 IP）
- 策略：允许

#### 4. 验证

```bash
# 健康检查
curl http://服务器IP:3100/health
# → {"status":"ok","clients":0}

# 浏览器打开
http://服务器IP:3100
# 输入 AUTH_TOKEN 登录 → 发消息测试 Agent 是否响应
```

---

### 使用 80 端口（可选）

默认端口是 3100。如果希望用标准 80 端口（不用加端口号），有两种方式：

**方式 A：直接改端口（服务器上没有 nginx/apache）**

```bash
# 重新安装时指定 PORT=80
curl ... | AUTH_TOKEN=xxx PORT=80 bash
```

**方式 B：nginx 反向代理（服务器上已有 nginx）**

在 nginx 配置中添加：

```nginx
server {
    listen 80;
    server_name _;

    location /ws {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

然后 `nginx -s reload`。

---

### 守护进程（自动管理）

脚本会根据平台自动选择守护方案：

| 平台                          | 守护方式                  | 崩溃重启          | 开机自启     |
| ----------------------------- | ------------------------- | ----------------- | ------------ |
| **macOS**                     | launchd plist             | ✅ KeepAlive      | ✅ RunAtLoad |
| **Linux (systemd)**           | systemd service           | ✅ Restart=always | ✅ enable    |
| **Linux 容器** (dumb-init 等) | daemon.sh 重启循环 + cron | ✅ while 循环     | ✅ @reboot   |

容器环境检测逻辑：如果 `/proc/1/comm` 不是 `systemd`（如 `dumb-init`、`tini`），自动使用 daemon.sh 方案。

---

### 管理命令速查

**macOS（launchd）：**

```bash
launchctl list | grep pi-agent-chat          # 查看状态
launchctl unload ~/Library/LaunchAgents/com.pi-agent-chat.web.plist   # 停止
launchctl load ~/Library/LaunchAgents/com.pi-agent-chat.web.plist     # 启动
tail -f ~/.pi-agent-chat-web/logs/out.log    # 查看日志
```

**Linux（systemd）：**

```bash
systemctl status pi-agent-chat               # 查看状态
sudo systemctl restart pi-agent-chat         # 重启
sudo systemctl stop pi-agent-chat            # 停止
journalctl -u pi-agent-chat -f               # 查看日志
```

**Linux 容器（daemon.sh）：**

```bash
ps aux | grep server.js | grep -v grep       # 查看进程
pkill -f 'pi-agent-chat-web/server.js'       # 重启(daemon 自动拉起)
pkill -f 'pi-agent-chat-web/daemon.sh'       # 完全停止(含 daemon)
tail -f ~/.pi-agent-chat-web/logs/out.log    # 应用日志
tail -f ~/.pi-agent-chat-web/logs/daemon.log # 守护日志
```

---

### 环境变量

`.env` 文件位于安装目录（`~/.pi-agent-chat-web/.env`），安装后自动生成：

| 变量                  | 必填   | 默认值          | 说明                              |
| --------------------- | ------ | --------------- | --------------------------------- |
| `PORT`                | 否     | `3100`          | HTTP 服务端口                     |
| `AUTH_TOKEN`          | **是** | —               | API 认证令牌，WebSocket 连接需要  |
| `PI_CLI_PATH`         | 自动   | 包内            | pi CLI 路径（随包自带，无需修改） |
| `LOG_DIR`             | 否     | `安装目录/logs` | 日志目录                          |
| `PI_CODING_AGENT_DIR` | 否     | `~/.pi/agent`   | Agent 配置目录（含授权文件）      |

---

### 升级 / 重新安装

只需再次执行同一行命令，会自动停止旧服务、替换文件、重启：

```bash
curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install-web.sh \
  | AUTH_TOKEN=your-token bash
```

`.env` 和 `logs/` 会保留，不会丢失配置和历史日志。

---

### 高级：从源码构建（开发者用）

如果需要自定义构建（如改了代码后部署），可以从源码构建：

```bash
# 1. 构建服务器 bundle + 前端
bash scripts/build-server.sh

# 2. 手动启动(开发/调试用)
bun dist-server/server.js

# 3. 或用 pm2 持久化
pm2 start ecosystem.config.js
```

> 生产部署推荐使用一行安装脚本（预构建 Release 资产），不需要 clone 源码。

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
