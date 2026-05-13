import {
  SearchCheck,
  Save,
  Sparkles,
  CheckCircle,
  XCircle,
  Loader,
  Bookmark,
  type LucideIcon,
} from "lucide-react";

export interface MemoryTypeConfig {
  icon: LucideIcon;
  color: string;
  label: string;
  pulse?: boolean;
}

export const ENTRY_TYPES: Record<string, MemoryTypeConfig> = {
  memory_prefetch: {
    icon: SearchCheck,
    color: "text-blue-400",
    label: "搜索记忆",
  },
  memory_prefetch_result: {
    icon: SearchCheck,
    color: "text-blue-400",
    label: "记忆搜索",
  },
  memory_extract: {
    icon: Save,
    color: "text-green-400",
    label: "保存记忆",
  },
  memory_extract_result: {
    icon: Save,
    color: "text-green-400",
    label: "提取结果",
  },
  memory_dream: {
    icon: Sparkles,
    color: "text-purple-400",
    label: "整理记忆",
  },
  memory_dream_result: {
    icon: Sparkles,
    color: "text-purple-400",
    label: "整合结果",
  },
};

export const LEGACY_ENTRY_TYPES: Record<string, MemoryTypeConfig> = {
  memory_created: {
    icon: CheckCircle,
    color: "text-teal-400",
    label: "已创建收藏",
  },
  memory_failed: {
    icon: XCircle,
    color: "text-red-400",
    label: "收藏失败",
  },
};

export const CHANNEL_ONLY_TYPES: Record<string, MemoryTypeConfig> = {
  bookmark_creating: {
    icon: Loader,
    color: "text-teal-400",
    label: "正在创建收藏...",
    pulse: true,
  },
  memory_updated: {
    icon: Bookmark,
    color: "text-yellow-400",
    label: "收藏完成",
  },
  memory_update_failed: {
    icon: Bookmark,
    color: "text-red-400",
    label: "收藏失败",
  },
};

export const ALL_MEMORY_TYPES: Record<string, MemoryTypeConfig> = {
  ...ENTRY_TYPES,
  ...LEGACY_ENTRY_TYPES,
  ...CHANNEL_ONLY_TYPES,
};

export const ENTRY_TYPE_KEYS = new Set<string>([
  ...Object.keys(ENTRY_TYPES),
  ...Object.keys(LEGACY_ENTRY_TYPES),
]);

export const ALL_MEMORY_TYPE_KEYS = new Set<string>(Object.keys(ALL_MEMORY_TYPES));

export function getMemoryConfig(customType: string): MemoryTypeConfig | undefined {
  return ALL_MEMORY_TYPES[customType];
}

export function isMemoryEntryType(customType: string): boolean {
  return ENTRY_TYPE_KEYS.has(customType);
}

export function getMemorySummary(customType: string, data: unknown): string | null {
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;

  switch (customType) {
    case "memory_prefetch": {
      if (d.skipped === true) return "跳过搜索，复用上次结果";
      const q = typeof d.query === "string" ? d.query : "";
      const n =
        typeof d.availableFiles === "number"
          ? d.availableFiles
          : Array.isArray(d.availableFiles)
            ? d.availableFiles.length
            : 0;
      return q ? `「${q.length > 40 ? q.slice(0, 40) + "…" : q}」(${n} 个文件)` : null;
    }
    case "memory_prefetch_result": {
      const prefetchQuery = typeof d._prefetchQuery === "string" ? d._prefetchQuery : "";

      const summary = typeof d.summary === "string" ? d.summary : "";
      const bytes = typeof d.injectedBytes === "number" ? d.injectedBytes : 0;
      const layer = typeof d.layer === "string" ? d.layer : "";
      const isForce = d.isForce === true;
      const files = Array.isArray(d.selectedFiles) ? (d.selectedFiles as string[]) : [];
      const durationMs = typeof d.durationMs === "number" ? d.durationMs : 0;
      const availableFiles = typeof d.availableFiles === "number" ? d.availableFiles : 0;
      const isNoResult = summary === "No relevant memories" || (bytes === 0 && files.length === 0);

      let resultPart: string;
      if (isNoResult) {
        if (layer === "not_triggered") resultPart = "未触发搜索（默认跳过）";
        else if (layer === "skip") resultPart = `规则命中，跳过搜索`;
        else if (layer === "error") resultPart = `搜索出错`;
        else {
          const parts: string[] = [];
          if (availableFiles > 0) parts.push(`${availableFiles}个文件`);
          if (durationMs > 0) parts.push(`${durationMs}ms`);
          resultPart = `无匹配结果${parts.length > 0 ? ` (${parts.join(" · ")})` : ""}`;
        }
      } else {
        const sizeLabel = bytes > 0 ? `${Math.round(bytes / 1024)}KB` : "";
        const fileCountLabel =
          availableFiles > 0
            ? `${availableFiles}个文件`
            : files.length > 0
              ? `${files.length}个文件`
              : "";
        const durationLabel = durationMs > 0 ? `${durationMs}ms` : "";
        const layerLabel =
          layer === "llm"
            ? isForce
              ? "强制触发"
              : "关键词触发"
            : layer === "skip"
              ? "规则"
              : layer === "not_triggered"
                ? "未触发"
                : "";
        const parts = [layerLabel, sizeLabel, fileCountLabel, durationLabel].filter(Boolean);
        resultPart = parts.length > 0 ? `已注入记忆 · ${parts.join(" · ")}` : "已注入记忆";
      }

      if (prefetchQuery) {
        const q = prefetchQuery.length > 30 ? prefetchQuery.slice(0, 30) + "…" : prefetchQuery;
        return `「${q}」→ ${resultPart}`;
      }

      return resultPart;
    }
    case "memory_extract": {
      const created = Array.isArray(d.created)
        ? (d.created as string[]).length
        : typeof d.created === "number"
          ? d.created
          : 0;
      const updated = Array.isArray(d.updated)
        ? (d.updated as string[]).length
        : typeof d.updated === "number"
          ? d.updated
          : 0;
      const parts: string[] = [];
      if (created > 0) parts.push(`新建 ${created} 条`);
      if (updated > 0) parts.push(`更新 ${updated} 条`);
      return parts.length > 0 ? parts.join("，") : "提取完成（无变更）";
    }
    case "memory_extract_result": {
      if (typeof d.summary === "string" && d.summary) return d.summary;
      return null;
    }
    case "memory_dream": {
      const parts: string[] = [];
      if (typeof d.merges === "number") parts.push(`合并 ${d.merges}`);
      if (typeof d.deletions === "number") parts.push(`删除 ${d.deletions}`);
      if (typeof d.updates === "number") parts.push(`更新 ${d.updates}`);
      return parts.length > 0 ? parts.join("，") : "整理完成（无变更）";
    }
    case "memory_dream_result": {
      if (typeof d.summary === "string" && d.summary) return d.summary;
      return null;
    }
    case "memory_created":
    case "memory_updated": {
      if (typeof d.filename === "string" && d.filename) return d.filename as string;
      if (Array.isArray(d.files)) return `${(d.files as unknown[]).length} 个文件`;
      return null;
    }
    case "memory_failed":
    case "memory_update_failed": {
      if (typeof d.reason === "string" && d.reason) return d.reason as string;
      if (typeof d.error === "string" && d.error) return d.error as string;
      return null;
    }
    case "bookmark_creating":
      return null;
    default:
      return null;
  }
}
