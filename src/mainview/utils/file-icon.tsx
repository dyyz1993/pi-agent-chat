import {
  BookOpenText,
  BookText,
  Bot,
  Braces,
  CodeXml,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileDiff,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderArchive,
  FolderCode,
  FolderCog,
  FolderGit,
  FolderKanban,
  FolderLock,
  FolderOpen,
  FolderOpenDot,
  FolderSearch,
  FolderUp,
  Globe,
  Images,
  Package,
  Palette,
  Shield,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { TreeNode } from "../types";

type IconSpec = {
  icon: LucideIcon;
  color: string;
};

const ICON_CLASS = "w-4 h-4 shrink-0";
const FOLDER_COLOR = "text-status-warning";
const DEFAULT_FILE_COLOR = "text-text-tertiary";

const SPECIAL_FOLDERS: Record<string, IconSpec> = {
  ".git": { icon: FolderGit, color: "text-semantic-tool" },
  ".github": { icon: FolderGit, color: "text-semantic-tool" },
  ".ion": { icon: FolderCog, color: "text-semantic-accent" },
  ".pi": { icon: FolderCog, color: "text-semantic-accent" },
  ".uploads": { icon: FolderUp, color: "text-status-info" },
  assets: { icon: Images, color: "text-status-success" },
  build: { icon: FolderArchive, color: "text-semantic-notify" },
  components: { icon: FolderCode, color: "text-status-info" },
  dashboard: { icon: FolderKanban, color: "text-semantic-agent" },
  dist: { icon: FolderArchive, color: "text-semantic-notify" },
  docs: { icon: BookOpenText, color: "text-status-info" },
  node_modules: { icon: Package, color: "text-text-tertiary" },
  pages: { icon: Globe, color: "text-status-info" },
  permission: { icon: FolderLock, color: "text-status-warning" },
  public: { icon: Globe, color: "text-status-success" },
  scripts: { icon: FileTerminal, color: "text-status-success" },
  src: { icon: FolderCode, color: "text-status-info" },
  target: { icon: FolderArchive, color: "text-semantic-notify" },
  test: { icon: FolderSearch, color: "text-status-success" },
  tests: { icon: FolderSearch, color: "text-status-success" },
};

const SPECIAL_FILES: Record<string, IconSpec> = {
  ".dockerignore": { icon: FileCog, color: "text-status-info" },
  ".ds_store": { icon: FileCog, color: "text-text-tertiary" },
  ".env": { icon: FileKey, color: "text-status-warning" },
  ".env.example": { icon: FileKey, color: "text-status-warning" },
  ".gitignore": { icon: FolderGit, color: "text-text-tertiary" },
  "agents.md": { icon: Bot, color: "text-semantic-agent" },
  "bun.lock": { icon: FileLock, color: "text-semantic-notify" },
  "cargo.lock": { icon: FileLock, color: "text-semantic-notify" },
  "cargo.toml": { icon: Package, color: "text-semantic-notify" },
  dockerfile: { icon: Package, color: "text-status-info" },
  makefile: { icon: Wrench, color: "text-status-success" },
  "package.json": { icon: Package, color: "text-status-success" },
  "package-lock.json": { icon: FileLock, color: "text-semantic-notify" },
  "pnpm-lock.yaml": { icon: FileLock, color: "text-semantic-notify" },
  "readme.md": { icon: BookOpenText, color: "text-status-info" },
  "security.md": { icon: Shield, color: "text-status-warning" },
  "tsconfig.json": { icon: FileCog, color: "text-status-info" },
  "vite.config.js": { icon: FileCog, color: "text-status-warning" },
  "vite.config.ts": { icon: FileCog, color: "text-status-warning" },
  "yarn.lock": { icon: FileLock, color: "text-semantic-notify" },
};

const EXTENSION_ICONS: Record<string, IconSpec> = {
  "7z": { icon: FileArchive, color: "text-semantic-notify" },
  ai: { icon: Palette, color: "text-semantic-notify" },
  avi: { icon: FileVideo, color: "text-status-error" },
  bash: { icon: FileTerminal, color: "text-status-success" },
  bmp: { icon: FileImage, color: "text-status-success" },
  bz2: { icon: FileArchive, color: "text-semantic-notify" },
  c: { icon: FileCode, color: "text-status-info" },
  cc: { icon: FileCode, color: "text-status-info" },
  conf: { icon: FileCog, color: "text-status-info" },
  cpp: { icon: FileCode, color: "text-status-info" },
  cs: { icon: FileCode, color: "text-status-info" },
  css: { icon: Palette, color: "text-semantic-accent" },
  csv: { icon: FileSpreadsheet, color: "text-status-success" },
  diff: { icon: FileDiff, color: "text-semantic-notify" },
  gif: { icon: FileImage, color: "text-status-success" },
  go: { icon: FileCode, color: "text-status-info" },
  gz: { icon: FileArchive, color: "text-semantic-notify" },
  h: { icon: FileCode, color: "text-status-info" },
  htm: { icon: CodeXml, color: "text-status-error" },
  html: { icon: CodeXml, color: "text-status-error" },
  jpeg: { icon: FileImage, color: "text-status-success" },
  jpg: { icon: FileImage, color: "text-status-success" },
  js: { icon: FileCode, color: "text-status-warning" },
  json: { icon: FileJson, color: "text-status-warning" },
  jsonc: { icon: FileJson, color: "text-status-warning" },
  jsx: { icon: FileCode, color: "text-status-info" },
  key: { icon: FileKey, color: "text-status-warning" },
  lock: { icon: FileLock, color: "text-semantic-notify" },
  log: { icon: FileText, color: "text-text-tertiary" },
  m4a: { icon: FileAudio, color: "text-status-info" },
  md: { icon: BookText, color: "text-status-info" },
  mov: { icon: FileVideo, color: "text-status-error" },
  mp3: { icon: FileAudio, color: "text-status-info" },
  mp4: { icon: FileVideo, color: "text-status-error" },
  patch: { icon: FileDiff, color: "text-semantic-notify" },
  pdf: { icon: FileText, color: "text-status-error" },
  pem: { icon: FileKey, color: "text-status-warning" },
  png: { icon: FileImage, color: "text-status-success" },
  py: { icon: FileCode, color: "text-status-info" },
  rar: { icon: FileArchive, color: "text-semantic-notify" },
  rb: { icon: FileCode, color: "text-status-error" },
  rs: { icon: FileCode, color: "text-semantic-notify" },
  sass: { icon: Palette, color: "text-semantic-accent" },
  scss: { icon: Palette, color: "text-semantic-accent" },
  sh: { icon: FileTerminal, color: "text-status-success" },
  sql: { icon: Database, color: "text-status-info" },
  svg: { icon: FileImage, color: "text-status-success" },
  tar: { icon: FileArchive, color: "text-semantic-notify" },
  toml: { icon: FileCog, color: "text-semantic-notify" },
  ts: { icon: FileCode, color: "text-status-info" },
  tsx: { icon: FileCode, color: "text-status-info" },
  txt: { icon: FileType, color: DEFAULT_FILE_COLOR },
  webp: { icon: FileImage, color: "text-status-success" },
  xml: { icon: CodeXml, color: "text-status-error" },
  yaml: { icon: Braces, color: "text-status-info" },
  yml: { icon: Braces, color: "text-status-info" },
  zip: { icon: FileArchive, color: "text-semantic-notify" },
};

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function extensionOf(name: string): string {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return "";
  return name.slice(lastDot + 1).toLowerCase();
}

function renderIcon({ icon: Icon, color }: IconSpec) {
  return <Icon className={`${ICON_CLASS} ${color}`} />;
}

export function getFileIcon(node: TreeNode) {
  const name = basename(node.name || node.path);
  const normalizedName = name.toLowerCase();

  if (node.type === "directory") {
    const specialFolder = SPECIAL_FOLDERS[normalizedName];
    if (specialFolder) return renderIcon(specialFolder);

    const Icon = node.expanded ? FolderOpen : Folder;
    const dottedColor = normalizedName.startsWith(".") ? "text-text-tertiary" : FOLDER_COLOR;
    return <Icon className={`${ICON_CLASS} ${dottedColor}`} />;
  }

  const specialFile = SPECIAL_FILES[normalizedName];
  if (specialFile) return renderIcon(specialFile);

  const ext = extensionOf(normalizedName);
  const extensionIcon = EXTENSION_ICONS[ext];
  if (extensionIcon) return renderIcon(extensionIcon);

  if (normalizedName.startsWith(".")) {
    return <FolderOpenDot className={`${ICON_CLASS} text-text-tertiary`} />;
  }

  return <File className={`${ICON_CLASS} ${DEFAULT_FILE_COLOR}`} />;
}
