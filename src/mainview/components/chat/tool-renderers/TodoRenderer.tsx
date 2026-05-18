import { memo, useState, useEffect, useRef } from "react";
import { CheckSquare, Square, TriangleAlert, Zap, Activity } from "lucide-react";
import type { ToolRendererProps } from "./registry";
import { getToolIcon } from "../tool-icon-map";
import { useSettingsStore } from "../../../stores/use-settings-store";

interface TodoItem {
  id: number;
  text: string;
  done: boolean;
  priority?: string;
  deleted?: boolean;
}

interface TodoDetails {
  action: string;
  todos?: TodoItem[];
  nextId?: number;
  totalActive?: number;
  added?: TodoItem[];
  modified?: TodoItem[];
  deleted?: TodoItem[];
  active?: TodoItem[];
  error?: string;
}

function isTodoDetails(d: unknown): d is TodoDetails {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return typeof obj.action === "string";
}

function getPriorityIcon(priority: string | undefined) {
  switch (priority) {
    case "high":
      return <TriangleAlert className="w-3 h-3 shrink-0 text-status-error" />;
    case "medium":
      return <Zap className="w-3 h-3 shrink-0 text-status-warning" />;
    case "low":
      return <Activity className="w-3 h-3 shrink-0 text-text-tertiary" />;
    default:
      return null;
  }
}

function ActionSummary({ details }: { details: TodoDetails }) {
  switch (details.action) {
    case "list": {
      const count = details.totalActive ?? details.active?.length ?? 0;
      return (
        <span className="text-text-tertiary font-normal">
          {count > 0 ? `${count} 个任务` : "暂无待办事项"}
        </span>
      );
    }
    case "add": {
      const added = details.added ?? [];
      if (added.length === 0) return <span className="text-text-tertiary">添加失败</span>;
      if (added.length === 1)
        return (
          <span className="text-status-success">
            ✓ #{added[0].id}: {added[0].text}
          </span>
        );
      return <span className="text-status-success">✓ 添加 {added.length} 个任务</span>;
    }
    case "toggle": {
      const todo = details.todos?.find((t) => t.id !== undefined);
      if (!todo) return <span className="text-text-tertiary">切换状态</span>;
      return (
        <span className={todo.done ? "text-text-tertiary" : "text-status-info"}>
          {todo.done ? `☑ #${todo.id} 已完成` : `☐ #${todo.id} 未完成`}
        </span>
      );
    }
    case "remove": {
      const count = (details.deleted ?? []).length;
      return count > 0 ? (
        <span className="text-text-tertiary">🗑 删除 {count} 个任务</span>
      ) : (
        <span className="text-text-tertiary">删除操作</span>
      );
    }
    case "clear": {
      return <span className="text-text-tertiary">🗑 已清空</span>;
    }
    default:
      return <span className="text-text-tertiary">{details.action}</span>;
  }
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  const active = todos.filter((t) => !t.deleted);
  // Deduplicate by text (backend may return duplicates from repeated add calls)
  const seen = new Set<string>();
  const unique = active.filter((t) => {
    if (seen.has(t.text)) return false;
    seen.add(t.text);
    return true;
  });

  if (unique.length === 0) {
    return <div className="text-[11px] text-text-tertiary italic py-1">暂无待办事项</div>;
  }

  return (
    <div className="space-y-0.5 py-0.5">
      {unique.map((todo) => (
        <div
          key={todo.id}
          className="flex items-center gap-2 py-0.5 px-1 rounded-sm hover:bg-surface-dim transition-colors"
        >
          {/* Status */}
          <span className="shrink-0">
            {todo.done ? (
              <CheckSquare className="w-3.5 h-3.5 text-text-tertiary" />
            ) : (
              <Square className="w-3.5 h-3.5 text-text-secondary" />
            )}
          </span>

          {/* Text */}
          <span
            className={`flex-1 min-w-0 text-[11px] truncate ${
              todo.done ? "line-through text-text-tertiary" : "text-text-primary"
            }`}
          >
            {todo.text}
          </span>

          {/* Priority */}
          {getPriorityIcon(todo.priority)}
        </div>
      ))}
    </div>
  );
}

export const TodoExecRenderer = memo(function TodoExecRenderer({ block }: ToolRendererProps) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);

  const [collapsed, setCollapsed] = useState(false);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  let borderBg: string;
  if (isRunning) {
    borderBg = "border-status-info/25 bg-status-info/5";
  } else if (isError) {
    borderBg = "border-status-error/15 bg-status-error/5";
  } else {
    borderBg = "border-border-secondary/30 bg-surface-dim";
  }

  const details = block.details && isTodoDetails(block.details) ? block.details : null;

  const operation = (() => {
    try {
      const args = JSON.parse(block.args ?? "{}") as { action?: string };
      return args.action ?? details?.action ?? "";
    } catch {
      return details?.action ?? "";
    }
  })();

  return (
    <div
      data-toolcall-id={block.toolCallId}
      className={`rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}
    >
      {/* Header */}
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
          const { icon: TodoIcon } = getToolIcon("todo");
          return (
            <TodoIcon
              className={`w-3.5 h-3.5 shrink-0 ${
                isRunning
                  ? "text-status-info"
                  : isError
                    ? "text-status-error"
                    : "text-status-warning/70"
              }`}
            />
          );
        })()}
        <span
          className={`font-medium shrink-0 ${
            isRunning ? "text-status-info" : isError ? "text-status-error" : "text-text-primary"
          }`}
        >
          todo
        </span>

        {operation && <span className="text-text-tertiary text-[11px]">{operation}</span>}

        <span className="flex-1 min-w-0" />

        {isRunning && (
          <span className="shrink-0 text-[10px] text-status-info animate-pulse">执行中...</span>
        )}

        {!isRunning && details && <ActionSummary details={details} />}
      </div>

      {/* Content */}
      {collapsed ? null : isRunning ? (
        <div className="px-3 pb-2">
          <div className="text-[11px] text-text-tertiary italic py-1">执行中...</div>
        </div>
      ) : (
        <div className="border-t border-border-secondary/30">
          {details ? (
            <div className="px-3 pb-2">
              {details.action === "add" || details.action === "add_batch" ? (
                <TodoList todos={details.added ?? details.todos ?? []} />
              ) : (
                <TodoList todos={details.todos ?? []} />
              )}
            </div>
          ) : block.output ? (
            <div className="px-3 pb-2 text-[11px] text-text-tertiary font-mono whitespace-pre-wrap max-h-36 overflow-y-auto">
              {block.output}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
