import { useEffect, useCallback, useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  Brain,
  Network,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
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
import { Button, ModalDialog } from "../primitives";
import { UsagePanel } from "../usage-panel/UsagePanel";
import {
  getProxyStatus,
  refreshProxyStatus,
  setProxyPreference,
  type ProxyStatus,
} from "../../lib/proxy";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("settings");

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
  { key: "collapseToolCards", labelKey: "collapseToolCards", descKey: "collapseToolCardsDesc" },
  { key: "showTimeline", labelKey: "showTimeline", descKey: "showTimelineDesc" },
  { key: "showMemoryEntries", labelKey: "showMemoryEntries", descKey: "showMemoryEntriesDesc" },
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

type SettingsTabId = "display" | "retry" | "models" | "network" | "usage";

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  icon: ComponentType<{ className?: string }>;
  label: string;
}> = [
  { id: "display", icon: SlidersHorizontal, label: "显示" },
  { id: "retry", icon: Activity, label: "重试" },
  { id: "models", icon: Brain, label: "模型" },
  { id: "network", icon: Network, label: "网络" },
  { id: "usage", icon: Trophy, label: "战绩" },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation("settings");
  const [activeTab, setActiveTab] = useState<SettingsTabId>("display");
  const settings = useSettingsStore();
  const toggle = useSettingsStore((s) => s.toggle);
  const reset = useSettingsStore((s) => s.reset);
  const chatViewMode = useSettingsStore((s) => s.chatViewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);

  const retryConfig = useRetryConfigStore();
  const setRetryConfig = useRetryConfigStore((s) => s.setRetryConfig);
  const resetRetryConfig = useRetryConfigStore((s) => s.resetRetryConfig);

  const sessionId = useSessionStore((s) => s.activeSessionId);
  const availableModels = useSessionStore((s) => s.availableModels);
  const fetchModelState = useSessionStore((s) => s.fetchModelState);

  // ---- Tier 模型配置 ----
  const tierModels = useTierStore((s) =>
    sessionId ? s.dataBySession[sessionId]?.tierModels : undefined,
  );
  const globalDefaults = useTierStore((s) => s.globalDefaults);
  const effectiveTierModels = tierModels ?? globalDefaults;
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
    setLocalTierModels({ ...effectiveTierModels });
  }, [effectiveTierModels]);

  const handleSaveTierConfig = useCallback(async () => {
    if (!sessionId) return;
    setTierSaving(true);
    try {
      await apiClient.call("agent.setTierModels", {
        sessionId,
        models: localTierModels,
      });
      useTierStore.getState().setSessionTierModels(sessionId, localTierModels);
      await fetchTierConfig(sessionId);
      const { dataBySession, globalDefaults } = useTierStore.getState();
      const sessionData = dataBySession[sessionId];
      const activeTier = sessionData?.currentTier ?? null;
      const updatedModels = sessionData?.tierModels ?? globalDefaults;
      if (activeTier && updatedModels[activeTier]) {
        await useTierStore.getState().switchToTier(activeTier, sessionId);
      }
    } catch (err) {
      log.warn("save tier config failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    setTierSaving(false);
  }, [sessionId, localTierModels, fetchTierConfig, effectiveTierModels]);

  // ---- 代理设置 ----
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>(() => getProxyStatus());
  const [proxyStatusLoading, setProxyStatusLoading] = useState(false);

  const toggleProxy = useCallback(() => {
    setProxyStatusLoading(true);
    setProxyPreference(!proxyStatus.preferred)
      .then(setProxyStatus)
      .catch((err: unknown) => {
        log.warn("update proxy preference failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        setProxyStatus(getProxyStatus());
      })
      .finally(() => setProxyStatusLoading(false));
  }, [proxyStatus.preferred]);

  useEffect(() => {
    setProxyStatusLoading(true);
    refreshProxyStatus()
      .then(setProxyStatus)
      .catch((err: unknown) => {
        log.warn("initial proxy status failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        setProxyStatus(getProxyStatus());
      })
      .finally(() => setProxyStatusLoading(false));
  }, []);

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

  const displayContent = (
    <SettingsSection title={t("chatDisplay")}>
      <div className="rounded-lg border border-border-secondary bg-bg-primary/45 p-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-text-primary">{t("chatViewMode")}</div>
            <div className="mt-0.5 text-[11px] text-text-tertiary">
              {chatViewMode === "developer"
                ? t("chatViewModeDeveloperDesc")
                : t("chatViewModeCleanDesc")}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border-secondary bg-bg-elevated/70">
          {(["developer", "clean"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`h-8 text-[12px] font-medium transition-colors ${
                chatViewMode === mode
                  ? "bg-semantic-accent text-white"
                  : "text-text-secondary hover:bg-surface-hover/60"
              }`}
            >
              {t(`chatViewMode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as const)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        {TOGGLE_ITEMS.map(({ key, labelKey, descKey }) => (
          <label
            key={key}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-secondary bg-bg-primary/45 px-3 py-2.5 transition-colors hover:bg-surface-hover/40"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-text-primary">{t(labelKey)}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-text-tertiary">{t(descKey)}</div>
            </div>
            <ToggleSwitch checked={settings[key] as boolean} onChange={() => toggle(key)} />
          </label>
        ))}
      </div>
    </SettingsSection>
  );

  const retryContent = (
    <SettingsSection title={t("retryTitle")}>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-secondary bg-bg-primary/45 px-3 py-2.5 transition-colors hover:bg-surface-hover/40">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-text-primary">{t("retryEnabled")}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-text-tertiary">
            {t("retryEnabledDesc")}
          </div>
        </div>
        <ToggleSwitch
          checked={retryConfig.enabled}
          onChange={() => persistRetry({ enabled: !retryConfig.enabled })}
        />
      </label>

      <div className="rounded-lg border border-border-secondary bg-bg-primary/45 p-2">
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
      </div>

      <BackoffPreview config={retryConfig} />
    </SettingsSection>
  );

  const modelsContent = (
    <SettingsSection title={t("tierConfigTitle", "Tier 模型配置")}>
      <div className="rounded-lg border border-border-secondary bg-bg-primary/45 p-2">
        {TIER_KEYS.map((tier) => {
          const Icon = TIER_ICONS[tier];
          return (
            <div key={tier} className="flex items-center gap-3 rounded-md px-2 py-2">
              <div className="flex w-20 shrink-0 items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-text-tertiary" />
                <span className="text-[13px] text-text-secondary">{TIER_LABELS[tier]}</span>
              </div>
              <div className="min-w-0 flex-1">
                <ModelPickerButton
                  models={availableModels}
                  value={localTierModels[tier] ?? ""}
                  onChange={(v) => {
                    setLocalTierModels((prev) => ({ ...prev, [tier]: v }));
                  }}
                  placeholder={t("tierConfigDefault", "默认")}
                  placement="up"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSaveTierConfig}
          disabled={tierSaving}
          className="rounded-md bg-semantic-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-semantic-accent/80 disabled:opacity-40"
        >
          {tierSaving ? t("saving", "Saving...") : t("saveTier", "保存")}
        </button>
      </div>
    </SettingsSection>
  );

  const networkContent = (
    <SettingsSection title={t("proxyTitle")}>
      <label
        className={`flex items-start gap-3 rounded-lg border border-border-secondary bg-bg-primary/45 px-3 py-2.5 transition-colors ${
          proxyStatusLoading ? "cursor-wait opacity-80" : "cursor-pointer hover:bg-surface-hover/40"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-text-primary">{t("proxyEnabled")}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-text-tertiary">
            {t("proxyEnabledDesc")}
          </div>
          <div
            className={`mt-1 text-[11px] ${
              proxyStatus.active
                ? "text-status-success"
                : proxyStatus.configured === false
                  ? "text-status-warning"
                  : "text-text-tertiary"
            }`}
          >
            {proxyStatusLoading
              ? t("proxyStatusChecking")
              : proxyStatus.active
                ? t("proxyStatusActive")
                : proxyStatus.configured === false
                  ? t("proxyStatusNotConfigured")
                  : proxyStatus.preferred
                    ? t("proxyStatusPreferred")
                    : t("proxyStatusDisabled")}
          </div>
        </div>
        <ToggleSwitch
          checked={proxyStatus.preferred}
          onChange={toggleProxy}
          disabled={proxyStatusLoading}
        />
      </label>
    </SettingsSection>
  );

  const usageContent = (
    <SettingsSection title="Agent 战绩" flush>
      <UsagePanel scope="global" embedded />
    </SettingsSection>
  );

  const contentByTab: Record<SettingsTabId, ReactNode> = {
    display: displayContent,
    retry: retryContent,
    models: modelsContent,
    network: networkContent,
    usage: usageContent,
  };

  return (
    <ModalDialog
      title={t("title")}
      onClose={onClose}
      closeLabel={t("close")}
      size="lg"
      className="w-[min(960px,calc(100vw-1rem))] max-w-none max-sm:max-h-[calc(100vh-1rem)]"
      bodyClassName="min-h-0 overflow-hidden p-0"
      footerClassName="justify-between bg-surface-dim/50 dark:bg-surface-dim/30"
      footer={
        <>
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              reset();
              resetRetryConfig();
              persistRetry(RETRY_DEFAULTS);
            }}
            leadingIcon={<RotateCcw className="w-3.5 h-3.5" />}
          >
            {t("reset")}
          </Button>
          <Button size="md" variant="primary" onClick={onClose}>
            {t("close")}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div className="shrink-0 border-b border-border-secondary bg-bg-primary/50 p-2 sm:w-44 sm:border-b-0 sm:border-r">
          <div className="flex gap-1 overflow-x-auto scrollbar-none sm:flex-col sm:overflow-visible">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-h-[44px] min-w-[92px] items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors sm:min-h-0 sm:min-w-0 ${
                    selected
                      ? "bg-semantic-accent/10 text-semantic-accent"
                      : "text-text-tertiary hover:bg-surface-hover/50 hover:text-text-secondary"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{tab.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">{contentByTab[activeTab]}</div>
      </div>
    </ModalDialog>
  );
}

function SettingsSection({
  title,
  children,
  flush = false,
}: {
  title: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={flush ? "space-y-3" : "mx-auto max-w-2xl space-y-3"}>
      <div>
        <SectionHeader>{title}</SectionHeader>
      </div>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium uppercase text-text-tertiary">{children}</div>;
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
        <div className="text-[13px] text-text-primary font-medium">{label}</div>
        <div className="text-[11px] text-text-tertiary mt-0.5">{desc}</div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as T)}
        className="h-7 px-2 rounded-md border border-border-secondary bg-bg-elevated dark:bg-surface-dim text-[12px] text-text-secondary focus:outline-none focus:ring-1 focus:ring-semantic-accent cursor-pointer"
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
    <div className="mt-1 px-1 py-2 rounded-lg bg-surface-dim dark:bg-surface-dim/40 border-border-secondary dark:border-surface-dim">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-text-tertiary">{t("retryPreview")}</div>
        <div
          className={`text-[11px] font-medium ${totalMs >= 7200000 ? "text-status-success" : totalMs >= 3600000 ? "text-status-warning" : "text-text-tertiary"}`}
        >
          {t("retryTotal")}: {formatMs(totalMs)}
        </div>
      </div>
      <div className="text-[11px] text-text-tertiary font-mono flex flex-wrap gap-x-3 gap-y-0.5">
        {steps.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange();
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-semantic-accent" : "bg-surface-hover dark:bg-text-secondary"
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
