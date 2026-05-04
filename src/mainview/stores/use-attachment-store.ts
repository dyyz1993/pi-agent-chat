import { create } from "zustand";
import { apiClient } from "../lib/api-client";

export interface AttachmentFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  preview?: string;
  status: "pending" | "uploading" | "done" | "error";
  uploadedPath?: string;
  progress: number;
  error?: string;
}

interface AttachmentState {
  attachments: AttachmentFile[];
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearAll: () => void;
  uploadAll: () => Promise<AttachmentFile[]>;
}

function generateId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isImageType(type: string): boolean {
  return type.startsWith("image/");
}

async function readFileAsDataURL(file: File): Promise<string | undefined> {
  if (!isImageType(file.type)) return undefined;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

export const useAttachmentStore = create<AttachmentState>((set, get) => ({
  attachments: [],

  addFiles: async (files: File[]) => {
    const newAttachments: AttachmentFile[] = [];
    for (const file of files) {
      const preview = await readFileAsDataURL(file);
      newAttachments.push({
        id: generateId(),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        preview,
        status: "pending",
        progress: 0,
      });
    }
    set((s) => ({ attachments: [...s.attachments, ...newAttachments] }));
  },

  removeFile: (id: string) => {
    set((s) => {
      const att = s.attachments.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return { attachments: s.attachments.filter((a) => a.id !== id) };
    });
  },

  clearAll: () => {
    set((s) => {
      for (const att of s.attachments) {
        if (att.preview) URL.revokeObjectURL(att.preview);
      }
      return { attachments: [] };
    });
  },

  uploadAll: async () => {
    const { attachments } = get();
    const pending = attachments.filter((a) => a.status === "pending" || a.status === "error");

    for (const att of pending) {
      set((s) => ({
        attachments: s.attachments.map((a) =>
          a.id === att.id ? { ...a, status: "uploading" as const, progress: 0 } : a,
        ),
      }));

      try {
        const baseUrl = apiClient.getBaseUrl();
        const token = apiClient.getAuthToken();
        const transport = apiClient.getTransport();

        if (transport === "websocket" && baseUrl) {
          const destDir = `/tmp/pi-uploads`;
          const destPath = `${destDir}/${att.id}_${att.name}`;
          const arrayBuffer = await att.file.arrayBuffer();

          const res = await fetch(
            `${baseUrl}/file/upload?path=${encodeURIComponent(destPath)}&token=${token}`,
            { method: "POST", body: arrayBuffer },
          );

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(errBody);
          }

          const result = (await res.json()) as { ok: boolean; path: string; size: number };
          set((s) => ({
            attachments: s.attachments.map((a) =>
              a.id === att.id
                ? { ...a, status: "done" as const, progress: 100, uploadedPath: result.path }
                : a,
            ),
          }));
        } else {
          const destDir = `/tmp/pi-uploads`;
          const destPath = `${destDir}/${att.id}_${att.name}`;
          const arrayBuffer = await att.file.arrayBuffer();
          const { Buffer: BunBuffer } = await import("buffer");
          const buf = BunBuffer.from(arrayBuffer);

          await apiClient.call("file.writeFile" as never, { path: destPath, content: buf.toString("base64") } as never);

          set((s) => ({
            attachments: s.attachments.map((a) =>
              a.id === att.id
                ? { ...a, status: "done" as const, progress: 100, uploadedPath: destPath }
                : a,
            ),
          }));
        }
      } catch (err) {
        set((s) => ({
          attachments: s.attachments.map((a) =>
            a.id === att.id
              ? { ...a, status: "error" as const, error: err instanceof Error ? err.message : String(err) }
              : a,
          ),
        }));
      }
    }

    return get().attachments.filter((a) => a.status === "done");
  },
}));
