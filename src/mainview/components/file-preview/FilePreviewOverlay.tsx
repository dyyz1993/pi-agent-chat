import { FileText, X, Code, Eye, Save, Pencil } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { FilePreview } from "../../types";
import { formatSize } from "../../utils/file-utils";
import { VirtualizedCodeView } from "./VirtualizedCodeView";
import { apiClient } from "../../lib/api-client";

interface FilePreviewOverlayProps {
  preview: FilePreview;
  loading: boolean;
  onClose: () => void;
  onSave?: (content: string) => void;
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

export function FilePreviewOverlay({
  preview,
  loading,
  onClose,
  onSave,
  onToggleEdit,
}: FilePreviewOverlayProps) {
  const { t } = useTranslation("explorer");
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);
  const [htmlSourceMode, setHtmlSourceMode] = useState(false);
  const [editContent, setEditContent] = useState(preview.content ?? "");
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

  const handleSave = useCallback(() => {
    if (onSave) {
      onSave(editContent);
    }
  }, [editContent, onSave]);

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
          console.warn("[FilePreview] SVG fetch failed:", err);
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
          className="flex items-center justify-center h-full p-4 bg-surface-code dark:bg-surface-code"
          dangerouslySetInnerHTML={{
            __html: sanitizeSvg(svgContent).replace(
              /<svg/,
              '<svg style="max-width: 100%; max-height: 100%;"',
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
          className="flex-1 w-full h-full border-0 bg-white"
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
          className="flex-1 w-full h-full text-xs font-mono bg-surface-dim dark:bg-surface-code text-text-primary dark:text-text-primary border-0 outline-none resize-none p-4"
          spellCheck={false}
        />
      );
    }

    if (preview.content && !preview.editable) {
      return <VirtualizedCodeView code={preview.content} filename={preview.name} />;
    }

    return null;
  };

  return (
    <div className="absolute inset-0 z-10 bg-bg-elevated/95 dark:bg-surface-code/95 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-surface-dim dark:bg-surface-dim border-b border-border-secondary dark:border-border-secondary flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-text-tertiary" />
          <span className="text-sm font-medium text-text-primary dark:text-text-primary">
            {preview.name}
          </span>
          {preview.size > 0 && (
            <span className="text-xs text-text-tertiary">{formatSize(preview.size)}</span>
          )}
          {preview.totalLines != null && (
            <span className="text-xs text-text-tertiary">{preview.totalLines} lines</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isHtml && (
            <button
              onClick={() => setHtmlSourceMode((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                htmlSourceMode
                  ? "text-semantic-accent bg-semantic-accent/10 hover:bg-semantic-accent/20"
                  : "text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50"
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
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          )}
          {preview.editable && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-semantic-accent hover:bg-semantic-accent/80 text-white transition-colors"
              title="Save (Ctrl+Enter)"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">{renderPreview()}</div>
    </div>
  );
}
