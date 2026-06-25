import {
  useEffect,
  useCallback,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Network,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  FONT_PRESET_OPTIONS,
  useSettingsStore,
  type DisplaySettings,
  useRetryConfigStore,
  RETRY_DEFAULTS,
} from "../../stores/use-settings-store";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/use-session-store";
import { useTierStore, TIER_KEYS, type TierKey } from "../../stores/use-tier-store";
import { ModelPickerButton } from "../model-picker/ModelPickerButton";
import { Button, IconButton } from "../primitives";
import { UsagePanel } from "../usage-panel/UsagePanel";
import { useFocusTrap } from "../../hooks/use-focus-trap";
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

type TierSaveMessage = {
  type: "success" | "error";
  text: string;
};

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation("settings");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("display");
  const settings = useSettingsStore();
  const toggle = useSettingsStore((s) => s.toggle);
  const reset = useSettingsStore((s) => s.reset);
  const chatViewMode = useSettingsStore((s) => s.chatViewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const fontPreset = useSettingsStore((s) => s.fontPreset);
  const setFontPreset = useSettingsStore((s) => s.setFontPreset);

  const retryConfig = useRetryConfigStore();
  const setRetryConfig = useRetryConfigStore((s) => s.setRetryConfig);
  const resetRetryConfig = useRetryConfigStore((s) => s.resetRetryConfig);

  const sessionId = useSessionStore((s) => s.activeSessionId);
  const availableModels = useSessionStore((s) => s.availableModels);
  const fetchModelState = useSessionStore((s) => s.fetchModelState);

  const tierModels = useTierStore((s) =>
    sessionId ? s.dataBySession[sessionId]?.tierModels : undefined,
  );
  const globalDefaults = useTierStore((s) => s.globalDefaults);
  const effectiveTierModels = tierModels ?? globalDefaults;
  const fetchTierConfig = useTierStore((s) => s.fetchTierConfig);
  const [localTierModels, setLocalTierModels] = useState<Record<string, string>>({});
  const [tierSaving, setTierSaving] = useState(false);
  const [tierSaveMessage, setTierSaveMessage] = useState<TierSaveMessage | null>(null);

  const TIER_ICONS: Record<TierKey, ComponentType<{ className?: string }>> = {
    fast: Zap,
    pro: Target,
    max: Brain,
  };

  const TIER_LABELS: Record<TierKey, string> = {
    fast: t("tierFast"),
    pro: t("tierPro"),
    max: t("tierMax"),
  };

  useEffect(() => {
    if (!sessionId) return;
    fetchTierConfig(sessionId);
    fetchModelState(sessionId);
  }, [sessionId, fetchTierConfig, fetchModelState]);

  useEffect(() => {
    setLocalTierModels({ ...effectiveTierModels });
  }, [effectiveTierModels]);

  const handleSaveTierConfig = useCallback(async () => {
    setTierSaveMessage(null);
    if (!sessionId) {
      setTierSaveMessage({ type: "error", text: t("tierSaveNoSession") });
      return;
    }
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
      setTierSaveMessage({ type: "success", text: t("tierSaveSuccess") });
    } catch (err) {
      log.warn("save tier config failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setTierSaveMessage({ type: "error", text: t("tierSaveFailed") });
    } finally {
      setTierSaving(false);
    }
  }, [sessionId, localTierModels, fetchTierConfig, t]);

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

      <div className="rounded-lg border border-border-secondary bg-bg-primary/45 p-3">
        <div className="mb-2">
          <div className="text-[13px] font-medium text-text-primary">{t("fontPreset")}</div>
          <div className="mt-0.5 text-[11px] text-text-tertiary">
            {t(FONT_PRESET_OPTIONS.find((option) => option.key === fontPreset)?.descKey ?? "")}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border-secondary bg-bg-elevated/60 p-1 dark:bg-surface-dim/60">
          {FONT_PRESET_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFontPreset(option.key)}
              className={`min-w-0 whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${
                fontPreset === option.key
                  ? "bg-semantic-accent text-white"
                  : "text-text-secondary hover:bg-surface-hover/60"
              }`}
            >
              {t(option.labelKey)}
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
                    setTierSaveMessage(null);
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

      <div className="flex flex-wrap items-center justify-end gap-2">
        {tierSaveMessage && (
          <div
            className={`mr-auto flex min-h-8 min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] ${
              tierSaveMessage.type === "success"
                ? "border-status-success/30 bg-status-success/10 text-status-success"
                : "border-status-error/30 bg-status-error/10 text-status-error"
            }`}
            role="status"
          >
            {tierSaveMessage.type === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0">{tierSaveMessage.text}</span>
          </div>
        )}
        <Button size="sm" variant="primary" onClick={handleSaveTierConfig} loading={tierSaving}>
          {t("saveTier")}
        </Button>
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

  useFocusTrap(panelRef, { onEscape: onClose });

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="settings-panel"
      className="fixed inset-0 z-modal flex flex-col overflow-hidden bg-bg-primary text-text-primary"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div
        className="flex min-h-[56px] shrink-0 items-center gap-3 border-b border-border-secondary bg-bg-elevated/95 px-3 sm:px-5"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t("title")}
        </h2>
        <IconButton label={t("close")} size="md" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 bg-bg-primary md:flex">
        <aside className="shrink-0 border-b border-border-secondary bg-bg-elevated/60 p-2 md:w-56 md:border-b-0 md:border-r md:bg-bg-primary/70 md:p-3 lg:w-64">
          <div className="flex gap-1 overflow-x-auto scrollbar-none md:flex-col md:overflow-visible">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-h-[44px] min-w-[92px] items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors md:min-w-0 ${
                    selected
                      ? "bg-semantic-accent/10 text-semantic-accent shadow-[inset_3px_0_0_var(--color-accent)]"
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
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full max-w-7xl px-3 py-4 sm:px-5 md:px-8 md:py-6">
            {contentByTab[activeTab]}
          </div>
        </main>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border-secondary bg-bg-elevated/95 px-3 py-3 sm:px-5">
        <Button
          size="md"
          variant="ghost"
          onClick={() => {
            reset();
            resetRetryConfig();
            persistRetry(RETRY_DEFAULTS);
          }}
          leadingIcon={<RotateCcw className="h-3.5 w-3.5" />}
        >
          {t("reset")}
        </Button>
        <Button size="md" variant="primary" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
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
    <div className={flush ? "space-y-3" : "max-w-3xl space-y-3"}>
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
    <div className="flex flex-col gap-2 px-1 py-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-text-primary">{label}</div>
        <div className="mt-0.5 text-[11px] text-text-tertiary">{desc}</div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as T)}
        className="h-8 w-full cursor-pointer rounded-md border border-border-secondary bg-bg-elevated px-2 text-[12px] text-text-secondary focus:outline-none focus:ring-1 focus:ring-border-focus dark:bg-surface-dim sm:h-7 sm:w-auto"
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
    <div className="mt-1 rounded-lg border border-border-secondary bg-surface-dim px-2 py-2 dark:border-surface-dim dark:bg-surface-dim/40">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[11px] text-text-tertiary">{t("retryPreview")}</div>
        <div
          className={`text-[11px] font-medium ${totalMs >= 7200000 ? "text-status-success" : totalMs >= 3600000 ? "text-status-warning" : "text-text-tertiary"}`}
        >
          {t("retryTotal")}: {formatMs(totalMs)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-text-tertiary">
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
      className={`relative inline-flex h-[22px] min-h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border p-[2px] transition-[background-color,border-color,box-shadow] duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:opacity-60 ${
        checked
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] shadow-sm shadow-black/10"
          : "border-border-secondary bg-surface-dim hover:bg-surface-hover dark:bg-bg-tertiary dark:hover:bg-surface-dim"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
