import type { MockScenario } from "./mock-llm";
import {
  agentStart,
  agentEnd,
  messageStart,
  messageUpdate,
  messageEnd,
  toolCallStart,
  toolCallUpdate,
  toolCallEnd,
  thinkingBlockStart,
  thinkingUpdate,
} from "./mock-llm";

export function fullExtensionChainScenario(): MockScenario {
  const tcRead = "tc-chain-read";
  const tcTodo1 = "tc-chain-todo1";
  const tcTodo2 = "tc-chain-todo2";
  const tcTodo3 = "tc-chain-todo3";
  const tcEdit = "tc-chain-edit";
  const tcBash = "tc-chain-bash";
  const tcRemember = "tc-chain-remember";
  const reqConfirm = "req-chain-confirm";

  return {
    id: "T30.1",
    description: "Full extension chain (read+todo+edit+bash+memory+mermaid+confirm)",
    userInput:
      "帮我完成以下完整流程：1.读取文件 2.创建Todo 3.编辑代码 4.运行编译 5.保存记忆 6.画架构图 7.确认结果",
    steps: [
      agentStart(),

      // Thinking + intro text
      messageStart("assistant"),
      thinkingBlockStart(),
      thinkingUpdate("Planning the full workflow..."),
      messageUpdate([{ type: "text", text: "I'll work through each step of the workflow." }]),
      messageEnd({ input: 50, output: 30, total: 80 }),

      // Step 1: Read file
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Let me read the file first." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcRead, name: "file_read", arguments: { path: "src/main.ts" } },
      ]),
      toolCallStart(tcRead, "file_read", { path: "src/main.ts" }),
      toolCallUpdate(tcRead, "import { app } from"),
      toolCallEnd(tcRead, 'import { app } from "./app";\n\napp.listen(3000);\n'),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "File read complete." }]),
      messageEnd({ input: 120, output: 80, total: 200 }),

      // Step 2: Create todos
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Creating todo items..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcTodo1,
          name: "todo",
          arguments: { action: "add", text: "Read src/main.ts", priority: "high" },
        },
        {
          type: "toolCall",
          id: tcTodo2,
          name: "todo",
          arguments: { action: "add", text: "Edit code", priority: "medium" },
        },
        {
          type: "toolCall",
          id: tcTodo3,
          name: "todo",
          arguments: { action: "add", text: "Run build", priority: "medium" },
        },
      ]),
      toolCallStart(tcTodo1, "todo", { action: "add", text: "Read src/main.ts", priority: "high" }),
      toolCallEnd(tcTodo1, "Task added: Read src/main.ts"),
      toolCallStart(tcTodo2, "todo", { action: "add", text: "Edit code", priority: "medium" }),
      toolCallEnd(tcTodo2, "Task added: Edit code"),
      toolCallStart(tcTodo3, "todo", { action: "add", text: "Run build", priority: "medium" }),
      toolCallEnd(tcTodo3, "Task added: Run build"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Created 3 todo items." }]),
      messageEnd({ input: 180, output: 100, total: 280 }),

      // Step 3: Edit file
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Editing the file..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcEdit,
          name: "file_edit",
          arguments: {
            path: "src/main.ts",
            oldContent: "app.listen(3000);",
            newContent: "app.listen(process.env.PORT || 3000);",
          },
        },
      ]),
      toolCallStart(tcEdit, "file_edit", {
        path: "src/main.ts",
        oldContent: "app.listen(3000);",
        newContent: "app.listen(process.env.PORT || 3000);",
      }),
      toolCallEnd(tcEdit, "File edited successfully"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "File edit done." }]),
      messageEnd({ input: 140, output: 90, total: 230 }),

      // Step 4: Bash compile
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Running build..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcBash, name: "bash", arguments: { command: "npm run build" } },
      ]),
      toolCallStart(tcBash, "bash", { command: "npm run build" }),
      toolCallUpdate(tcBash, "Compiling TypeScript..."),
      toolCallUpdate(tcBash, "Build successful. 0 errors."),
      toolCallEnd(tcBash, "Build successful. 0 errors."),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Build completed successfully." }]),
      messageEnd({ input: 200, output: 120, total: 320 }),

      // Step 5: Memory save
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Saving to memory..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcRemember,
          name: "remember",
          arguments: { content: "Updated main.ts to use PORT env variable" },
        },
      ]),
      toolCallStart(tcRemember, "remember", {
        content: "Updated main.ts to use PORT env variable",
      }),
      toolCallEnd(tcRemember, "Memory saved successfully"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Memory saved." }]),
      messageEnd({ input: 120, output: 60, total: 180 }),

      // Step 6: Mermaid diagram
      messageStart("assistant"),
      messageUpdate([
        {
          type: "text",
          text: "Here's the updated architecture:\n\n```mermaid\ngraph TD;\n    A[Client]-->B[Express Server];\n    B-->C[Router];\n    C-->D[Controllers];\n    D-->E[(Database)];\n```\n\nThe server now listens on a configurable port.",
        },
      ]),
      messageEnd({ input: 100, output: 60, total: 160 }),

      // Step 7: Confirm dialog
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: reqConfirm,
          method: "confirm",
          title: "Confirm Changes",
          message: "All 7 steps completed. Confirm the results?",
        },
      },

      agentEnd(),
    ],
  };
}

