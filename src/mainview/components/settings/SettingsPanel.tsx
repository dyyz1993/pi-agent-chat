import { useEffect, useCallback, useState } from "react";
import { X, RotateCcw, Zap, Target, Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useSettingsStore,
  type DisplaySettings,
  useRetryConfigStore,
  RETRY_DEFAULTS,
} from "../../stores/use-settings-store";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/use-session-store";
import { useTierStore, TIER_KEYS, type TierKey } from "../../stores/use-tier-store";
import { ModelPickerButton } from "../model-picker/ModelPickerButton";
import { isProxyEnabled, enableProxy, disableProxy } from "../../lib/proxy";

interface SettingsPanelProps {
  onClose: () => void;
}

const TOGGLE_ITEMS: {
  key: keyof DisplaySettings;
  labelKey: string;
  descKey: string;
}[] = [
  { key: "showToolCalls", labelKey: "showToolCalls", descKey: "showToolCallsDesc" },
  { key: "showToolResults", labelKey: "showToolResults", descKey: "showToolResultsDesc" },
  { key: "showThinking", labelKey: "showThinking", descKey: "showThinkingDesc" },
  { key: "collapseThinking", labelKey: "collapseThinking", descKey: "collapseThinkingDesc" },
  { key: "showTimeline", labelKey: "showTimeline", descKey: "showTimelineDesc" },
];

const RETRY_OPTIONS = [
  { value: 1, label: "1" },
  { value: 3, label: "3" },
  { value: 5, label: "5" },
  { value: 8, label: "8" },
  { value: 10, label: "10" },
  { value: 15, label: "15" },
  { value: 20, label: "20" },
];

