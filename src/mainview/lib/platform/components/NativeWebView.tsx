import React, { useRef, useState } from 'react';
import { platformBridge } from '../bridge';
import { isNative } from '../index';

interface NativeWebViewProps {
  src: string;
  title?: string;
  sandbox?: string;
  className?: string;
  style?: React.CSSProperties;
  key?: number;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

export const NativeWebView: React.FC<NativeWebViewProps> = ({
  src,
  title,
  sandbox,
  className,
  style,
  onLoad,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  if (!isNative()) {
    return (
      <iframe
        src={src}
        title={title}
        sandbox={sandbox}
        className={className}
        style={style}
        onLoad={onLoad}
        onError={() => onError?.(new Error('iframe load failed'))}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-indigo-500 border-t-transparent" />
        </div>
      )}

      <button
        onClick={() => {
          platformBridge.webview.openInNewWindow({ src, title: title || 'Preview' });
        }}
        className="absolute top-2 right-2 z-50 bg-black/60 hover:bg-black/80 text-white p-1.5 rounded-lg backdrop-blur-sm transition-colors"
        title="在新窗口打开"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </button>

      <iframe
        src={src}
        title={title}
        sandbox={sandbox}
        className="w-full h-full border-0"
        onLoad={() => {
          setLoading(false);
          onLoad?.();
        }}
        onError={() => {
          setLoading(false);
          onError?.(new Error('WebView load failed'));
        }}
      />
    </div>
  );
};