export function multiSessionParallelScenario(): MockScenario {
  const tcDelegate1 = "tc-parallel-del1";
  const tcDelegate2 = "tc-parallel-del2";
  const tcStatus1 = "tc-parallel-status1";
  const tcStatus2 = "tc-parallel-status2";

  return {
    id: "T30.2",
    description: "Multi-session parallel delegates",
    userInput: "Launch two background agents and check both statuses",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Creating two delegate sessions..." }]),

      // Delegate 1
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcDelegate1,
          name: "session_delegate",
          arguments: { task: "Analyze code quality", title: "Quality Analysis" },
        },
      ]),
      toolCallStart(tcDelegate1, "session_delegate", {
        task: "Analyze code quality",
        title: "Quality Analysis",
      }),
      toolCallEnd(tcDelegate1, JSON.stringify({ sessionId: "delegate-p1", status: "running" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "First delegate created." }]),
      messageEnd({ input: 100, output: 60, total: 160 }),

      // Delegate 2
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Creating second delegate..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcDelegate2,
          name: "session_delegate",
          arguments: { task: "Run security audit", title: "Security Audit" },
        },
      ]),
      toolCallStart(tcDelegate2, "session_delegate", {
        task: "Run security audit",
        title: "Security Audit",
      }),
      toolCallEnd(tcDelegate2, JSON.stringify({ sessionId: "delegate-p2", status: "running" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Both delegates created." }]),
      messageEnd({ input: 200, output: 120, total: 320 }),

      // Status check 1
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Checking status of delegate 1..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcStatus1,
          name: "session_delegate_status",
          arguments: { sessionId: "delegate-p1" },
        },
      ]),
      toolCallStart(tcStatus1, "session_delegate_status", { sessionId: "delegate-p1" }),
      toolCallEnd(
        tcStatus1,
        JSON.stringify({ sessionId: "delegate-p1", status: "running", progress: "60%" }),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Delegate 1 at 60%." }]),
      messageEnd({ input: 80, output: 50, total: 130 }),

      // Status check 2
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Checking status of delegate 2..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcStatus2,
          name: "session_delegate_status",
          arguments: { sessionId: "delegate-p2" },
        },
      ]),
      toolCallStart(tcStatus2, "session_delegate_status", { sessionId: "delegate-p2" }),
      toolCallEnd(
        tcStatus2,
        JSON.stringify({ sessionId: "delegate-p2", status: "running", progress: "40%" }),
      ),

      messageStart("assistant"),
      messageUpdate([
        {
          type: "text",
          text: "Both delegates are running. Quality analysis at 60%, security audit at 40%.",
        },
      ]),
      messageEnd({ input: 300, output: 200, total: 500 }),
      agentEnd(),
    ],
  };
}

