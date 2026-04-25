import { memo, useState } from "react";
import { Globe, ExternalLink } from "lucide-react";
import type { PreviewDetails } from "./types";

export const UrlCard = memo(function UrlCard({ details }: { details: PreviewDetails }) {
  const [showIframe, setShowIframe] = useState(false);
  const src = details.absolutePath ?? details.source;

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? src}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-blue-400 hover:text-blue-300 shrink-0"
          title="Open in new tab"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      {showIframe ? (
        <iframe
          src={src}
          className="w-full border-0"
          style={{ minHeight: 300, maxHeight: 600 }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title={details.title ?? src}
        />
      ) : (
        <button
          onClick={() => setShowIframe(true)}
          className="w-full px-3 py-8 flex flex-col items-center gap-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
        >
          <Globe className="w-6 h-6 text-blue-400/60" />
          <span>Click to load preview</span>
          <span className="text-gray-600 font-mono text-[10px]">{src}</span>
        </button>
      )}
    </div>
  );
});
