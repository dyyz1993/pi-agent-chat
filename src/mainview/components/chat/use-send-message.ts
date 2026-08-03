import { useCallback } from "react";
import type { ImageContent } from "@dyyz1993/pi-ai";
import { useAttachmentStore } from "../../stores/use-attachment-store";
import { useChatStore } from "../../stores/use-chat-store";
import {
  composeInputWithPlaceholders,
  persistComposerPlaceholders,
  useComposerPlaceholderStore,
} from "../../stores/use-composer-placeholder-store";
import { apiClient } from "../../lib/api-client";
import type { InputBarHandle } from "./InputBar";

export interface UseSendMessageDeps {
  inputText: string;
  attachmentCount: number;
  hasComposerPlaceholders: boolean;
  isStreaming: boolean;
  isMobileOrTablet: boolean;
  sendMessage: () => Promise<void>;
  sendSteer: () => Promise<void>;
  resumeAutoScroll: () => void;
  inputBarRef: React.RefObject<InputBarHandle | null>;
}

function mimeTypeForExtension(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

/**
 * Encapsulates handleSend — the user-facing "send message" action that
 * also flattens attachments (image base64 + file path refs) and composer
 * placeholders into the outgoing message before invoking sendMessage or
 * sendSteer.
 *
 * Pulled out as part of the ChatPanel decomposition.
 */
export function useSendMessage(deps: UseSendMessageDeps) {
  const handleSend = useCallback(async () => {
    if (!deps.inputText.trim() && deps.attachmentCount === 0 && !deps.hasComposerPlaceholders) {
      return;
    }

    const attachmentStore = useAttachmentStore.getState();
    const hasAttachments = attachmentStore.attachments.length > 0;

    if (hasAttachments) {
      const attachments = attachmentStore.attachments;
      const imageAttachments = attachments.filter((a) => a.type.startsWith("image/"));
      const fileAttachments = attachments.filter((a) => !a.type.startsWith("image/"));

      const images: ImageContent[] = [];
      for (const att of imageAttachments) {
        try {
          const arrayBuffer = await att.file.arrayBuffer();
          const { Buffer: BunBuffer } = await import("buffer");
          const base64 = BunBuffer.from(arrayBuffer).toString("base64");
          images.push({ type: "image", data: base64, mimeType: mimeTypeForExtension(att.name) });
        } catch {
          fileAttachments.push(att);
        }
      }

      let filePaths: string[] = [];
      if (fileAttachments.length > 0) {
        attachmentStore.clearAll();
        for (const att of fileAttachments) {
          useAttachmentStore.getState().addFiles([att.file]);
        }
        const uploaded = await useAttachmentStore.getState().uploadAll();
        filePaths = uploaded.map((a) => a.uploadedPath).filter(Boolean) as string[];
      }

      attachmentStore.clearAll();

      if (images.length > 0) {
        useChatStore.getState().setPendingImages(images);
      }

      if (filePaths.length > 0) {
        const fileRefs = filePaths.map((p) => `@${p}`).join(" ");
        const currentText = useChatStore.getState().inputText;
        const text = currentText.trim() ? `${currentText.trim()}\n${fileRefs}` : fileRefs;
        useChatStore.getState().setInputText(text);
      }
    }

    const placeholders = useComposerPlaceholderStore.getState().placeholders;
    if (placeholders.length > 0) {
      await persistComposerPlaceholders(placeholders, (path, content) =>
        apiClient.call("file.writeFile", { path, content }),
      );
      const currentText = useChatStore.getState().inputText;
      useChatStore.getState().setInputText(composeInputWithPlaceholders(currentText, placeholders));
    }

    if (deps.isStreaming) {
      await deps.sendSteer();
    } else {
      await deps.sendMessage();
    }
    if (placeholders.length > 0) {
      useComposerPlaceholderStore.getState().clearPlaceholders();
    }
    deps.resumeAutoScroll();
    if (deps.isMobileOrTablet) {
      deps.inputBarRef.current?.blur();
    }
  }, [deps]);

  return handleSend;
}
