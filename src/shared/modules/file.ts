/**
 * File 模块 — 文件系统操作
 */
export interface FileMethods {
  "file.findProjectRoot": {
    params: Record<string, never>;
    result: { path: string };
  };
  "file.listDir": {
    params: { path: string };
    result: {
      entries: { name: string; path: string; type: "file" | "directory"; size?: number }[];
      basePath: string;
    };
  };
  "file.createFile": {
    params: { dirPath: string; name: string };
    result: { path: string };
  };
  "file.createDir": {
    params: { dirPath: string; name: string };
    result: { path: string };
  };
  "file.rename": {
    params: { oldPath: string; newName: string };
    result: { newPath: string };
  };
  "file.delete": {
    params: { path: string };
    result: { ok: boolean };
  };
  "file.copy": {
    params: { srcPath: string; destDir: string };
    result: { path: string };
  };
  "file.readFile": {
    params: { path: string };
    result: { content: string; size: number };
  };
}
