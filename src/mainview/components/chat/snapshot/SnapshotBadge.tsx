import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FilePlus, FileEdit, FileX, Camera } from "lucide-react";

interface SnapshotDiff {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface SnapshotData {
  diff?: SnapshotDiff | null;
  baselineTreeHash?: string | null;
  snapshotTreeHash?: string;
  turnIndex?: number;
}

interface SnapshotBadgeProps {
  data: unknown;
  blockId: string;
}

export const SnapshotBadge = memo(function SnapshotBadge({ data, blockId }: SnapshotBadgeProps) {
  const { t } = useTranslation("snapshot");
  const [expanded, setExpanded] = useState(false);

  const d = data as SnapshotData | undefined;
  const diff = d?.diff;
  const addedCount = diff?.added?.length ?? 0;
  const modifiedCount = diff?.modified?.length ?? 0;
  const deletedCount = diff?.deleted?.length ?? 0;
  const totalCount = addedCount + modifiedCount + deletedCount;

  if (totalCount === 0) return null;

  return (
    <div className="my-0.5" data-block-id={blockId}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1 flex items-center gap-1.5 text-[11px] text-semantic-accent/80 hover:bg-gray-200/15 dark:hover:bg-gray-800/15 rounded cursor-pointer select-none"
        aria-expanded={expanded}
      >
        <Camera className="w-3 h-3 shrink-0" />
        <span className="font-medium">{t("fileChanges")}</span>
        <span className="flex items-center gap-1 text-[10px]">
          {addedCount > 0 && (
            <span className="text-status-success flex items-center gap-0.5">
              <FilePlus className="w-2.5 h-2.5" />
              {addedCount}
            </span>
          )}
          {modifiedCount > 0 && (
            <span className="text-status-warning flex items-center gap-0.5">
              <FileEdit className="w-2.5 h-2.5" />
              {modifiedCount}
            </span>
          )}
          {deletedCount > 0 && (
            <span className="text-status-error flex items-center gap-0.5">
              <FileX className="w-2.5 h-2.5" />
              {deletedCount}
            </span>
          )}
        </span>
        <span className="ml-auto text-gray-400 dark:text-gray-600">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && diff && <SnapshotExpandPanel diff={diff} />}
    </div>
  );
});

interface SnapshotExpandPanelProps {
  diff: SnapshotDiff;
}

const SnapshotExpandPanel = memo(function SnapshotExpandPanel({ diff }: SnapshotExpandPanelProps) {
  const allFiles = [
    ...diff.added.map((f) => ({ path: f, status: "added" as const })),
    ...diff.modified.map((f) => ({ path: f, status: "modified" as const })),
    ...diff.deleted.map((f) => ({ path: f, status: "deleted" as const })),
  ];

  return (
    <div className="px-3 pb-2 text-[11px] space-y-0.5">
      {allFiles.map((file) => {
        const statusConfig = {
          added: { icon: FilePlus, color: "text-status-success" },
          modified: { icon: FileEdit, color: "text-status-warning" },
          deleted: { icon: FileX, color: "text-status-error" },
        }[file.status];
        const StatusIcon = statusConfig.icon;

        return (
          <div
            key={file.path}
            className="flex items-center gap-1.5 py-0.5 text-gray-400 dark:text-gray-500 hover:text-gray-300 transition-colors"
          >
            <StatusIcon className={`w-3 h-3 shrink-0 ${statusConfig.color}`} />
            <span className="truncate" title={file.path}>
              {file.path}
            </span>
          </div>
        );
      })}
    </div>
  );
});
