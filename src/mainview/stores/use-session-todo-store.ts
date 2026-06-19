import { create } from "zustand";
import type { TodoItem, TodoPriority } from "./session-subscriptions";

export type { TodoItem, TodoPriority };

interface SessionTodoState {
  todosBySession: Record<string, TodoItem[]>;
  setSessionTodos: (sessionId: string, todos: TodoItem[]) => void;
  clearSessionTodos: (sessionId: string) => void;
}

export const useSessionTodoStore = create<SessionTodoState>((set) => ({
  todosBySession: {},
  setSessionTodos: (sessionId, todos) =>
    set((s) => ({
      todosBySession: { ...s.todosBySession, [sessionId]: todos },
    })),
  clearSessionTodos: (sessionId) =>
    set((s) => {
      const next = { ...s.todosBySession };
      delete next[sessionId];
      return { todosBySession: next };
    }),
}));
