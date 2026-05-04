import { FileText, X, Code, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import type { FilePreview } from "../../types";
import { formatSize } from "../../utils/file-utils";
import { VirtualizedCodeView } from "./VirtualizedCodeView";
import { apiClient } from "../../lib/api-client";

interface FilePreviewOverlayProps {
  preview: FilePreview;
  loading: boolean;
  onClose: () => void;
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
  return `/fs${filePath}?token=${token}`;
}

function canUseFsRoute(): boolean {
  return apiClient.getTransport() === "websocket";
}

export function FilePreviewOverlay({ preview, loading, onClose }: FilePreviewOverlayProps) {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);
  const [htmlSourceMode, setHtmlSourceMode] = useState(false);

  const isSvg = isSvgFile(preview.name);
  const isHtml = isHtmlFile(preview.name) && canUseFsRoute();
  const fsUrl = isHtml ? getFsUrl(preview.path) : "";

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
        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-2" />
          Loading...
        </div>
      );
    }

    if (isSvg && svgContent) {
      return (
        <div
          className="flex items-center justify-center h-full p-4 bg-gray-900"
          dangerouslySetInnerHTML={{
            __html: sanitizeSvg(svgContent).replace(/<svg/, '<svg style="max-width: 100%; max-height: 100%;"'),
          }}
        />
      );
    }

    if (preview.isImage && preview.imageUrl) {
      return (
        <div className="flex items-center justify-center h-full p-4 bg-gray-900">
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

    if (preview.content) {
      return <VirtualizedCodeView code={preview.content} filename={preview.name} />;
    }

    return null;
  };

  return (
    <div className="absolute inset-0 z-10 bg-gray-900/95 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-200">{preview.name}</span>
          {preview.size > 0 && (
            <span className="text-xs text-gray-500">{formatSize(preview.size)}</span>
          )}
          {preview.totalLines != null && (
            <span className="text-xs text-gray-500">{preview.totalLines} lines</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isHtml && (
            <button
              onClick={() => setHtmlSourceMode((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                htmlSourceMode
                  ? "text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
              }`}
              title={htmlSourceMode ? "切换到预览" : "切换到源码"}
            >
              {htmlSourceMode ? <Eye className="w-3.5 h-3.5" /> : <Code className="w-3.5 h-3.5" />}
              <span>{htmlSourceMode ? "预览" : "源码"}</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {renderPreview()}
      </div>
    </div>
  );
}
