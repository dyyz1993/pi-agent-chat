import { memo, useState, useEffect, useRef } from "react";
import { CheckSquare, Square, TriangleAlert, Zap, Activity } from "lucide-react";
import type { ToolRendererProps } from "./registry";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";
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
      const todos = (details.todos ?? []).filter((t) => !t.deleted);
      const count = details.totalActive ?? todos.length;
      const done = todos.filter((t) => t.done).length;
      return (
        <span className="text-text-tertiary font-normal">
          {count > 0
            ? done > 0
              ? `${count} 个任务 (${done} 已完成)`
              : `${count} 个任务`
            : "暂无待办事项"}
        </span>
      );
    }
    case "add": {
      const added = details.added ?? [];
      if (added.length === 0) return <span className="text-text-tertiary">添加失败</span>;
      if (added.length === 1) {
        const label = added[0].text || `#${added[0].id}`;
        return <span className="text-status-success">✓ {label}</span>;
      }
      const first = added[0].text || `#${added[0].id}`;
      return (
        <span className="text-status-success">
          ✓ {first} 等{added.length}项
        </span>
      );
    }
    case "toggle": {
      const todo = details.modified?.[0];
      if (!todo) return <span className="text-text-tertiary">切换状态</span>;
      const label = todo.text || `#${todo.id}`;
      return (
        <span className={todo.done ? "text-text-tertiary" : "text-status-info"}>
          {todo.done ? `☑ ${label} 已完成` : `☐ ${label} 未完成`}
        </span>
      );
    }
    case "remove": {
      const deleted = details.deleted ?? [];
      const count = deleted.length;
      if (count === 0) return <span className="text-text-tertiary">删除操作</span>;
      const first = deleted[0].text || `#${deleted[0].id}`;
      return (
        <span className="text-text-tertiary">
          🗑 删除 "{first}"{count > 1 ? ` 等${count}项` : ""}
        </span>
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

  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
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

  const status: ToolCardStatus = isRunning ? "running" : isError ? "error" : "done";

  const description = operation || (details ? <ActionSummary details={details} /> : undefined);

  const badge = isRunning ? (
    <span className="shrink-0 text-[10px] text-status-info animate-pulse">执行中...</span>
  ) : details ? (
    <ActionSummary details={details} />
  ) : undefined;

  return (
    <div
      data-toolcall-id={block.toolCallId}
      className={`rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}
    >
      <ToolCardHeader
        toolName="todo"
        status={status}
        description={description}
        collapsed={collapsed}
        badge={badge}
        onClick={() => setCollapsed((c) => !c)}
      />

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
