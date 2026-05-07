/**
 * Provider 接口定义
 *
 * 所有接口只描述能力，不描述实现。
 * 每个 Provider 都有 Web 降级实现和原生增强实现两套。
 */

// ─── 文件能力 ────────────────────────────────────────────

export interface IFileProvider {
  /** 选择图片（拍照 + 相册） */
  pickImage(options?: { multiple?: boolean; quality?: number }): Promise<ImageResult[]>;
  /** 选择任意文件 */
  pickFile(options?: { multiple?: boolean; accept?: string[] }): Promise<FileResult[]>;
  /** 上传文件到服务端 */
  upload(
    file: File | Blob,
    options: { path: string; token: string; baseUrl: string },
  ): Promise<UploadResult>;
  /** 从剪贴板粘贴图片 */
  pasteFromClipboard(): Promise<ImageResult | null>;
}

export interface ImageResult {
  /** blob: / file:// / content:// */
  uri: string;
  blob: Blob;
  name: string;
  size: number;
  width?: number;
  height?: number;
}

export interface FileResult {
  uri: string;
  name: string;
  size: number;
  type: string;
  file: File;
}

export interface UploadResult {
  ok: boolean;
  path: string;
  size: number;
}

// ─── 通知能力 ────────────────────────────────────────────

export interface INotifyProvider {
  /** 请求通知权限 */
  requestPermission(): Promise<boolean>;
  /** 获取当前权限状态 */
  getPermissionStatus(): Promise<'granted' | 'denied' | 'prompt'>;
  /** 发送本地通知 */
  sendLocalNotification(options: {
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<void>;
  /** 注册推送 token（App 专有） */
  registerPushToken?(): Promise<string | null>;
  /** 通知点击事件监听 */
  onNotificationClick?(callback: (data: Record<string, any>) => void): () => void;
}

// ─── WebView 能力 ────────────────────────────────────────

export interface IWebViewProvider {
  /** 渲染网页内容（Web: iframe, Native: 原生 WebView） */
  render(options: { src: string; sandbox?: string; className?: string }): WebViewHandle;
  /** 在新窗口打开（Web: window.open, Native: 新 Activity） */
  openInNewWindow(options: { src: string; title?: string }): Promise<void>;
  /** 启用远程调试（仅 App） */
  enableRemoteDebug?(): void;
}

export interface WebViewHandle {
  /** 销毁/卸载 WebView */
  destroy(): void;
  /** 获取容器元素（Web 返回 iframe，Native 返回占位 div） */
  getElement(): HTMLElement | null;
}

// ─── 语音能力 ────────────────────────────────────────────

export interface IVoiceProvider {
  /** 是否支持语音识别 */
  isSupported(): boolean;
  /** 开始语音识别 */
  startRecognition(options?: { language?: string; translateTo?: string }): Promise<void>;
  /** 停止语音识别 */
  stopRecognition(): Promise<void>;
  /** 语音合成（TTS） */
  speak(text: string, options?: { voice?: string; language?: string }): Promise<void>;
  /** 停止语音合成 */
  stopSpeaking(): Promise<void>;
  /** 中间识别结果回调 */
  onPartialResult?: (callback: (text: string) => void) => void;
  /** 最终识别结果回调 */
  onFinalResult?: (callback: (text: string, translation?: string) => void) => void;
}

// ─── 存储能力 ────────────────────────────────────────────

export interface IStorageProvider {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

// ─── 深度链接能力 ────────────────────────────────────────

export interface IDeepLinkProvider {
  /** 获取启动时的深链 URL */
  getInitialUrl(): Promise<string | null>;
  /** 监听深链事件 */
  onDeepLink(callback: (url: string) => void): () => void;
  /** 触发深链导航（App: startActivity, Web: pushState） */
  navigate(url: string): void;
  /** 解析深链 URL 为结构化数据 */
  parse(url: string): DeepLinkData | null;
}

export interface DeepLinkData {
  action: 'home' | 'open_project' | 'open_session';
  projectId?: string;
  sessionId?: string;
  messageId?: string;
}