export function abortExecutionScenario(): MockScenario {
  const tcId1 = "tc-abort-read1";
  const tcId2 = "tc-abort-read2";
  return {
    id: "T1.5",
    description: "Abort execution — agent_end arrives before toolCallEnd",
    userInput: "Read a.ts and b.ts then abort",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Reading files..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId1, name: "file_read", arguments: { path: "a.ts" } },
        { type: "toolCall", id: tcId2, name: "file_read", arguments: { path: "b.ts" } },
      ]),
      toolCallStart(tcId1, "file_read", { path: "a.ts" }),
      toolCallStart(tcId2, "file_read", { path: "b.ts" }),
      { delay: 50, event: { type: "agent_end" } },
    ],
  };
}

export function followUpModeScenario(): MockScenario {
  return {
    id: "T1.6",
    description: "Follow-up mode — queue_update with followUp triggers second agent cycle",
    userInput: "Check index.ts, then also check App.tsx",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Checking index.ts..." }]),
      messageEnd({ input: 80, output: 40, total: 120 }),
      {
        delay: 30,
        event: {
          type: "queue_update",
          steering: [],
          followUp: ["Also check App.tsx"],
        },
      },
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Checking App.tsx too" }]),
      messageEnd({ input: 90, output: 50, total: 140 }),
      agentEnd(),
    ],
  };
}

export function bashBackgroundKillScenario(): MockScenario {
  const tcId = "tc-bash-kill-t2-3";
  return {
    id: "T2.3",
    description: "Bash background process killed",
    userInput: "Run a long dev server then kill it",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Starting dev server..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "bash", arguments: { command: "npm run dev" } },
      ]),
      toolCallStart(tcId, "bash", { command: "npm run dev" }),
      toolCallUpdate(tcId, "Server running on port 3000..."),
      toolCallEnd(tcId, "Killed"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "The dev server was killed." }]),
      messageEnd({ input: 150, output: 90, total: 240 }),
      agentEnd(),
    ],
  };
}

export function bashStdinScenario(): MockScenario {
  const tcId = "tc-bash-stdin-t2-4";
  return {
    id: "T2.4",
    description: "Bash command with stdin interaction",
    userInput: "Run cat and pipe data to it",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Running cat with stdin..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "bash", arguments: { command: "cat" } },
      ]),
      toolCallStart(tcId, "bash", { command: "cat" }),
      toolCallUpdate(tcId, "hello from stdin\n"),
      toolCallEnd(tcId, "hello from stdin\n"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Stdin data received." }]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

export function dangerousCommandInterceptScenario(): MockScenario {
  const requestId = "req-dangerous-t2-6";
  return {
    id: "T2.6",
    description: "Dangerous command intercepted with confirm dialog",
    userInput: "Delete everything with rm -rf",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "This command is dangerous." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: requestId,
          method: "confirm",
          title: "Dangerous Command",
          message: "Are you sure you want to run: rm -rf /? This will delete everything.",
        },
      },
    ],
  };
}

export function bashBackgroundLogScenario(): MockScenario {
  const tcId = "tc-bash-log-t2-7";
  return {
    id: "T2.7",
    description: "Bash background with log path",
    userInput: "Run build in background with log",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Running build with logging..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "bash",
          arguments: { command: "npm run build", background: true },
        },
      ]),
      toolCallStart(tcId, "bash", { command: "npm run build", background: true }),
      {
        delay: 20,
        event: {
          type: "tool_execution_end",
          toolCallId: tcId,
          result: {
            content: [{ type: "text", text: "Build started in background" }],
            logPath: "/tmp/pi-bash/build-1234.log",
          },
          isError: false,
        },
      },
      messageStart("assistant"),
      messageUpdate([
        { type: "text", text: "Build running in background. Log: /tmp/pi-bash/build-1234.log" },
      ]),
      messageEnd({ input: 180, output: 100, total: 280 }),
      agentEnd(),
    ],
  };
}

