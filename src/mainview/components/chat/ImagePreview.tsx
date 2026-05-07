import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut } from 'lucide-react';

interface ImagePreviewProps {
  src: string;
  name?: string;
  onClose: () => void;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ src, name, onClose }) => {
  const [scale, setScale] = useState(1);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10">
        <span className="text-white text-sm truncate max-w-[60%]">{name}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setScale(s => Math.max(0.5, s - 0.5)); }}
            className="text-white/70 hover:text-white p-2"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setScale(s => Math.min(3, s + 0.5)); }}
            className="text-white/70 hover:text-white p-2"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-white/70 hover:text-white p-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <img
        src={src}
        alt={name}
        className="max-w-full max-h-full object-contain transition-transform duration-200"
        style={{ transform: `scale(${scale})` }}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>,
    document.body
  );
};
