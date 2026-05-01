export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
  priority?: TodoPriority;
  deleted?: boolean;
}

export interface TodoChannelEvent {
  action: string;
  todos: TodoItem[];
  timestamp: number;
}

export interface TodoMethods {
  "todo.list": {
    params: { sessionPath: string };
    result: { todos: TodoItem[] };
  };
}

export interface TodoEvents {
  "todo.event": TodoEventPayload;
}

export interface TodoEventPayload {
  sessionId: string;
  action: string;
  todos: TodoItem[];
  timestamp: number;
}
