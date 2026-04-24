import { apiClient } from "../lib/api-client";

export interface DropEntry {
  name: string;
  relativePath: string;
  file?: File;
  isDirectory: boolean;
  children?: DropEntry[];
}

/**
 * 递归读取 webkitGetAsEntry，返回扁平文件列表 + 目录结构
 */
function readEntry(
  entry: FileSystemEntry,
  path: string,
): Promise<DropEntry> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file((file) => {
        resolve({ name: entry.name, relativePath: path, file, isDirectory: false });
      });
    });
  }
  // Directory
  return new Promise((resolve) => {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: DropEntry[] = [];

    const readBatch = () => {
      reader.readEntries(async (entries) => {
        if (entries.length === 0) {
          resolve({ name: entry.name, relativePath: path, isDirectory: true, children });
          return;
        }
        for (const e of entries) {
          children.push(await readEntry(e, `${path}/${e.name}`));
        }
        readBatch(); // readEntries may not return all entries in one call
      });
    };
    readBatch();
  });
}

/**
 * 从 DataTransfer 递归读取所有文件和目录
 */
export async function readDropItems(dataTransfer: DataTransfer): Promise<DropEntry[]> {
  const items = dataTransfer.items;
  if (!items) return [];

  const entries: DropEntry[] = [];
  const tasks: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Try webkitGetAsEntry (Chrome, Edge, Safari)
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      tasks.push(
        readEntry(entry, entry.name).then<void>((e) => { entries.push(e); }),
      );
    }
  }

  await Promise.all(tasks);
  return entries;
}

/**
 * Web 端：递归上传 entries 到目标目录
 */
export async function uploadEntriesWeb(entries: DropEntry[], destDir: string): Promise<number> {
  let count = 0;

  async function process(entry: DropEntry, currentDir: string): Promise<void> {
    if (entry.isDirectory) {
      // Create directory
      const dirPath = `${currentDir}/${entry.name}`;
      await apiClient.call("file.createDir", { dirPath: currentDir, name: entry.name });
      count++;
      if (entry.children) {
        for (const child of entry.children) {
          await process(child, dirPath);
        }
      }
    } else if (entry.file) {
      // Upload file via HTTP
      const filePath = `${currentDir}/${entry.name}`;
      const arrayBuffer = await entry.file.arrayBuffer();
      const baseUrl = apiClient.getBaseUrl();
      const token = apiClient.getAuthToken();
      const res = await fetch(
        `${baseUrl}/file/upload?path=${encodeURIComponent(filePath)}&token=${token}`,
        { method: "POST", body: arrayBuffer },
      );
      if (!res.ok) throw new Error(`Upload failed: ${entry.name}`);
      count++;
    }
  }

  for (const entry of entries) {
    await process(entry, destDir);
  }
  return count;
}

/**
 * 桌面端：通过 RPC file.copy 直接复制
 */
export async function importFilesDesktop(entries: DropEntry[], destDir: string): Promise<number> {
  let count = 0;

  async function process(entry: DropEntry, currentDir: string): Promise<void> {
    if (entry.isDirectory) {
      const dirPath = `${currentDir}/${entry.name}`;
      await apiClient.call("file.createDir", { dirPath: currentDir, name: entry.name });
      count++;
      if (entry.children) {
        for (const child of entry.children) {
          await process(child, dirPath);
        }
      }
    } else if (entry.file) {
      // Desktop: File object has .path property (Electron/Electrobun)
      const srcPath = (entry.file as File & { path?: string }).path;
      if (srcPath) {
        await apiClient.call("file.copy", { srcPath, destDir: currentDir });
      } else {
        // Fallback: no path available, upload via HTTP
        const filePath = `${currentDir}/${entry.name}`;
        const arrayBuffer = await entry.file.arrayBuffer();
        const baseUrl = apiClient.getBaseUrl();
        const token = apiClient.getAuthToken();
        const res = await fetch(
          `${baseUrl}/file/upload?path=${encodeURIComponent(filePath)}&token=${token}`,
          { method: "POST", body: arrayBuffer },
        );
        if (!res.ok) throw new Error(`Upload failed: ${entry.name}`);
      }
      count++;
    }
  }

  for (const entry of entries) {
    await process(entry, destDir);
  }
  return count;
}