const BASE_DELAY_OPTIONS = [
  { value: 5000, label: "5s" },
  { value: 10000, label: "10s" },
  { value: 15000, label: "15s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "60s" },
  { value: 120000, label: "120s" },
];

const MAX_DELAY_OPTIONS = [
  { value: 60000, label: "1min" },
  { value: 300000, label: "5min" },
  { value: 600000, label: "10min" },
  { value: 900000, label: "15min" },
  { value: 1800000, label: "30min" },
  { value: 3600000, label: "60min" },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation("settings");
  const settings = useSettingsStore();
  const toggle = useSettingsStore((s) => s.toggle);
  const reset = useSettingsStore((s) => s.reset);

  const retryConfig = useRetryConfigStore();
  const setRetryConfig = useRetryConfigStore((s) => s.setRetryConfig);
  const resetRetryConfig = useRetryConfigStore((s) => s.resetRetryConfig);

  const sessionId = useSessionStore((s) => s.activeSessionId);
  const availableModels = useSessionStore((s) => s.availableModels);
  const fetchModelState = useSessionStore((s) => s.fetchModelState);

  // ---- Tier 模型配置 ----
  const tierModels = useTierStore((s) => s.tierModels);
  const fetchTierConfig = useTierStore((s) => s.fetchTierConfig);
  const [localTierModels, setLocalTierModels] = useState<Record<string, string>>({});
  const [tierSaving, setTierSaving] = useState(false);

  const TIER_ICONS: Record<TierKey, React.ComponentType<{ className?: string }>> = {
    fast: Zap,
    pro: Target,
    max: Brain,
  };

  const TIER_LABELS: Record<TierKey, string> = {
    fast: t("tierFast"),
    pro: t("tierPro"),
    max: t("tierMax"),
  };

  // 打开面板时同步 tier 配置到本地
  useEffect(() => {
    if (!sessionId) return;
    fetchTierConfig(sessionId);
    fetchModelState(sessionId);
  }, [sessionId, fetchTierConfig, fetchModelState]);

  // 将 store 中的 tierModels 同步到本地编辑状态
  useEffect(() => {
    setLocalTierModels({ ...tierModels });
  }, [tierModels]);

  const handleSaveTierConfig = useCallback(async () => {
    if (!sessionId) return;
    setTierSaving(true);
    try {
      await apiClient.call("agent.setTierModels", {
        sessionId,
        models: localTierModels,
      });
      await fetchTierConfig(sessionId);
    } catch (err) {
      console.warn("[Settings] save tier config failed:", err);
    }
    setTierSaving(false);
  }, [sessionId, localTierModels, fetchTierConfig]);

  // ---- 代理设置 ----
  const [proxyLocalEnabled, setProxyLocalEnabled] = useState(isProxyEnabled());

  const toggleProxy = useCallback(() => {
    if (proxyLocalEnabled) {
      disableProxy();
      setProxyLocalEnabled(false);
    } else {
      enableProxy();
      setProxyLocalEnabled(true);
    }
  }, [proxyLocalEnabled]);

  useEffect(() => {
    if (!sessionId) return;
    apiClient
      .call("agent.getSettings", { sessionId })
      .then((raw) => {
        const retry = (raw as Record<string, unknown>)?.retry as
          | { enabled?: boolean; maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }
          | undefined;
        if (retry) {
          setRetryConfig({
            enabled: retry.enabled ?? RETRY_DEFAULTS.enabled,
            maxRetries: retry.maxRetries ?? RETRY_DEFAULTS.maxRetries,
            baseDelayMs: retry.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs,
            maxDelayMs: retry.maxDelayMs ?? RETRY_DEFAULTS.maxDelayMs,
          });
        }
      })
      .catch(() => {});
  }, [sessionId, setRetryConfig]);

  const persistRetry = useCallback(
    (patch: Partial<typeof retryConfig>) => {
      if (!sessionId) return;
      setRetryConfig(patch);
      const merged = { ...retryConfig, ...patch };
      apiClient
        .call("agent.setSettings", {
          sessionId,
          settings: {
            retry: {
              enabled: merged.enabled,
              maxRetries: merged.maxRetries,
              baseDelayMs: merged.baseDelayMs,
              maxDelayMs: merged.maxDelayMs,
            },
          },
        })
        .catch(() => {});
    },
    [sessionId, retryConfig, setRetryConfig],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      <div className="relative w-[380px] max-w-[90vw] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/80 dark:border-gray-800/80">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("title")}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label={t("close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
          <SectionHeader>{t("chatDisplay")}</SectionHeader>

          {TOGGLE_ITEMS.map(({ key, labelKey, descKey }) => (
            <label
              key={key}
              className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-gray-800 dark:text-gray-200 font-medium">
                  {t(labelKey)}
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {t(descKey)}
                </div>
              </div>
              <ToggleSwitch checked={settings[key]} onChange={() => toggle(key)} />
            </label>
          ))}

          <div className="border-t border-gray-200/60 dark:border-gray-800/60 my-2" />

          <SectionHeader>{t("retryTitle")}</SectionHeader>

          <label className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-gray-800 dark:text-gray-200 font-medium">
                {t("retryEnabled")}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                {t("retryEnabledDesc")}
              </div>
            </div>
            <ToggleSwitch
              checked={retryConfig.enabled}
              onChange={() => persistRetry({ enabled: !retryConfig.enabled })}
            />
          </label>

          <SelectRow
            label={t("retryMaxRetries")}
            desc={t("retryMaxRetriesDesc")}
            value={retryConfig.maxRetries}
            options={RETRY_OPTIONS}
            onChange={(v) => persistRetry({ maxRetries: v })}
          />

          <SelectRow
            label={t("retryBaseDelay")}
            desc={t("retryBaseDelayDesc")}
            value={retryConfig.baseDelayMs}
            options={BASE_DELAY_OPTIONS}
            onChange={(v) => persistRetry({ baseDelayMs: v })}
          />

          <SelectRow
            label={t("retryMaxDelay")}
            desc={t("retryMaxDelayDesc")}
            value={retryConfig.maxDelayMs}
            options={MAX_DELAY_OPTIONS}
            onChange={(v) => persistRetry({ maxDelayMs: v })}
          />

          <BackoffPreview config={retryConfig} />

          <div className="border-t border-gray-200/60 dark:border-gray-800/60 my-2" />

          <SectionHeader>{t("tierConfigTitle", "Tier 模型配置")}</SectionHeader>

          {TIER_KEYS.map((tier) => {
            const Icon = TIER_ICONS[tier];
            return (
              <div key={tier} className="flex items-center gap-3 py-2 px-1">
                <div className="flex items-center gap-1 w-16 shrink-0">
                  <Icon className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                  <span className="text-[13px] text-gray-600 dark:text-gray-300">
                    {TIER_LABELS[tier]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <ModelPickerButton
                    models={availableModels}
                    value={localTierModels[tier] ?? ""}
                    onChange={(v) => {
                      setLocalTierModels((prev) => ({ ...prev, [tier]: v }));
                    }}
                    placeholder={t("tierConfigDefault", "默认")}
                  />
                </div>
              </div>
            );
          })}

          <div className="flex justify-end">
            <button
              onClick={handleSaveTierConfig}
              disabled={tierSaving}
              className="px-4 py-1.5 rounded-md text-xs bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              {tierSaving ? t("saving", "Saving...") : t("saveTier", "保存")}
            </button>
          </div>

          <div className="border-t border-gray-200/60 dark:border-gray-800/60 my-2" />

          <SectionHeader>{t("proxyTitle")}</SectionHeader>

          <label className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-gray-800 dark:text-gray-200 font-medium">
                {t("proxyEnabled")}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                {t("proxyEnabledDesc")}
              </div>
            </div>
            <ToggleSwitch checked={proxyLocalEnabled} onChange={toggleProxy} />
          </label>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200/80 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-800/30">
          <button
            onClick={() => {
              reset();
              resetRetryConfig();
              persistRetry(RETRY_DEFAULTS);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t("reset")}</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
      {children}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec}s`;
  const min = sec / 60;
  if (min < 60) return `${Math.round(min * 10) / 10}min`;
  const hr = min / 60;
  return `${Math.round(hr * 10) / 10}h`;
}

function SelectRow<T extends number>({
  label,
  desc,
  value,
  options,
  onChange,
}: {
  label: string;
  desc: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 px-1">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-gray-800 dark:text-gray-200 font-medium">{label}</div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{desc}</div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as T)}
        className="h-7 px-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function BackoffPreview({
  config,
}: {
  config: { enabled: boolean; maxRetries: number; baseDelayMs: number; maxDelayMs: number };
}) {
  const { t } = useTranslation("settings");
  if (!config.enabled || config.maxRetries === 0) return null;

  const steps: string[] = [];
  let totalMs = 0;
  for (let i = 1; i <= config.maxRetries; i++) {
    const ms = Math.min(config.baseDelayMs * Math.pow(2, i - 1), config.maxDelayMs);
    totalMs += ms;
    steps.push(`#${i}: ${formatMs(ms)}`);
  }

  return (
    <div className="mt-1 px-1 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-gray-400 dark:text-gray-500">{t("retryPreview")}</div>
        <div
          className={`text-[11px] font-medium ${totalMs >= 7200000 ? "text-green-500" : totalMs >= 3600000 ? "text-amber-500" : "text-gray-400 dark:text-gray-500"}`}
        >
          {t("retryTotal")}: {formatMs(totalMs)}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono flex flex-wrap gap-x-3 gap-y-0.5">
        {steps.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? "bg-indigo-500" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
