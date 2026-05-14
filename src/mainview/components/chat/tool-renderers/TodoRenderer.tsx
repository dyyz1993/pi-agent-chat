import { memo } from "react";
import { ListTodo, CheckSquare, Square, TriangleAlert, Zap, Activity } from "lucide-react";
import type { ToolRendererProps } from "./registry";

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
      return <TriangleAlert className="w-3 h-3 shrink-0 text-red-500 dark:text-red-400" />;
    case "medium":
      return <Zap className="w-3 h-3 shrink-0 text-amber-500 dark:text-amber-400" />;
    case "low":
      return <Activity className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />;
    default:
      return null;
  }
}

function ActionSummary({ details }: { details: TodoDetails }) {
  switch (details.action) {
    case "list": {
      const count = details.totalActive ?? details.active?.length ?? 0;
      return (
        <span className="text-gray-500 dark:text-gray-400 font-normal">
          {count > 0 ? `${count} 个任务` : "暂无待办事项"}
        </span>
      );
    }
    case "add": {
      const added = details.added ?? [];
      if (added.length === 0)
        return <span className="text-gray-400 dark:text-gray-500">添加失败</span>;
      if (added.length === 1)
        return (
          <span className="text-emerald-600 dark:text-emerald-400">
            ✓ #{added[0].id}: {added[0].text}
          </span>
        );
      return (
        <span className="text-emerald-600 dark:text-emerald-400">✓ 添加 {added.length} 个任务</span>
      );
    }
    case "toggle": {
      const todo = details.todos?.find((t) => t.id !== undefined);
      if (!todo) return <span className="text-gray-400 dark:text-gray-500">切换状态</span>;
      return (
        <span
          className={
            todo.done ? "text-gray-400 dark:text-gray-500" : "text-blue-500 dark:text-blue-400"
          }
        >
          {todo.done ? `☑ #${todo.id} 已完成` : `☐ #${todo.id} 未完成`}
        </span>
      );
    }
    case "remove": {
      const count = (details.deleted ?? []).length;
      return count > 0 ? (
        <span className="text-gray-400 dark:text-gray-500">🗑 删除 {count} 个任务</span>
      ) : (
        <span className="text-gray-400 dark:text-gray-500">删除操作</span>
      );
    }
    case "clear": {
      return <span className="text-gray-400 dark:text-gray-500">🗑 已清空</span>;
    }
    default:
      return <span className="text-gray-400 dark:text-gray-500">{details.action}</span>;
  }
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  const active = todos.filter((t) => !t.deleted);
  if (active.length === 0) {
    return (
      <div className="text-[11px] text-gray-400 dark:text-gray-500 italic py-1">暂无待办事项</div>
    );
  }

  return (
    <div className="space-y-0.5 py-0.5">
      {active.map((todo) => (
        <div
          key={todo.id}
          className="flex items-center gap-2 py-0.5 px-1 rounded-sm hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
        >
          {/* Status */}
          <span className="shrink-0">
            {todo.done ? (
              <CheckSquare className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            ) : (
              <Square className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
            )}
          </span>

          {/* Text */}
          <span
            className={`flex-1 min-w-0 text-[11px] truncate ${
              todo.done
                ? "line-through text-gray-400 dark:text-gray-500"
                : "text-gray-700 dark:text-gray-300"
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

  let borderBg: string;
  if (isRunning) {
    borderBg = "border-blue-500/25 bg-blue-50 dark:bg-blue-950/20";
  } else if (isError) {
    borderBg = "border-red-500/15 bg-red-50 dark:bg-red-950/15";
  } else {
    borderBg = "border-gray-200 dark:border-gray-700/30 bg-gray-50 dark:bg-gray-800/25";
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
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <ListTodo
          className={`w-3.5 h-3.5 shrink-0 ${
            isRunning
              ? "text-blue-500 dark:text-blue-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : "text-amber-500/70 dark:text-amber-400/60"
          }`}
        />
        <span
          className={`font-medium shrink-0 ${
            isRunning
              ? "text-blue-600 dark:text-blue-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : "text-gray-800 dark:text-gray-300"
          }`}
        >
          todo
        </span>

        {operation && (
          <span className="text-gray-500 dark:text-gray-400 text-[11px]">{operation}</span>
        )}

        <span className="flex-1 min-w-0" />

        {isRunning && (
          <span className="shrink-0 text-[10px] text-blue-500 dark:text-blue-400 animate-pulse">
            执行中...
          </span>
        )}

        {!isRunning && details && <ActionSummary details={details} />}
      </div>

      {/* Content - 始终展示当前任务列表 */}
      {isRunning ? (
        <div className="px-3 pb-2">
          <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">执行中...</div>
        </div>
      ) : (
        <div className="border-t border-gray-200 dark:border-gray-700/30">
          {details ? (
            <div className="px-3 pb-2">
              <TodoList todos={details.todos ?? []} />
            </div>
          ) : block.output ? (
            <div className="px-3 pb-2 text-[11px] text-gray-500 dark:text-gray-400 font-mono whitespace-pre-wrap max-h-36 overflow-y-auto">
              {block.output}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
