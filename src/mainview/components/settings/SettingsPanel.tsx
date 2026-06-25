import { useEffect, useCallback, useState } from "react";
import { RotateCcw, Zap, Target, Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  FONT_PRESET_OPTIONS,
  useSettingsStore,
  type ToggleSettingKey,
  useRetryConfigStore,
  RETRY_DEFAULTS,
} from "../../stores/use-settings-store";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/use-session-store";
import { useTierStore, TIER_KEYS, type TierKey } from "../../stores/use-tier-store";
import { ModelPickerButton } from "../model-picker/ModelPickerButton";
import { Button, ModalDialog } from "../primitives";
import {
  getProxyStatus,
  enableProxy,
  disableProxy,
  refreshProxyStatus,
  type ProxyStatus,
} from "../../lib/proxy";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("settings");

interface SettingsPanelProps {
  onClose: () => void;
}

const TOGGLE_ITEMS: {
  key: ToggleSettingKey;
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

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation("settings");
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
    if (proxyStatus.preferred) {
      setProxyStatus(disableProxy());
    } else {
      setProxyStatus(enableProxy());
      setProxyStatusLoading(true);
      refreshProxyStatus()
        .then(setProxyStatus)
        .catch((err: unknown) => {
          log.warn("refresh proxy status failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          setProxyStatus(getProxyStatus());
        })
        .finally(() => setProxyStatusLoading(false));
    }
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

  return (
    <ModalDialog
      title={t("title")}
      onClose={onClose}
      closeLabel={t("close")}
      size="lg"
      className="w-[min(92vw,380px)] md:w-[720px] lg:w-[820px] xl:w-[980px]"
      style={{ maxWidth: "min(92vw, 980px)" }}
      bodyClassName="px-4 py-3 sm:px-5 sm:py-4 max-h-[70vh] lg:max-h-[min(78vh,720px)]"
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
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="space-y-3">
          <SectionHeader>{t("chatDisplay")}</SectionHeader>

          <div className="py-1">
            <div className="text-[13px] text-text-primary font-medium mb-1.5">
              {t("chatViewMode")}
            </div>
            <div className="flex rounded-lg border border-border-secondary overflow-hidden">
              {(["developer", "clean"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex-1 py-1.5 text-[12px] font-medium transition-colors ${
                    chatViewMode === mode
                      ? "bg-[var(--color-accent)] text-text-inverse"
                      : "bg-bg-elevated dark:bg-surface-dim text-text-secondary hover:bg-surface-dim dark:hover:bg-surface-hover/60"
                  }`}
                >
                  {t(`chatViewMode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as const)}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-text-tertiary mt-1">
              {chatViewMode === "developer"
                ? t("chatViewModeDeveloperDesc")
                : t("chatViewModeCleanDesc")}
            </div>
          </div>

          <div className="py-1">
            <div className="text-[13px] text-text-primary font-medium mb-1.5">
              {t("fontPreset")}
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border-secondary bg-bg-elevated/60 dark:bg-surface-dim/60 p-1">
              {FONT_PRESET_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFontPreset(option.key)}
                  className={`min-w-0 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap ${
                    fontPreset === option.key
                      ? "bg-[var(--color-accent)] text-text-inverse"
                      : "text-text-secondary hover:bg-surface-dim dark:hover:bg-surface-hover/60"
                  }`}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-text-tertiary mt-1">
              {t(FONT_PRESET_OPTIONS.find((option) => option.key === fontPreset)?.descKey ?? "")}
            </div>
          </div>

          {TOGGLE_ITEMS.map(({ key, labelKey, descKey }) => (
            <label
              key={key}
              className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-surface-dim dark:hover:bg-surface-dim/40 cursor-pointer transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-primary font-medium">{t(labelKey)}</div>
                <div className="text-[11px] text-text-tertiary mt-0.5">{t(descKey)}</div>
              </div>
              <ToggleSwitch checked={settings[key]} onChange={() => toggle(key)} />
            </label>
          ))}
        </div>

        <div className="space-y-3 border-t border-border-secondary/60 pt-4 dark:border-surface-dim/60 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <SectionHeader>{t("retryTitle")}</SectionHeader>

          <label className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-surface-dim dark:hover:bg-surface-dim/40 cursor-pointer transition-colors">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-text-primary font-medium">{t("retryEnabled")}</div>
              <div className="text-[11px] text-text-tertiary mt-0.5">{t("retryEnabledDesc")}</div>
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
        </div>

        <div className="space-y-3 border-t border-border-secondary/60 pt-4 dark:border-surface-dim/60 md:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <SectionHeader>{t("tierConfigTitle", "Tier 模型配置")}</SectionHeader>

          {TIER_KEYS.map((tier) => {
            const Icon = TIER_ICONS[tier];
            return (
              <div key={tier} className="flex items-center gap-3 py-2 px-1">
                <div className="flex items-center gap-1 w-16 shrink-0">
                  <Icon className="w-3 h-3 text-text-tertiary" />
                  <span className="text-[13px] text-text-secondary">{TIER_LABELS[tier]}</span>
                </div>
                <div className="flex-1 min-w-0">
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

          <div className="flex justify-end">
            <button
              onClick={handleSaveTierConfig}
              disabled={tierSaving}
              className="px-4 py-1.5 rounded-md text-xs bg-[var(--color-accent)] text-text-inverse hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
            >
              {tierSaving ? t("saving", "Saving...") : t("saveTier", "保存")}
            </button>
          </div>

          <div className="border-t border-border-secondary/60 dark:border-surface-dim/60" />

          <SectionHeader>{t("proxyTitle")}</SectionHeader>

          <label
            className={`flex items-start gap-3 py-2 px-1 rounded-lg transition-colors ${
              proxyStatusLoading
                ? "cursor-wait opacity-80"
                : "cursor-pointer hover:bg-surface-dim dark:hover:bg-surface-dim/40"
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-text-primary font-medium">{t("proxyEnabled")}</div>
              <div className="text-[11px] text-text-tertiary mt-0.5">{t("proxyEnabledDesc")}</div>
              <div
                className={`text-[11px] mt-1 ${
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
        </div>
      </div>
    </ModalDialog>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">
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
        <div className="text-[13px] text-text-primary font-medium">{label}</div>
        <div className="text-[11px] text-text-tertiary mt-0.5">{desc}</div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as T)}
        className="h-7 px-2 rounded-md border border-border-secondary bg-bg-elevated dark:bg-surface-dim text-[12px] text-text-secondary focus:outline-none focus:ring-1 focus:ring-border-focus cursor-pointer"
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
