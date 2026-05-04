import { useRef, useCallback } from "react";
import { Paperclip, ImageIcon, X, Loader2, AlertCircle } from "lucide-react";
import { useAttachmentStore, type AttachmentFile } from "../../stores/use-attachment-store";
import { formatFileSize } from "../chat/preview/types";

function AttachmentPreview({ att, onRemove }: { att: AttachmentFile; onRemove: () => void }) {
  const isImage = att.type.startsWith("image/");

  return (
    <div className="group relative flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800 border border-gray-700/50 max-w-[200px]">
      {att.status === "uploading" && (
        <Loader2 className="w-3 h-3 text-indigo-400 animate-spin shrink-0" />
      )}
      {att.status === "error" && (
        <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
      )}
      {att.status === "done" && (
        <div className="w-3 h-3 rounded-full bg-green-500/80 shrink-0" />
      )}
      {att.status === "pending" && (
        <div className="w-3 h-3 rounded-full bg-gray-600 shrink-0" />
      )}

      {isImage && att.preview ? (
        <img src={att.preview} alt={att.name} className="w-6 h-6 rounded object-cover shrink-0" />
      ) : (
        <Paperclip className="w-3 h-3 text-gray-400 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-gray-300 truncate">{att.name}</div>
        <div className="text-[9px] text-gray-500">{formatFileSize(att.size)}</div>
      </div>

      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-all shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function AttachmentBar() {
  const attachments = useAttachmentStore((s) => s.attachments);
  const removeFile = useAttachmentStore((s) => s.removeFile);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-1 pb-1">
      {attachments.map((att) => (
        <AttachmentPreview key={att.id} att={att} onRemove={() => removeFile(att.id)} />
      ))}
    </div>
  );
}

export function AttachmentButtons() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addFiles = useAttachmentStore((s) => s.addFiles);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        addFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [addFiles],
  );

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        addFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [addFiles],
  );

  return (
    <div className="flex flex-col gap-1 shrink-0 justify-between py-1">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="p-1.5 rounded-md hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
        title="添加附件"
      >
        <Paperclip className="w-4 h-4" />
      </button>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />
      <button
        onClick={() => imageInputRef.current?.click()}
        className="p-1.5 rounded-md hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
        title="添加图片"
      >
        <ImageIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
