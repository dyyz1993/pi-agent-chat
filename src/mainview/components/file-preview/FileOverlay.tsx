import { FileText, X, Code, Eye, Save, Pencil, Check, Loader2 } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { FilePreview } from "../../types";
import { formatSize } from "../../utils/file-utils";
import { VirtualizedCodeView } from "./VirtualizedCodeView";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import { IconButton } from "../primitives/IconButton";

const log = createLogger("file");

type SaveState = "idle" | "saving" | "saved" | "error";

interface FileOverlayProps {
  preview: FilePreview;
  loading: boolean;
  onClose: () => void;
  onSave?: (content: string) => Promise<void>;
  onToggleEdit?: (editable: boolean) => void;
}

function isSvgFile(filename: string): boolean {
  return filename.toLowerCase().endsWith(".svg");
}

function sanitizeSvg(svg: string): string {
  let clean = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  clean = clean.replace(/<script[\s\S]*?\/>/gi, "");
  clean = clean.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  clean = clean.replace(/(href|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, "");
  clean = clean.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "");
  return clean;
}

function isHtmlFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

function getFsUrl(filePath: string): string {
  const token = apiClient.getAuthToken();
  const baseUrl = apiClient.getBaseUrl();
  return baseUrl ? `${baseUrl}/fs${filePath}?token=${token}` : `/fs${filePath}?token=${token}`;
}

function canUseFsRoute(): boolean {
  return apiClient.getTransport() === "websocket";
}

const toolbarBtnBase =
  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium transition-colors";

export function FileOverlay({ preview, loading, onClose, onSave, onToggleEdit }: FileOverlayProps) {
  const { t } = useTranslation("explorer");
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);
  const [htmlSourceMode, setHtmlSourceMode] = useState(false);
  const [editContent, setEditContent] = useState(preview.content ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync content when preview changes (e.g., new file opened)
  useEffect(() => {
    setEditContent(preview.content ?? "");
  }, [preview.path, preview.content]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Auto-focus textarea when editable
  useEffect(() => {
    if (preview.editable && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [preview.editable]);

  const isSvg = isSvgFile(preview.name);
  const isHtml = isHtmlFile(preview.name) && canUseFsRoute();
  const fsUrl = isHtml ? getFsUrl(preview.path) : "";

  const handleSave = useCallback(async () => {
    if (!onSave || saveState === "saving") return;
    setSaveState("saving");
    try {
      await onSave(editContent);
      setSaveState("saved");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveState("idle"), 3000);
    }
  }, [editContent, onSave, saveState]);

  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  useEffect(() => {
    if (isSvg && preview.imageUrl && !svgContent) {
      setSvgLoading(true);
      fetch(preview.imageUrl)
        .then((res) => res.text())
        .then((text) => {
          setSvgContent(text);
        })
        .catch((err) => {
          log.warn("SVG fetch failed", { error: String(err) });
          setSvgContent(null);
        })
        .finally(() => setSvgLoading(false));
    }
  }, [isSvg, preview.imageUrl, svgContent]);

  const renderPreview = () => {
    if (loading || svgLoading) {
      return (
        <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
          <div className="w-5 h-5 border-2 border-semantic-accent border-t-transparent rounded-full animate-spin mr-2" />
          {t("loading")}
        </div>
      );
    }

    if (isSvg && svgContent) {
      return (
        <div
          className="flex items-center justify-center h-full p-4 bg-surface-code"
          dangerouslySetInnerHTML={{
            __html: sanitizeSvg(
              svgContent.replace(/<svg/, '<svg style="max-width: 100%; max-height: 100%;"'),
            ),
          }}
        />
      );
    }

    if (preview.isImage && preview.imageUrl) {
      return (
        <div className="flex items-center justify-center h-full p-4 bg-surface-code">
          <img
            src={preview.imageUrl}
            alt={preview.name}
            className="max-w-full max-h-full object-contain rounded"
          />
        </div>
      );
    }

    if (isHtml && !htmlSourceMode && fsUrl) {
      return (
        <iframe
          src={fsUrl}
          className="flex-1 w-full h-full border-0 bg-bg-elevated"
          title={preview.name}
          sandbox="allow-scripts allow-same-origin"
        />
      );
    }

    if (preview.isText && preview.editable) {
      return (
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onKeyDown={handleEditorKeyDown}
          className="flex-1 w-full h-full text-xs font-mono bg-surface-dim dark:bg-surface-code text-text-primary border-0 outline-none resize-none p-4"
          spellCheck={false}
        />
      );
    }

    if (preview.content && !preview.editable) {
      return <VirtualizedCodeView code={preview.content} filename={preview.name} />;
    }

    return null;
  };

  const hasToolbarButtons = isHtml || (preview.isText && !preview.editable && onToggleEdit) || preview.editable;

  return (
    <div className="absolute inset-0 z-10 bg-bg-elevated/95 dark:bg-surface-code/95 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-surface-dim border-b border-border-secondary flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-text-tertiary shrink-0" />
          <span className="text-sm font-medium text-text-primary truncate">{preview.name}</span>
          {preview.size > 0 && (
            <span className="text-xs text-text-tertiary shrink-0">{formatSize(preview.size)}</span>
          )}
          {preview.totalLines != null && (
            <span className="text-xs text-text-tertiary shrink-0">{preview.totalLines} lines</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasToolbarButtons && (
            <div className="flex items-center gap-1 mr-1 pr-2 border-r border-border-secondary">
              {isHtml && (
                <button
                  onClick={() => setHtmlSourceMode((v) => !v)}
                  className={`${toolbarBtnBase} ${
                    htmlSourceMode
                      ? "text-semantic-accent bg-semantic-accent/10 hover:bg-semantic-accent/20"
                      : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"
                  }`}
                  title={htmlSourceMode ? t("switchPreview") : t("switchSource")}
                >
                  {htmlSourceMode ? <Eye className="w-3.5 h-3.5" /> : <Code className="w-3.5 h-3.5" />}
                  <span>{htmlSourceMode ? t("preview") : t("source")}</span>
                </button>
              )}
              {preview.isText && !preview.editable && onToggleEdit && (
                <button
                  onClick={() => onToggleEdit(true)}
                  className={`${toolbarBtnBase} text-text-tertiary hover:text-text-primary hover:bg-surface-hover`}
                  title={t("edit", { ns: "explorer" })}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>{t("edit", { ns: "explorer" })}</span>
                </button>
              )}
              {preview.editable && (
                <button
                  onClick={handleSave}
                  disabled={saveState === "saving"}
                  className={`${toolbarBtnBase} ${
                    saveState === "saved"
                      ? "bg-status-success/80 text-white hover:bg-status-success/80"
                      : saveState === "error"
                        ? "bg-status-error/80 text-white hover:bg-status-error/80"
                        : "bg-semantic-accent text-white hover:bg-semantic-accent/85 disabled:opacity-70"
                  }`}
                  title={saveState === "saving" ? t("saving") : `${t("save")} (⌘↵)`}
                >
                  {saveState === "saving" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : saveState === "saved" ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {saveState === "saving"
                      ? t("saving")
                      : saveState === "saved"
                        ? t("saved")
                        : saveState === "error"
                          ? t("saveFailed")
                          : t("save")}
                  </span>
                </button>
              )}
            </div>
          )}
          <IconButton label={t("close", { ns: "common" })} variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">{renderPreview()}</div>
    </div>
  );
}
