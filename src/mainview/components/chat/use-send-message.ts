import { useCallback } from "react";
import type { ImageContent } from "@dyyz1993/pi-ai";
import { useAttachmentStore } from "../../stores/use-attachment-store";
import { useChatStore } from "../../stores/use-chat-store";
import {
  composeInputWithPlaceholders,
  persistComposerPlaceholders,
  useComposerPlaceholderStore,
} from "../../stores/use-composer-placeholder-store";
import { useSessionStore } from "../../stores/use-session-store";
import { isVisionModel } from "../../lib/vision-detection";
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

      // Determine if the current model supports vision. When it does NOT,
      // images are later stripped by pi-ai's transformMessages and replaced
      // with "(image omitted: model does not support images)". To keep the
      // image accessible to the agent (via `read` or MCP vision tools like
      // `analyze_image`), we also upload each image to /tmp/pi-uploads/ and
      // append an @path reference to the message text — mirroring how
      // non-image file attachments already work.
      const sessionStore = useSessionStore.getState();
      const { currentModel, availableModels } = sessionStore;
      const supportsVision = currentModel
        ? isVisionModel(
            availableModels.find(
              (m) => m.provider === currentModel.provider && m.id === currentModel.id,
            ) ?? {},
          )
        : false;

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

      // Upload all file attachments (non-images) to disk as before.
      let filePaths: string[] = [];
      if (fileAttachments.length > 0) {
        attachmentStore.clearAll();
        for (const att of fileAttachments) {
          useAttachmentStore.getState().addFiles([att.file]);
        }
        const uploaded = await useAttachmentStore.getState().uploadAll();
        filePaths = uploaded.map((a) => a.uploadedPath).filter(Boolean) as string[];
      }

      // When the model lacks vision, also upload images to disk so we can
      // append recoverable @path references. For vision models this is
      // skipped — the ImageContent blocks are sent inline and no redundant
      // @path is added.
      if (!supportsVision && imageAttachments.length > 0) {
        attachmentStore.clearAll();
        for (const att of imageAttachments) {
          useAttachmentStore.getState().addFiles([att.file]);
        }
        const uploadedImages = await useAttachmentStore.getState().uploadAll();
        const imagePaths = uploadedImages
          .map((a) => a.uploadedPath)
          .filter(Boolean) as string[];
        filePaths = [...filePaths, ...imagePaths];
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
