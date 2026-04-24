export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
};

export type DemoMethod = "system.ping" | "system.hello" | "system.echo" | "chat.send";

export type FilePreview = {
  path: string;
  name: string;
  content: string | null;
  imageUrl: string | null;
  mimeType: string;
  size: number;
  isText: boolean;
  isImage: boolean;
  totalLines?: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type EditingType = "rename" | "newFile" | "newDir";
export type EditingNode = { path: string; type: EditingType };
