import { useCallback, useState } from "react";
import { useAttachmentStore } from "../../stores/use-attachment-store";

export interface AttachmentDropApi {
  isDragOver: boolean;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
}

function extractFilesFromDataTransfer(items: DataTransferItemList | undefined): File[] {
  const files: File[] = [];
  if (!items) return files;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

/**
 * Encapsulates the four file-paste / drag-and-drop event handlers attached
 * to the ChatPanel composer container, plus the isDragOver visual state.
 *
 * Pulled out as part of the ChatPanel decomposition.
 */
export function useAttachmentDrop(): AttachmentDropApi {
  const [isDragOver, setIsDragOver] = useState(false);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    const files = extractFilesFromDataTransfer(items);
    const clipboardFiles = Array.from(e.clipboardData?.files ?? []);
    for (const file of clipboardFiles) {
      if (!files.some((existing) => existing.name === file.name && existing.size === file.size)) {
        files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      useAttachmentStore.getState().addFiles(files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = extractFilesFromDataTransfer(e.dataTransfer?.items);
    if (files.length > 0) {
      useAttachmentStore.getState().addFiles(files);
    }
  }, []);

  return {
    isDragOver,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