export function editFileDiffScenario(): MockScenario {
  const tcId = "tc-edit-diff-t3-3";
  return {
    id: "T3.3",
    description: "Edit file with oldText/newText diff",
    userInput: "Replace foo with bar in index.ts",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Editing index.ts..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "file_edit",
          arguments: { path: "index.ts", oldText: "const foo = 1;", newText: "const bar = 1;" },
        },
      ]),
      toolCallStart(tcId, "file_edit", {
        path: "index.ts",
        oldText: "const foo = 1;",
        newText: "const bar = 1;",
      }),
      toolCallEnd(tcId, "File edited: replaced 'const foo = 1;' with 'const bar = 1;'"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Replaced foo with bar in index.ts." }]),
      messageEnd({ input: 140, output: 80, total: 220 }),
      agentEnd(),
    ],
  };
}

export function fileSearchGrepScenario(): MockScenario {
  const tcId = "tc-grep-t3-4";
  return {
    id: "T3.4",
    description: "File search using grep tool",
    userInput: "Search for TODO comments",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Searching for TODO comments..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "grep",
          arguments: { pattern: "TODO", path: "src", include: "*.ts" },
        },
      ]),
      toolCallStart(tcId, "grep", { pattern: "TODO", path: "src", include: "*.ts" }),
      toolCallUpdate(tcId, "src/main.ts:3:// TODO: refactor this\n"),
      toolCallEnd(
        tcId,
        "src/main.ts:3:// TODO: refactor this\nsrc/utils.ts:12:// TODO: add tests\n",
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Found 2 TODO comments." }]),
      messageEnd({ input: 130, output: 70, total: 200 }),
      agentEnd(),
    ],
  };
}

export function globPatternScenario(): MockScenario {
  const tcId = "tc-glob-t3-5";
  return {
    id: "T3.5",
    description: "Glob pattern file search",
    userInput: "Find all TypeScript files",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Searching for TypeScript files..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "glob",
          arguments: { pattern: "**/*.ts" },
        },
      ]),
      toolCallStart(tcId, "glob", { pattern: "**/*.ts" }),
      toolCallEnd(tcId, "src/main.ts\nsrc/utils.ts\nsrc/types.ts"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Found 3 TypeScript files." }]),
      messageEnd({ input: 120, output: 60, total: 180 }),
      agentEnd(),
    ],
  };
}

export function deleteTodoScenario(): MockScenario {
  const tcId = "tc-todo-del-t4-3";
  return {
    id: "T4.3",
    description: "Delete a todo item",
    userInput: "Remove todo item 1",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Removing todo..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "todo", arguments: { action: "remove", id: 1 } },
      ]),
      toolCallStart(tcId, "todo", { action: "remove", id: 1 }),
      toolCallEnd(tcId, "Task removed: 1"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Todo item removed." }]),
      messageEnd({ input: 80, output: 40, total: 120 }),
      agentEnd(),
    ],
  };
}

export function clearTodosScenario(): MockScenario {
  const tcId = "tc-todo-clear-t4-4";
  return {
    id: "T4.4",
    description: "Clear all todo items",
    userInput: "Clear all todos",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Clearing all todos..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "todo", arguments: { action: "clear" } },
      ]),
      toolCallStart(tcId, "todo", { action: "clear" }),
      toolCallEnd(tcId, "All tasks cleared"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "All todos cleared." }]),
      messageEnd({ input: 80, output: 40, total: 120 }),
      agentEnd(),
    ],
  };
}

export function listTodosScenario(): MockScenario {
  const tcId = "tc-todo-list-t4-5";
  return {
    id: "T4.5",
    description: "List all todo items",
    userInput: "Show my todo list",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Fetching todo list..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "todo", arguments: { action: "list" } },
      ]),
      toolCallStart(tcId, "todo", { action: "list" }),
      toolCallEnd(
        tcId,
        JSON.stringify([
          { id: 1, text: "Refactor components", status: "pending" },
          { id: 2, text: "Write tests", status: "done" },
        ]),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "You have 2 todo items (1 pending, 1 done)." }]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

