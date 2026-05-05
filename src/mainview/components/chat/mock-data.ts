export type ConversationStatus = "idle" | "running" | "done" | "error";

export type Conversation = {
  id: string;
  title: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  status: ConversationStatus;
  createdAt: number;
  updatedAt: number;
};

export type ChatConfig = {
  model: string;
  temperature: number;
  maxTokens: number;
};

export const conversations: Conversation[] = [
  {
    id: "conv-1",
    title: "重构布局系统",
    messages: [
      { role: "user", content: "帮我重构五栏布局" },
      { role: "assistant", content: "好的，开始分析..." },
    ],
    status: "done",
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 1800000,
  },
  {
    id: "conv-2",
    title: "修复工具栏样式",
    messages: [{ role: "user", content: "工具栏太宽了" }],
    status: "running",
    createdAt: Date.now() - 600000,
    updatedAt: Date.now(),
  },
];
