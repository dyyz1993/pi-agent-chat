import { Code, Eye, Save, Pencil, Check, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { FilePreview } from "../../types";
import { formatSize } from "../../utils/file-utils";
import { VirtualizedCodeView } from "./VirtualizedCodeView";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import { ContentSurface, SurfaceHeader } from "../primitives";
import { getFileIcon } from "../../utils/file-icon";
import { loadSavedZoom, saveZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./zoom-utils";
import { usePinchZoom } from "./use-pinch-zoom";

const log = createLogger("file");

type SaveState = "idle" | "saving" | "saved" | "error";

interface FileOverlayProps {
  preview: FilePreview;
  loading: boolean;
  onClose: () => void;
  onSave?: (content: string) => Promise<void>;
  onToggleEdit?: (editable: boolean) => void;
  embedded?: boolean;
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
  return baseUrl ? baseUrl + "/fs" + filePath + "?token=" + token : "/fs" + filePath + "?token=" + token;
}

function canUseFsRoute(): boolean {
  return apiClient.getTransport() === "websocket";
}

const toolbarBtnBase =
  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium transition-colors";

export function FileOverlay({
  preview,
  loading,
  onClose,
  onSave,
  onToggleEdit,
  embedded = false,
}: FileOverlayProps) {
  const { t } = useTranslation("explorer");
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);
  const [htmlSourceMode, setHtmlSourceMode] = useState(false);
  const [editContent, setEditContent] = useState(preview.content ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fontSize, setFontSize] = useState(loadSavedZoom);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const contentRef = usePinchZoom(fontSizeRef, setFontSize);

  // Sync content when preview changes (e.g., new file opened)
  useEffect(() => {
    setEditContent(preview.content ?? "");
  }, [preview.path, preview.content]);

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
    let cancelled = false;

    if (!isSvg) {
      setSvgContent(null);
      setSvgLoading(false);
      return;
    }

    if (preview.content != null) {
      setSvgContent(preview.content);
      setSvgLoading(false);
      return;
    }

    setSvgContent(null);
    if (!preview.imageUrl) return;

    setSvgLoading(true);
    fetch(preview.imageUrl)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setSvgContent(text);
      })
      .catch((err) => {
        if (!cancelled) {
          log.warn("SVG fetch failed", { error: String(err) });
          setSvgContent(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSvgLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isSvg, preview.path, preview.content, preview.imageUrl]);

  const zoomPercent = Math.round((fontSize / ZOOM_DEFAULT) * 100);

  const handleZoomIn = useCallback(() => {
    setFontSize((prev) => {
      const next = Math.min(prev + ZOOM_STEP, ZOOM_MAX);
      saveZoom(next);
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setFontSize((prev) => {
      const next = Math.max(prev - ZOOM_STEP, ZOOM_MIN);
      saveZoom(next);
      return next;
    });
  }, []);

  const handleZoomReset = useCallback(() => {
    setFontSize(ZOOM_DEFAULT);
    saveZoom(ZOOM_DEFAULT);
  }, []);

  const renderPreview = () => {
    if (loading || svgLoading) {
      return (
        <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
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
      const fontSizePx = fontSize + "px";
      const lineHeightPx = Math.round(fontSize * 20 / 12) + "px";
      return (
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onKeyDown={handleEditorKeyDown}
          className="flex-1 h-full min-w-0 overflow-auto whitespace-pre font-mono bg-surface-dim dark:bg-surface-code text-text-primary border-0 outline-none resize-none p-4"
          style={{ fontSize: fontSizePx, lineHeight: lineHeightPx }}
          spellCheck={false}
          wrap="off"
        />
      );
    }

    if (preview.content && !preview.editable) {
      return <VirtualizedCodeView code={preview.content} filename={preview.name} fontSize={fontSize} />;
    }

    return null;
  };

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const hasToolbarButtons =
    isHtml || (preview.isText && !preview.editable && onToggleEdit) || preview.editable;

  const zoomActions = preview.isText ? (
    <div className="flex items-center gap-0.5 mr-1 pr-2 border-r border-border-secondary">
      <button
        onClick={handleZoomOut}
        disabled={fontSize <= ZOOM_MIN}
        className={toolbarBtnBase + " text-text-tertiary hover:text-text-primary hover:bg-surface-hover disabled:opacity-40"}
        title={t("zoomOut")}
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleZoomReset}
        className={toolbarBtnBase + " text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}
        title={t("zoomReset")}
      >
        <span className="tabular-nums text-[10px] font-medium">{zoomPercent}%</span>
      </button>
      <button
        onClick={handleZoomIn}
        disabled={fontSize >= ZOOM_MAX}
        className={toolbarBtnBase + " text-text-tertiary hover:text-text-primary hover:bg-surface-hover disabled:opacity-40"}
        title={t("zoomIn")}
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : undefined;

  const actionsDivBtnBase =
    "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium transition-colors";

  const actions = zoomActions || hasToolbarButtons ? (
    <div className="flex items-center gap-1">
      {zoomActions}
      {hasToolbarButtons && (
        <div className="flex items-center gap-1 mr-1 pr-2 border-r border-border-secondary">
          {isHtml && (
            <button
              onClick={() => setHtmlSourceMode((v) => !v)}
              className={
                htmlSourceMode
                  ? actionsDivBtnBase + " text-accent bg-accent/10 hover:bg-accent/20"
                  : actionsDivBtnBase + " text-text-tertiary hover:text-text-primary hover:bg-surface-hover"
              }
              title={htmlSourceMode ? t("switchPreview") : t("switchSource")}
            >
              {htmlSourceMode ? <Eye className="w-3.5 h-3.5" /> : <Code className="w-3.5 h-3.5" />}
              <span>{htmlSourceMode ? t("preview") : t("source")}</span>
            </button>
          )}
          {preview.isText && !preview.editable && onToggleEdit && (
            <button
              onClick={() => onToggleEdit(true)}
              className={actionsDivBtnBase + " text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}
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
              className={
                saveState === "saved"
                  ? actionsDivBtnBase + " bg-status-success/80 text-white hover:bg-status-success/80"
                  : saveState === "error"
                    ? actionsDivBtnBase + " bg-status-error/80 text-white hover:bg-status-error/80"
                    : actionsDivBtnBase + " bg-accent text-white hover:bg-accent/85 disabled:opacity-70"
              }
              title={saveState === "saving" ? t("saving") : t("save") + " (Ctrl+Enter)"}
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
    </div>
  ) : undefined;

  const title = (
    <>
      {preview.name}
      {preview.size > 0 && (
        <span className="text-xs text-text-tertiary shrink-0 ml-2">{formatSize(preview.size)}</span>
      )}
      {preview.totalLines != null && (
        <span className="text-xs text-text-tertiary shrink-0 ml-2">{preview.totalLines} lines</span>
      )}
    </>
  );
  const titleIcon = getFileIcon({ name: preview.name, path: preview.path, type: "file" });

  return embedded ? (
    <div className="flex h-full min-h-0 flex-col bg-bg-elevated dark:bg-surface-code">
      <SurfaceHeader
        title={title}
        onClose={onClose}
        closeLabel={t("close", { ns: "common" })}
        icon={titleIcon}
        actions={actions}
      />
      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-hidden overscroll-contain bg-bg-secondary/60 flex flex-col touch-pan-y"
      >
        {renderPreview()}
      </div>
    </div>
  ) : (
    <ContentSurface
      bodyRef={contentRef}
      title={title}
      onClose={onClose}
      closeLabel={t("close", { ns: "common" })}
      icon={titleIcon}
      actions={actions}
      position="absolute"
      layer="modal"
      bodyClassName="flex-1 min-h-0 flex flex-col touch-pan-y"
      bodyStyle={{ overflow: "hidden" }}
    >
      {renderPreview()}
    </ContentSurface>
  );
}
