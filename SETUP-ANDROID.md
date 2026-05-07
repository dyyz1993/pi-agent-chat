# Android 开发环境搭建指南

## 前置条件

1. **Node.js >= 18** 或 **Bun >= 1.0**
2. **Android Studio** (最新版)
3. **Android SDK**: compileSdk 34, minSdk 24
4. **Java 17** (Android Gradle Plugin 8.x 要求)

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 初始化 Capacitor（首次）
bun run cap:init

# 3. 添加 Android 平台（首次）
bun run cap:add:android

# 4. 构建 Web 资源并同步到 Android
bun run build:android

# 5. 在 Android Studio 中打开
bun run cap:open:android

# 或直接运行到设备
bun run cap:run:android
```

## 开发模式 (Live Reload)

```bash
# 1. 修改 capacitor.config.ts 中的 server.url 为本机 IP
#    url: 'http://192.168.x.x:5173'

# 2. 启动开发服务器 + Android
bun run android:dev
```

## WebView 远程调试

1. 手机通过 USB 连接电脑
2. Chrome 打开 `chrome://inspect`
3. 找到你的 WebView → 点击 inspect
4. 即可实时调试 DOM、Console、Network

## CI/CD

推送代码到 GitHub 后自动触发：
- **Web 构建 + 测试**: `.github/workflows/ci.yml`
- **Android 构建 + 截图**: `.github/workflows/android.yml`
- **E2E 测试**: `.github/workflows/e2e.yml`
