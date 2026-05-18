import { memo, useCallback, useMemo, useState, useEffect, useRef } from "react";
import { AlertTriangle, FileText, Maximize2, Columns2, Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentBlock } from "../../../types";
import { getToolIcon } from "../tool-icon-map";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { useExpandStore } from "../../../stores/use-expand-store";
import { CopyButton } from "../CopyButton";
import { CodePreview } from "./CodePreview";
import { InlineDiffViewer } from "./InlineDiffViewer";
import { useSettingsStore } from "../../../stores/use-settings-store";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

interface WriteToolArgs {
  path: string;
  content: string;
}

interface EditToolArgs {
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
}

interface EditToolDetails {
  diff: string;
  firstChangedLine?: number;
}

interface LspDiagnosticIssue {
  severity?: number;
  line: number;
  message: string;
  source?: string;
  code?: string | number;
}

interface LspDiagnosticData {
  files?: Array<{
    filePath: string;
    summary: string;
    issues: LspDiagnosticIssue[];
  }>;
}

function isLspDiagnosticData(d: unknown): d is LspDiagnosticData {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return Array.isArray(obj.files);
}

function isEditToolDetails(d: unknown): d is EditToolDetails {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return typeof obj.diff === "string";
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdc", ".mdx", ".markdown"]);

function isMarkdownFile(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  const lower = path.toLowerCase();
  for (const ext of MARKDOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function extractFileName(path: string): string {
  if (!path || typeof path !== "string") return "";
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep);
  return parts[parts.length - 1] || path;
}

function parseWriteArgs(args: string): WriteToolArgs {
  try {
    const parsed: unknown = JSON.parse(args || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      return {
        path: typeof obj.path === "string" ? obj.path : "",
        content: typeof obj.content === "string" ? obj.content : "",
      };
    }
  } catch {
    /* args not valid JSON */
  }
  return { path: "", content: "" };
}

function parseEditArgs(args: string): EditToolArgs {
  try {
    const parsed: unknown = JSON.parse(args || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const edits = Array.isArray(obj.edits)
        ? (obj.edits.filter(
            (e: unknown) =>
              e &&
              typeof e === "object" &&
              typeof (e as Record<string, unknown>).oldText === "string" &&
              typeof (e as Record<string, unknown>).newText === "string",
          ) as Array<{ oldText: string; newText: string }>)
        : [];
      return {
        path: typeof obj.path === "string" ? obj.path : "",
        edits,
      };
    }
  } catch {
    /* args not valid JSON */
  }
  return { path: "", edits: [] };
}

function parseUnifiedDiff(diff: string): { oldValue: string; newValue: string } | null {
  if (!diff) return null;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }
  return { oldValue: oldLines.join("\n"), newValue: newLines.join("\n") };
}

function isEditTool(block: Block): boolean {
  return block.toolName.toLowerCase() === "edit";
}

export const WriteFileCard = memo(function WriteFileCard({
  block,
  blockId,
}: {
  block: Block;
  blockId?: string;
}) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const isEdit = isEditTool(block);
  const openExpand = useExpandStore((s) => s.openExpand);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("chat");
  const [splitView, setSplitView] = useState(false);

  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  const writeArgs = useMemo(() => parseWriteArgs(block.args), [block.args]);
  const editArgs = useMemo(() => parseEditArgs(block.args), [block.args]);
  const filePath = isEdit ? editArgs.path : writeArgs.path;
  const fileContent = writeArgs.content;

  useEffect(() => {
    if (scrollContainerRef.current && !isRunning && fileContent) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [fileContent, isRunning]);

  const displayPath = filePath || block.args?.slice(0, 80) || "";
  const isMd = isMarkdownFile(filePath);
  const hasContent = (fileContent ?? "").length > 0;

  const lspDetails = isLspDiagnosticData(block.details) ? block.details : null;
  const editDetails = isEdit ? (isEditToolDetails(block.details) ? block.details : null) : null;
  const diffData = useMemo(() => {
    if (!editDetails?.diff) return null;
    return parseUnifiedDiff(editDetails.diff);
  }, [editDetails?.diff]);

  const handleExpand = useCallback(() => {
    if (!fileContent) return;
    const name = extractFileName(filePath);
    const lines = fileContent.length > 0 ? fileContent.split("\n").length : 0;
    openExpand(fileContent, `${name} (${t("common:lineCount", { count: lines })})`);
  }, [filePath, fileContent, openExpand, t]);

  const copyContent = useMemo(() => {
    if (isEdit && editDetails?.diff) return editDetails.diff;
    return fileContent;
  }, [isEdit, editDetails?.diff, fileContent]);

  return (
    <div
      data-block-id={blockId}
      className={`border-x-0 border-t border-b overflow-hidden ${
        isRunning
          ? "border-status-success/25 bg-status-success/5"
          : isError
            ? "border-status-error/15 bg-status-error/5"
            : "border-border-secondary/30 bg-surface-dim"
      }`}
    >
      <div
        className="px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-hover transition-colors select-none"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        aria-expanded={!collapsed}
      >
        {collapsed && isRunning && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-status-info animate-pulse" />
        )}
        {(() => {
          const toolKey = isEditTool(block) ? "edit" : "write";
          const { icon: WriteIcon } = getToolIcon(toolKey);
          return (
            <WriteIcon
              className={`w-3.5 h-3.5 shrink-0 ${isRunning ? "text-status-success" : isError ? "text-status-error" : "text-status-success/70"}`}
            />
          );
        })()}
        <span className="min-w-0 text-text-primary font-mono" title={displayPath}>
          <span className="block truncate rtl" style={{ direction: "rtl", textAlign: "left" }}>
            <span style={{ direction: "ltr", display: "inline" }}>{displayPath}</span>
          </span>
        </span>
        {isMd && hasContent && !isRunning && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleExpand();
            }}
            className="p-0.5 rounded text-text-tertiary hover:text-text-secondary dark:text-text-tertiary dark:hover:text-text-secondary hover:bg-surface-hover/50 transition-colors shrink-0"
            title={t("writeFile.previewMarkdown")}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
        {isRunning && (
          <span className="ml-auto text-[10px] text-status-success animate-pulse shrink-0">
            {t("writeFile.writing")}
          </span>
        )}
        {!isRunning && copyContent && (
          <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
            <CopyButton text={copyContent} />
          </div>
        )}
      </div>

      {collapsed ? null : (
        <>
          {isEdit && !isRunning ? (
            <div className="px-2 pb-2">
              {diffData ? (
                <>
                  <div className="flex items-center gap-1 px-1 pb-1">
                    <button
                      onClick={() => setSplitView(false)}
                      className={`p-1 rounded transition-colors ${!splitView ? "bg-surface-hover text-text-primary" : "text-text-tertiary hover:text-text-primary"}`}
                      title={t("diffLineByLine", { defaultValue: "Line by line" })}
                    >
                      <Rows3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setSplitView(true)}
                      className={`p-1 rounded transition-colors ${splitView ? "bg-surface-hover text-text-primary" : "text-text-tertiary hover:text-text-primary"}`}
                      title={t("diffSideBySide", { defaultValue: "Side by side" })}
                    >
                      <Columns2 className="w-3 h-3" />
                    </button>
                  </div>
                  <InlineDiffViewer
                    oldValue={diffData.oldValue}
                    newValue={diffData.newValue}
                    maxHeight="250px"
                    splitView={splitView}
                  />
                </>
              ) : editArgs.edits.length > 0 ? (
                <div className="px-1">
                  {editArgs.edits.map((edit, i) => (
                    <div key={i} className="mb-1 last:mb-0">
                      <div className="text-[10px] text-status-error/70 font-mono bg-status-error/5 px-2 py-1 rounded-t">
                        - {edit.oldText}
                      </div>
                      <div className="text-[10px] text-status-success/70 font-mono bg-status-success/5 px-2 py-1 rounded-b">
                        + {edit.newText}
                      </div>
                    </div>
                  ))}
                </div>
              ) : block.output ? (
                <pre className="text-[11px] text-text-primary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-surface-code rounded mx-1 px-2 py-1.5">
                  {block.output}
                </pre>
              ) : null}
            </div>
          ) : isMd && hasContent ? (
            <div
              ref={scrollContainerRef}
              className="px-3 pb-2 max-h-40 overflow-y-auto bg-surface-code rounded-sm mx-2 mb-2"
            >
              <div className="px-2 py-2 prose prose-sm prose-gray dark:prose-invert max-w-none overflow-auto prose-p:my-1 prose-pre:bg-surface-hover dark:prose-pre:bg-black/30 prose-pre:rounded prose-pre:px-2 prose-pre:py-1.5 prose-headings:text-text-primary dark:prose-headings:text-text-secondary prose-a:text-semantic-accent prose-code:text-pink-600 dark:prose-code:text-pink-300 prose-code:before:content-[''] prose-code:after:content-[''] prose-code:bg-surface-hover dark:prose-code:bg-surface-dim/60 prose-code:px-1 prose-code:rounded prose-code:text-[11px] prose-strong:text-text-primary dark:prose-strong:text-text-secondary prose-blockquote:border-l-semantic-accent/50 prose-blockquote:text-text-secondary dark:prose-blockquote:text-text-tertiary prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1">
                <CachedReactMarkdown>{fileContent}</CachedReactMarkdown>
              </div>
            </div>
          ) : !isMd && hasContent && !isRunning ? (
            <div className="px-2 pb-2">
              <CodePreview code={fileContent} filename={filePath} maxHeight="250px" />
            </div>
          ) : (
            <div className="px-3 pb-2">
              {block.output ? (
                <pre className="text-[11px] text-text-primary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-surface-code rounded px-2 py-1.5">
                  {block.output}
                </pre>
              ) : isRunning ? (
                <div className="text-[11px] text-text-tertiary italic py-1">
                  {t("writeFile.writingProgress")}
                </div>
              ) : null}
            </div>
          )}

          {lspDetails && lspDetails.files && lspDetails.files.length > 0 && (
            <details className="group border-t border-status-warning/30">
              <summary className="px-3 py-1 text-[11px] text-status-warning cursor-pointer hover:text-status-warning select-none flex items-center gap-1.5">
                <svg
                  className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4.5 3l3 3-3 3" />
                </svg>
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{t("lspDiagnostics")}</span>
                <span className="text-status-warning/80 ml-1">
                  {lspDetails.files.reduce((acc, f) => acc + f.issues.length, 0)} issue
                  {lspDetails.files.reduce((acc, f) => acc + f.issues.length, 0) !== 1 ? "s" : ""}
                </span>
              </summary>
              <div className="px-3 pb-2">
                {lspDetails.files.map((f) => (
                  <div
                    key={f.filePath}
                    className="border-b last:border-b-0 border-status-warning/20 py-1"
                  >
                    <div className="text-[11px] text-status-warning font-medium flex items-center gap-1">
                      <FileText className="w-2.5 h-2.5 shrink-0" />
                      <span>{f.filePath}</span>
                      <span className="text-status-warning/80 ml-1">{f.summary}</span>
                    </div>
                    {f.issues.map((issue, i) => (
                      <div key={i} className="text-[11px] text-text-secondary pl-4 pt-0.5">
                        <span
                          className={
                            issue.severity === 1
                              ? "text-status-error"
                              : issue.severity === 2
                                ? "text-status-warning"
                                : "text-text-tertiary"
                          }
                        >
                          L{issue.line}
                        </span>
                        {issue.source && (
                          <span className="text-text-tertiary"> [{issue.source}]</span>
                        )}
                        {issue.code != null && (
                          <span className="text-text-tertiary"> ({String(issue.code)})</span>
                        )}
                        : {issue.message}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
});
