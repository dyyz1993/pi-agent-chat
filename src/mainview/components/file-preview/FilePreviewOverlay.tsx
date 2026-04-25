import { FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FilePreview } from "../../types";
import { formatSize } from "../../utils/file-utils";
import { VirtualizedCodeView } from "./VirtualizedCodeView";

interface FilePreviewOverlayProps {
  preview: FilePreview;
  loading: boolean;
  onClose: () => void;
}

// Check if file is SVG
function isSvgFile(filename: string): boolean {
  return filename.toLowerCase().endsWith(".svg");
}

export function FilePreviewOverlay({ preview, loading, onClose }: FilePreviewOverlayProps) {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);

  const isSvg = isSvgFile(preview.name);

  // Fetch SVG content for inline rendering
  useEffect(() => {
    if (isSvg && preview.imageUrl && !svgContent) {
      setSvgLoading(true);
      fetch(preview.imageUrl)
        .then((res) => res.text())
        .then((text) => {
          setSvgContent(text);
        })
        .catch(() => {
          // Fallback to <img> if fetch fails
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

    // SVG: render inline for better compatibility
    if (isSvg && svgContent) {
      return (
        <div
          className="flex items-center justify-center h-full p-4 bg-[#1a1a2e]"
          dangerouslySetInnerHTML={{
            __html: svgContent.replace(/<svg/, '<svg style="max-width: 100%; max-height: 100%;"'),
          }}
        />
      );
    }

    // Other images: use <img> tag
    if (preview.isImage && preview.imageUrl) {
      return (
        <div className="flex items-center justify-center h-full p-4 bg-[#1a1a2e]">
          <img
            src={preview.imageUrl}
            alt={preview.name}
            className="max-w-full max-h-full object-contain rounded"
          />
        </div>
      );
    }

    // Text files
    if (preview.content) {
      return <VirtualizedCodeView code={preview.content} filename={preview.name} />;
    }

    return null;
  };

  return (
    <div className="absolute inset-0 z-10 bg-gray-900/95 flex flex-col overflow-hidden">
      {/* File header with close button */}
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
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* File content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {renderPreview()}
      </div>
    </div>
  );
}
