/**
 * NativeDemo — 原生能力验证页面
 *
 * 集中验证所有 Platform Bridge 的原生融合功能。
 * 每个 Provider 一个测试卡片，点击测试，显示结果。
 *
 * 访问方式：LoginPage 上点击 🧪 Native Bridge Demo 按钮
 */
import React, { useState, useCallback } from "react";
import { platformBridge } from "../lib/platform/bridge";
import { getPlatform, isNative } from "../lib/platform/index";
import { NativeWebView } from "../lib/platform/components/NativeWebView";

interface TestResult {
  status: "idle" | "running" | "pass" | "fail" | "warn";
  message: string;
  detail?: string;
}

type TestResults = Record<string, TestResult>;

export const NativeDemo: React.FC = () => {
  const [results, setResults] = useState<TestResults>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [webViewSrc] = useState("https://www.baidu.com");

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${time}] ${msg}`].slice(-50));
  }, []);

  const setResult = useCallback((key: string, result: TestResult) => {
    setResults((prev) => ({ ...prev, [key]: result }));
  }, []);

  const statusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "pass":
        return "✅";
      case "fail":
        return "❌";
      case "warn":
        return "⚠️";
      case "running":
        return "⏳";
      default:
        return "⬜";
    }
  };

  const testPlatformDetection = useCallback(async () => {
    setResult("platform", { status: "running", message: "检测中..." });
    try {
      const platform = getPlatform();
      const native = isNative();
      setResult("platform", {
        status: native ? "pass" : "warn",
        message: `Platform: ${platform}, isNative: ${native}`,
        detail: native ? "原生环境检测正确" : "Web 环境，原生能力将降级",
      });
      addLog(`Platform: ${platform}, isNative: ${native}`);
    } catch (e: unknown) {
      setResult("platform", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testFilePickImage = useCallback(async () => {
    setResult("file-image", { status: "running", message: "等待选择图片..." });
    addLog("调用 platformBridge.file.pickImage()...");
    try {
      const images = await platformBridge.file.pickImage({ multiple: false });
      if (images.length > 0) {
        setResult("file-image", {
          status: "pass",
          message: `选择 ${images.length} 张图片`,
          detail: `文件: ${images[0].name}, 大小: ${(images[0].size / 1024).toFixed(1)}KB`,
        });
        addLog(`图片选择成功: ${images[0].name} (${images[0].size} bytes)`);
      } else {
        setResult("file-image", {
          status: "warn",
          message: "未选择图片（用户取消）",
        });
      }
    } catch (e: unknown) {
      setResult("file-image", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
      addLog(`图片选择失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [setResult, addLog]);

  const testFilePickFile = useCallback(async () => {
    setResult("file-pick", { status: "running", message: "等待选择文件..." });
    addLog("调用 platformBridge.file.pickFile()...");
    try {
      const files = await platformBridge.file.pickFile({ multiple: false });
      if (files.length > 0) {
        setResult("file-pick", {
          status: "pass",
          message: `选择 ${files.length} 个文件`,
          detail: `文件: ${files[0].name}, 类型: ${files[0].type}`,
        });
        addLog(`文件选择成功: ${files[0].name}`);
      } else {
        setResult("file-pick", { status: "warn", message: "未选择文件" });
      }
    } catch (e: unknown) {
      setResult("file-pick", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
      addLog(`文件选择失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [setResult, addLog]);

  const testClipboardPaste = useCallback(async () => {
    setResult("clipboard", { status: "running", message: "尝试读取剪贴板图片..." });
    addLog("调用 platformBridge.file.pasteFromClipboard()...");
    try {
      const result = await platformBridge.file.pasteFromClipboard();
      if (result) {
        setResult("clipboard", {
          status: "pass",
          message: "剪贴板有图片",
          detail: `文件: ${result.name}, 大小: ${(result.size / 1024).toFixed(1)}KB`,
        });
        addLog(`剪贴板图片: ${result.name}`);
      } else {
        setResult("clipboard", {
          status: "warn",
          message: "剪贴板无图片（先截图再测试）",
        });
        addLog("剪贴板无图片");
      }
    } catch (e: unknown) {
      setResult("clipboard", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testNotifyPermission = useCallback(async () => {
    setResult("notify-perm", { status: "running", message: "请求通知权限..." });
    addLog("调用 platformBridge.notify.requestPermission()...");
    try {
      const granted = await platformBridge.notify.requestPermission();
      setResult("notify-perm", {
        status: granted ? "pass" : "fail",
        message: granted ? "通知权限已授予" : "通知权限被拒绝",
      });
      addLog(`通知权限: ${granted}`);
    } catch (e: unknown) {
      setResult("notify-perm", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testNotifySend = useCallback(async () => {
    setResult("notify-send", { status: "running", message: "发送本地通知..." });
    addLog("调用 platformBridge.notify.sendLocalNotification()...");
    try {
      await platformBridge.notify.sendLocalNotification({
        title: "Pi Agent Chat 测试",
        body: "这是一条测试通知，如果你看到了说明通知功能正常！",
        data: { test: true },
      });
      setResult("notify-send", {
        status: "pass",
        message: "通知已发送（检查通知栏）",
      });
      addLog("本地通知发送成功");
    } catch (e: unknown) {
      setResult("notify-send", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testWebViewRender = useCallback(async () => {
    setResult("webview-render", { status: "running", message: "测试 WebView 渲染..." });
    addLog("调用 platformBridge.webview.render()...");
    try {
      const handle = platformBridge.webview.render({
        src: "https://www.baidu.com",
        sandbox: "allow-scripts allow-same-origin",
      });
      if (handle) {
        setResult("webview-render", {
          status: "pass",
          message: "WebView 渲染成功",
          detail: "handle.getElement() 可获取容器元素",
        });
        addLog("WebView render 成功");
      } else {
        setResult("webview-render", { status: "fail", message: "handle 为空" });
      }
    } catch (e: unknown) {
      setResult("webview-render", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testWebViewNewWindow = useCallback(async () => {
    setResult("webview-window", { status: "running", message: "打开新窗口..." });
    addLog("调用 platformBridge.webview.openInNewWindow()...");
    try {
      await platformBridge.webview.openInNewWindow({
        src: "https://www.baidu.com",
        title: "测试窗口",
      });
      setResult("webview-window", {
        status: "pass",
        message: "新窗口已打开",
      });
      addLog("新窗口打开成功");
    } catch (e: unknown) {
      setResult("webview-window", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testVoiceRecognition = useCallback(async () => {
    setResult("voice", { status: "running", message: "检测语音能力..." });
    addLog("调用 platformBridge.voice.isSupported()...");
    try {
      const supported = platformBridge.voice.isSupported();
      if (supported) {
        setResult("voice", {
          status: "pass",
          message: "语音识别可用",
          detail: "点击后需要授权麦克风",
        });
        addLog("语音识别支持");

        addLog("尝试启动语音识别...");
        platformBridge.voice.onPartialResult?.((text) => {
          addLog(`语音中间结果: ${text}`);
        });
        platformBridge.voice.onFinalResult?.((text) => {
          addLog(`语音最终结果: ${text}`);
          setResult("voice", {
            status: "pass",
            message: `识别结果: ${text}`,
          });
        });
        await platformBridge.voice.startRecognition({ language: "zh" });
        setTimeout(async () => {
          await platformBridge.voice.stopRecognition();
        }, 5000);
      } else {
        setResult("voice", {
          status: "warn",
          message: "语音识别不可用（Web Speech API 不支持或无 ASR SDK）",
        });
      }
    } catch (e: unknown) {
      setResult("voice", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testVoiceTTS = useCallback(async () => {
    setResult("tts", { status: "running", message: "播放 TTS..." });
    addLog("调用 platformBridge.voice.speak()...");
    try {
      await platformBridge.voice.speak(
        "你好，这是 Pi Agent Chat 语音测试。如果你听到了，说明 TTS 功能正常。",
      );
      setResult("tts", { status: "pass", message: "TTS 播放完成" });
      addLog("TTS 播放成功");
    } catch (e: unknown) {
      setResult("tts", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testStorage = useCallback(async () => {
    setResult("storage", { status: "running", message: "测试存储..." });
    addLog("调用 platformBridge.storage...");
    try {
      const testKey = `test-${Date.now()}`;
      const testValue = "Hello Pi Agent Chat!";
      await platformBridge.storage.set(testKey, testValue);
      const retrieved = await platformBridge.storage.get(testKey);
      await platformBridge.storage.remove(testKey);

      if (retrieved === testValue) {
        setResult("storage", {
          status: "pass",
          message: "存储读写删除正常",
          detail: `写入 "${testValue}" → 读取 "${retrieved}" → 删除成功`,
        });
        addLog("存储测试通过");
      } else {
        setResult("storage", {
          status: "fail",
          message: `数据不匹配: 写入 "${testValue}", 读取 "${retrieved}"`,
        });
      }
    } catch (e: unknown) {
      setResult("storage", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testDeepLink = useCallback(async () => {
    setResult("deeplink", { status: "running", message: "测试深链解析..." });
    addLog("调用 platformBridge.deeplink.parse()...");
    try {
      const initialUrl = await platformBridge.deeplink.getInitialUrl();
      const parsed1 = platformBridge.deeplink.parse(
        "http://localhost/open_project?projectId=abc123",
      );
      const parsed2 = platformBridge.deeplink.parse(
        "http://localhost/open_session?projectId=abc123&sessionId=ses456",
      );
      const parsed3 = platformBridge.deeplink.parse("http://localhost/home");

      const allParsed = parsed1 && parsed2 && parsed3;
      setResult("deeplink", {
        status: allParsed ? "pass" : "fail",
        message: allParsed ? "深链解析正确" : "部分解析失败",
        detail:
          `initialUrl: ${initialUrl ?? "(无)"}\n` +
          `open_project: ${JSON.stringify(parsed1)}\n` +
          `open_session: ${JSON.stringify(parsed2)}\n` +
          `home: ${JSON.stringify(parsed3)}`,
      });
      addLog(`深链解析: ${allParsed ? "全部通过" : "部分失败"}`);
    } catch (e: unknown) {
      setResult("deeplink", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testHaptic = useCallback(async () => {
    setResult("haptic", { status: "running", message: "测试触觉反馈..." });
    addLog("调用 haptic...");
    try {
      const { haptic } = await import("../lib/haptic");
      haptic.light();
      await new Promise((r) => setTimeout(r, 500));
      haptic.medium();
      await new Promise((r) => setTimeout(r, 500));
      haptic.heavy();
      setResult("haptic", {
        status: "pass",
        message: "触觉反馈已触发（轻→中→重）",
        detail: "如果设备支持振动，你应该感觉到了三次振动",
      });
      addLog("触觉反馈测试完成");
    } catch (e: unknown) {
      setResult("haptic", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testEdgeSwipe = useCallback(async () => {
    setResult("swipe", {
      status: "warn",
      message: "需手动测试",
      detail:
        "从左边缘右滑 → 打开会话面板\n从右边缘左滑 → 打开状态面板\n（只在移动端生效，屏幕宽度 < 640px）",
    });
    addLog("边缘滑动需要手动测试");
  }, [setResult, addLog]);

  const testServiceWorker = useCallback(async () => {
    setResult("sw", { status: "running", message: "检查 Service Worker..." });
    addLog("检查 navigator.serviceWorker...");
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        setResult("sw", {
          status: registration ? "pass" : "warn",
          message: registration ? "Service Worker 已注册" : "Service Worker 未注册",
          detail: registration ? `Scope: ${registration.scope}` : "sw.js 可能未加载",
        });
        addLog(`Service Worker: ${registration ? "已注册" : "未注册"}`);
      } else {
        setResult("sw", { status: "warn", message: "Service Worker API 不可用" });
      }
    } catch (e: unknown) {
      setResult("sw", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const testOfflineQueue = useCallback(async () => {
    setResult("offline", { status: "running", message: "测试离线队列..." });
    addLog("测试离线队列...");
    try {
      const { offlineQueue } = await import("../lib/offline-queue");
      const item = offlineQueue.enqueue({
        sessionId: "test-session",
        content: "测试消息",
      });
      const size = offlineQueue.size();
      offlineQueue.clear();

      setResult("offline", {
        status: size > 0 ? "pass" : "fail",
        message: size > 0 ? "离线队列正常" : "队列写入失败",
        detail: `入队 ID: ${item.id}, 队列大小: ${size}`,
      });
      addLog(`离线队列: ${size > 0 ? "通过" : "失败"}`);
    } catch (e: unknown) {
      setResult("offline", {
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setResult, addLog]);

  const runAllTests = useCallback(async () => {
    setLogs([]);
    addLog("========== 开始运行所有测试 ==========");

    const tests = [
      testPlatformDetection,
      testStorage,
      testDeepLink,
      testServiceWorker,
      testOfflineQueue,
      testHaptic,
      testClipboardPaste,
      testNotifyPermission,
      testNotifySend,
      testWebViewRender,
    ];

    for (const test of tests) {
      await test();
      await new Promise((r) => setTimeout(r, 300));
    }

    addLog("========== 所有自动测试完成 ==========");
  }, [
    testPlatformDetection,
    testStorage,
    testDeepLink,
    testServiceWorker,
    testOfflineQueue,
    testHaptic,
    testClipboardPaste,
    testNotifyPermission,
    testNotifySend,
    testWebViewRender,
    addLog,
  ]);

  const handleExitDemo = useCallback(() => {
    localStorage.removeItem("show-native-demo");
    window.location.reload();
  }, []);

  const tests = [
    {
      key: "platform",
      label: "1. 平台检测",
      desc: "getPlatform() / isNative()",
      test: testPlatformDetection,
    },
    {
      key: "file-image",
      label: "2. 图片选择",
      desc: "pickImage() — 拍照/相册",
      test: testFilePickImage,
    },
    {
      key: "file-pick",
      label: "3. 文件选择",
      desc: "pickFile() — 文件选择器",
      test: testFilePickFile,
    },
    {
      key: "clipboard",
      label: "4. 剪贴板粘贴",
      desc: "pasteFromClipboard() — 粘贴图片",
      test: testClipboardPaste,
    },
    {
      key: "notify-perm",
      label: "5. 通知权限",
      desc: "requestPermission() — 请求通知权限",
      test: testNotifyPermission,
    },
    {
      key: "notify-send",
      label: "6. 发送通知",
      desc: "sendLocalNotification() — 本地通知",
      test: testNotifySend,
    },
    {
      key: "webview-render",
      label: "7. WebView 渲染",
      desc: "render() — 内嵌 WebView",
      test: testWebViewRender,
    },
    {
      key: "webview-window",
      label: "8. WebView 新窗口",
      desc: "openInNewWindow() — 独立窗口",
      test: testWebViewNewWindow,
    },
    {
      key: "voice",
      label: "9. 语音识别",
      desc: "startRecognition() — STT (5秒)",
      test: testVoiceRecognition,
    },
    { key: "tts", label: "10. 语音合成", desc: "speak() — TTS 播放", test: testVoiceTTS },
    { key: "storage", label: "11. 存储", desc: "set/get/remove — 本地存储", test: testStorage },
    {
      key: "deeplink",
      label: "12. 深度链接",
      desc: "parse() / getInitialUrl()",
      test: testDeepLink,
    },
    { key: "haptic", label: "13. 触觉反馈", desc: "haptic.light/medium/heavy()", test: testHaptic },
    { key: "swipe", label: "14. 边缘滑动", desc: "useEdgeSwipe — 需手动测试", test: testEdgeSwipe },
    {
      key: "sw",
      label: "15. Service Worker",
      desc: "getRegistration() — 离线缓存",
      test: testServiceWorker,
    },
    { key: "offline", label: "16. 离线队列", desc: "enqueue/size/clear", test: testOfflineQueue },
  ];

  const passCount = Object.values(results).filter((r) => r.status === "pass").length;
  const failCount = Object.values(results).filter((r) => r.status === "fail").length;
  const warnCount = Object.values(results).filter((r) => r.status === "warn").length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-indigo-400">🧪 Native Bridge Demo</h1>
          <button
            onClick={handleExitDemo}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            退出 Demo
          </button>
        </div>
        <p className="text-sm text-gray-400 mt-1">
          Platform: <span className="text-white font-mono">{getPlatform()}</span> | isNative:{" "}
          <span className="text-white font-mono">{String(isNative())}</span>
        </p>
        <div className="flex gap-4 mt-3 text-sm">
          <span className="text-green-400">✅ {passCount} 通过</span>
          <span className="text-red-400">❌ {failCount} 失败</span>
          <span className="text-amber-400">⚠️ {warnCount} 降级</span>
        </div>
        <button
          onClick={runAllTests}
          className="mt-3 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-white font-medium transition-colors"
        >
          ▶️ 运行所有自动测试
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tests.map(({ key, label, desc, test }) => (
          <div key={key} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-200">{label}</span>
              <span className="text-lg">{statusIcon(results[key]?.status || "idle")}</span>
            </div>
            <p className="text-xs text-gray-500 mb-3 font-mono">{desc}</p>
            {results[key]?.message && (
              <p
                className={`text-xs mb-2 ${
                  results[key]?.status === "pass"
                    ? "text-green-400"
                    : results[key]?.status === "fail"
                      ? "text-red-400"
                      : results[key]?.status === "warn"
                        ? "text-amber-400"
                        : "text-gray-400"
                }`}
              >
                {results[key]?.message}
              </p>
            )}
            {results[key]?.detail && (
              <pre className="text-xs text-gray-600 bg-gray-950 rounded p-2 mb-2 overflow-x-auto whitespace-pre-wrap">
                {results[key]?.detail}
              </pre>
            )}
            <button
              onClick={test}
              className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300 transition-colors"
            >
              运行测试
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-gray-900 rounded-lg p-4 border border-gray-800">
        <h3 className="font-medium text-gray-200 mb-3">🖥️ NativeWebView 实际渲染测试</h3>
        <div className="h-64 bg-white rounded overflow-hidden">
          <NativeWebView
            src={webViewSrc}
            title="WebView Demo"
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
          />
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-medium text-gray-300 mb-2">📋 日志</h2>
        <div className="bg-black rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs text-green-400">
          {logs.length === 0 ? (
            <span className="text-gray-600">等待测试...</span>
          ) : (
            logs.map((log, i) => <div key={i}>{log}</div>)
          )}
        </div>
      </div>
    </div>
  );
};