export function memoryPrefetchScenario(): MockScenario {
  return {
    id: "T6.2",
    description: "Memory prefetch custom entry",
    userInput: "Load memory context",
    steps: [
      agentStart(),
      {
        delay: 30,
        event: {
          type: "custom_entry",
          customType: "memory_prefetch",
          data: {
            query: "CSS variables location",
            results: [
              { content: "CSS variables are in src/mainview/index.css", relevance: 0.95 },
              { content: "Theme store manages dark/light mode", relevance: 0.8 },
            ],
          },
        },
      },
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Loaded memory context." }]),
      messageEnd({ input: 80, output: 40, total: 120 }),
      agentEnd(),
    ],
  };
}

export function memoryDreamScenario(): MockScenario {
  return {
    id: "T6.3",
    description: "Memory dream custom entry",
    userInput: "Trigger memory dream",
    steps: [
      agentStart(),
      {
        delay: 30,
        event: {
          type: "custom_entry",
          customType: "memory_dream",
          data: {
            dreamId: "dream-001",
            memoriesProcessed: 42,
            insights: ["Components follow container pattern", "State is managed by Zustand"],
          },
        },
      },
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Memory dream completed. 42 memories processed." }]),
      messageEnd({ input: 60, output: 30, total: 90 }),
      agentEnd(),
    ],
  };
}

export function rulesMatchedScenario(): MockScenario {
  return {
    id: "T7.2",
    description: "Rules matched event",
    userInput: "Edit index.css",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Editing..." }]),
      {
        delay: 30,
        event: {
          type: "custom_entry",
          customType: "rules_matched",
          data: {
            filePath: "src/index.css",
            matchedRules: [{ name: "css-no-important", severity: "warn" }],
            toolName: "file_edit",
          },
        },
      },
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Rule matched." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}

export function rulesReloadedScenario(): MockScenario {
  return {
    id: "T7.3",
    description: "Rules reloaded event",
    userInput: "Reload rules",
    steps: [
      agentStart(),
      {
        delay: 30,
        event: {
          type: "custom_entry",
          customType: "rules_reloaded",
          data: {
            totalRules: 5,
            loadPath: "/Users/project/.opencode/rules",
          },
        },
      },
      agentEnd(),
    ],
  };
}

export function coordinatorForkScenario(): MockScenario {
  const tcId = "tc-delegate-fork";
  return {
    id: "T8.6",
    description: "Coordinator fork session",
    userInput: "Focus on stores",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Forking session..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "session_delegate_fork",
          arguments: { sessionId: "delegate-1", task: "Focus on stores", title: "Stores Analysis" },
        },
      ]),
      toolCallStart(tcId, "session_delegate_fork", {
        sessionId: "delegate-1",
        task: "Focus on stores",
        title: "Stores Analysis",
      }),
      toolCallEnd(tcId, JSON.stringify({ sessionId: "fork-1", status: "running" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Fork created: Stores Analysis" }]),
      messageEnd({ input: 150, output: 80, total: 230 }),
      agentEnd(),
    ],
  };
}

export function selectMultiScenario(): MockScenario {
  const requestId = "req-select-multi-t9-3";
  return {
    id: "T9.3",
    description: "Select multiple dialog",
    userInput: "Choose files to include",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Please choose files to include." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: requestId,
          method: "select",
          title: "Choose Files",
          options: ["index.ts", "App.tsx", "store.ts", "types.ts"],
          multiple: true,
        },
      },
    ],
  };
}

export function notifyScenario(): MockScenario {
  const requestId = "req-notify-t9-6";
  return {
    id: "T9.6",
    description: "Notify dialog",
    userInput: "Run the build",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Build completed." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: requestId,
          method: "notify",
          message: "Operation finished",
          type: "success",
        },
      },
    ],
  };
}

export function pendingCenterScenario(): MockScenario {
  const confirmId = "req-confirm-pending";
  const inputId = "req-input-pending";
  return {
    id: "T9.7",
    description: "Pending center with two requests",
    userInput: "Deploy to production",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "I need confirmation and a tag name." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: confirmId,
          method: "confirm",
          title: "Confirm Deploy",
          message: "Are you sure you want to deploy to production?",
        },
      },
      {
        delay: 100,
        event: {
          type: "extension_ui_request",
          id: inputId,
          method: "input",
          title: "Deploy Tag",
          placeholder: "e.g. v1.2.3",
        },
      },
    ],
  };
}

