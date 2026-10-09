/**
 * ion 后端动态能力发现 —— 壳模式的核心。
 *
 * 用户定则：UI 是壳，插件能力"有则显示、无则消失"。能力不写死，
 * 从 channel-map（已映射的方法面）× ion 实际加载的扩展（get_extensions）
 * 两个事实推导；pi 后端恒全有（UI 行为不变）。
 */

import { ION_CHANNEL_MAP } from "./channel-map";

/** app channel → 提供它的 ion 扩展（get_extensions 里的名字，实测值） */
const CHANNEL_EXTENSION_REQUIREMENTS: Readonly<Record<string, string>> = {
  "file-review": "file-approval",
  "file-snapshot": "file_snapshot",
  "bash-ext": "bash",
  "rules-engine": "rules-engine",
  hooks: "hooks",
  memory: "memory",
  learning: "learning",
  goal: "goal_supervisor",
  "loop-scheduler": "monitor",
  lsp: "lsp",
  coordinator: "coordinator",
  "remote-ssh": "remote-ssh",
};

export interface ChannelCapability {
  /** 可调用（有映射方法且所需扩展已加载） */
  available: boolean;
  /** 已映射的方法数（app channel-method → ion） */
  mappedMethods: number;
  /** 所需 ion 扩展名 */
  requiresExtension: string;
  /** 扩展是否实际加载 */
  extensionLoaded: boolean;
  /** 不可用原因（available=false 时给 UI/日志看） */
  reason: "not-mapped" | "extension-not-loaded" | null;
}

export interface BackendCapabilities {
  backend: "pi" | "ion";
  channels: Record<string, ChannelCapability>;
}

/** pi 后端：全部 channel 恒可用（保持既有 UI 行为） */
export function piCapabilities(): BackendCapabilities {
  const channels: Record<string, ChannelCapability> = {};
  for (const name of Object.keys(CHANNEL_EXTENSION_REQUIREMENTS)) {
    channels[name] = {
      available: true,
      mappedMethods: 0,
      requiresExtension: CHANNEL_EXTENSION_REQUIREMENTS[name],
      extensionLoaded: true,
      reason: null,
    };
  }
  return { backend: "pi", channels };
}

/** ion 后端：channel-map 映射面 × get_extensions 实际加载列表 → 能力表 */
export function ionCapabilities(loadedExtensionNames: string[]): BackendCapabilities {
  const loaded = new Set(loadedExtensionNames);
  const channels: Record<string, ChannelCapability> = {};
  for (const [name, requiresExtension] of Object.entries(CHANNEL_EXTENSION_REQUIREMENTS)) {
    const mappedMethods = Object.keys(ION_CHANNEL_MAP[name] ?? {}).length;
    const extensionLoaded = loaded.has(requiresExtension);
    let available = false;
    let reason: ChannelCapability["reason"] = null;
    if (mappedMethods === 0) {
      reason = "not-mapped";
    } else if (!extensionLoaded) {
      reason = "extension-not-loaded";
    } else {
      available = true;
    }
    channels[name] = { available, mappedMethods, requiresExtension, extensionLoaded, reason };
  }
  return { backend: "ion", channels };
}

/** 右侧栏 PanelTabId → channel 名（未列出的 tab 属于壳能力，不门控） */
export const PANEL_TAB_CHANNEL: Readonly<Record<string, string>> = {
  changeReview: "file-review",
  goal: "goal",
  learning: "learning",
  rules: "rules-engine",
  hooks: "hooks",
  snapshot: "file-snapshot",
};
