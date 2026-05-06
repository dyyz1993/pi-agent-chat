import { X, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore, type DisplaySettings } from "../../stores/use-settings-store";

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

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation("settings");
  const settings = useSettingsStore();
  const toggle = useSettingsStore((s) => s.toggle);
  const reset = useSettingsStore((s) => s.reset);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-[380px] max-w-[90vw] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
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

        {/* Body */}
        <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {t("chatDisplay")}
          </div>

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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200/80 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-800/30">
          <button
            onClick={reset}
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
