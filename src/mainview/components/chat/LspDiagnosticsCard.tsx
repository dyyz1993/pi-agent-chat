import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { LspDiagnosticList, type LspDiagnosticFile } from "./primitives/LspDiagnosticList";

export const LspDiagnosticsCard = memo(function LspDiagnosticsCard({ data }: { data: unknown }) {
  const { t } = useTranslation("chat");
  if (!data || typeof data !== "object") {
    return (
      <div className="my-0.5 overflow-hidden bg-status-warning/5">
        <div className="px-4 py-1 text-[11px] font-medium text-status-warning flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{t("lspDiagnostics")}</span>
        </div>
      </div>
    );
  }

  const details = data as { files?: LspDiagnosticFile[] };

  return (
    <div className="my-0.5 border border-status-warning/30 rounded-lg overflow-hidden bg-status-warning/50 dark:bg-status-warning/10">
      <div className="px-3 py-1.5 text-xs font-medium text-status-warning flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>{t("lspDiagnostics")}</span>
      </div>
      <div className="border-t border-status-warning/20">
        <LspDiagnosticList files={details.files ?? []} />
      </div>
    </div>
  );
});
