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

export function firstMessageScenario(): MockScenario {
  return {
    id: "T1.1",
    description: "First message with auto-session-title",
    userInput: "Hello, what can you do?",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Hello! I'm an AI coding" }]),
      messageUpdate([{ type: "text", text: "Hello! I'm an AI coding assistant." }]),
      messageEnd({ input: 100, output: 50, total: 150 }),
      agentEnd(),
    ],
  };
}

export function streamingMessageScenario(): MockScenario {
  const textParts = ["I can ", "help you ", "write code, ", "debug issues, ", "and more!"];
  const steps = [agentStart(), messageStart("assistant")];
  let accumulated = "";
  for (const part of textParts) {
    accumulated += part;
    steps.push(messageUpdate([{ type: "text", text: accumulated }]));
  }
  steps.push(messageEnd({ input: 80, output: 45, total: 125 }));
  steps.push(agentEnd());

  return {
    id: "T1.2",
    description: "Streaming message with incremental text updates",
    userInput: "Tell me about your capabilities",
    steps,
  };
}

export function basicBashScenario(): MockScenario {
  const tcId = "tc-bash-t2-1";
  return {
    id: "T2.1",
    description: "Basic bash command execution",
    userInput: "Run echo hello world",
    steps: [
      agentStart(),
      messageStart("assistant", [{ type: "text", text: "I'll run that command for you." }]),
      messageUpdate([{ type: "text", text: "I'll run that command for you." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "bash", arguments: "echo hello world" },
      ]),
      toolCallStart(tcId, "bash", { command: "echo hello world" }),
      toolCallUpdate(tcId, "hello world\n"),
      toolCallEnd(tcId, "hello world\n"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "The command output: hello world" }]),
      messageEnd({ input: 120, output: 80, total: 200 }),
      agentEnd(),
    ],
  };
}

export function readFileScenario(): MockScenario {
  const tcId = "tc-read-t3-1";
  return {
    id: "T3.1",
    description: "Read file using file_read tool",
    userInput: "Read the file src/index.ts",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Let me read that file." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "file_read", arguments: { path: "src/index.ts" } },
      ]),
      toolCallStart(tcId, "file_read", { path: "src/index.ts" }),
      toolCallUpdate(tcId, "// file content here\nexport default {};\n"),
      toolCallEnd(tcId, "// file content here\nexport default {};\n"),
      messageStart("assistant"),
      messageUpdate([
        {
          type: "text",
          text: "Here's the content of src/index.ts:\n```\n// file content here\nexport default {};\n```",
        },
      ]),
      messageEnd({ input: 150, output: 100, total: 250 }),
      agentEnd(),
    ],
  };
}

export function createFileScenario(): MockScenario {
  const tcId = "tc-write-t3-2";
  return {
    id: "T3.2",
    description: "Create/write file using file_write tool",
    userInput: "Create a file called hello.txt with content 'Hello World'",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "I'll create that file for you." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "file_write",
          arguments: { path: "hello.txt", content: "Hello World" },
        },
      ]),
      toolCallStart(tcId, "file_write", { path: "hello.txt", content: "Hello World" }),
      toolCallEnd(tcId, "File created successfully"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Created hello.txt with the specified content." }]),
      messageEnd({ input: 140, output: 90, total: 230 }),
      agentEnd(),
    ],
  };
}

export function confirmDialogScenario(): MockScenario {
  const requestId = "req-confirm-t9-1";
  return {
    id: "T9.1",
    description: "Confirm dialog (ask-confirm) from agent",
    userInput: "Delete all temp files",
    steps: [
      agentStart(),
      thinkingBlockStart(),
      thinkingUpdate("The user wants to delete temp files. I should confirm before proceeding."),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "I need to confirm this action." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: requestId,
          method: "confirm",
          title: "Confirm Deletion",
          message: "Are you sure you want to delete all temp files? This action cannot be undone.",
        },
      },
    ],
  };
}

export function bashBackgroundScenario(): MockScenario {
  const tcId = "tc-bash-bg-t2-2";
  return {
    id: "T2.2",
    description: "Long-running bash → auto background",
    userInput: "Run npm run build",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Running build..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "bash", arguments: { command: "npm run build" } },
      ]),
      toolCallStart(tcId, "bash", { command: "npm run build" }),
      toolCallUpdate(tcId, "Building..."),
      toolCallEnd(tcId, "Build complete"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Build finished" }]),
      messageEnd({ input: 200, output: 120, total: 320 }),
      agentEnd(),
    ],
  };
}

export function bashFailureScenario(): MockScenario {
  const tcId = "tc-bash-fail-t2-5";
  return {
    id: "T2.5",
    description: "Bash command failure",
    userInput: "List files in /nonexistent_dir",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Let me try..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "bash", arguments: { command: "ls /nonexistent_dir" } },
      ]),
      toolCallStart(tcId, "bash", { command: "ls /nonexistent_dir" }),
      toolCallEnd(tcId, "No such file or directory", true),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "The command failed: No such file or directory" }]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

export function todoCreateScenario(): MockScenario {
  const tcId1 = "tc-todo-add1-t4-1";
  const tcId2 = "tc-todo-add2-t4-1";
  const tcId3 = "tc-todo-add3-t4-1";
  return {
    id: "T4.1",
    description: "Create Todo list with multiple tasks",
    userInput: "Create a todo list for refactoring",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "I'll create a todo list..." }]),
      messageEnd({ input: 50, output: 20, total: 70 }),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId1,
          name: "todo",
          arguments: { action: "add", text: "Analyze components", priority: "high" },
        },
        {
          type: "toolCall",
          id: tcId2,
          name: "todo",
          arguments: { action: "add", text: "Extract shared utils", priority: "medium" },
        },
        {
          type: "toolCall",
          id: tcId3,
          name: "todo",
          arguments: { action: "add", text: "Add tests", priority: "low" },
        },
      ]),
      toolCallStart(tcId1, "todo", { action: "add", text: "Analyze components", priority: "high" }),
      toolCallEnd(tcId1, "Task added: Analyze components"),
      toolCallStart(tcId2, "todo", {
        action: "add",
        text: "Extract shared utils",
        priority: "medium",
      }),
      toolCallEnd(tcId2, "Task added: Extract shared utils"),
      toolCallStart(tcId3, "todo", { action: "add", text: "Add tests", priority: "low" }),
      toolCallEnd(tcId3, "Task added: Add tests"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Created 3 tasks" }]),
      messageEnd({ input: 180, output: 100, total: 280 }),
      agentEnd(),
    ],
  };
}

export function todoToggleScenario(): MockScenario {
  const tcId = "tc-todo-toggle-t4-2";
  return {
    id: "T4.2",
    description: "Toggle Todo task status",
    userInput: "Mark task 1 as complete",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Marking tasks complete..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "todo", arguments: { action: "toggle", id: 1 } },
      ]),
      toolCallStart(tcId, "todo", { action: "toggle", id: 1 }),
      toolCallEnd(tcId, "Task toggled"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Done" }]),
      messageEnd({ input: 80, output: 40, total: 120 }),
      agentEnd(),
    ],
  };
}

export function subagentSingleScenario(): MockScenario {
  const tcId = "tc-subagent-t5-1";
  return {
    id: "T5.1",
    description: "Single subagent delegation",
    userInput: "Review the session store code",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Delegating to code-reviewer..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "subagent",
          arguments: { agent: "code-reviewer", task: "Review use-session-store.ts" },
        },
      ]),
      toolCallStart(tcId, "subagent", {
        agent: "code-reviewer",
        task: "Review use-session-store.ts",
      }),
      toolCallUpdate(tcId, "Analyzing code structure..."),
      toolCallEnd(tcId, "Review complete. Found 3 issues."),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "The reviewer found 3 issues in the session store." }]),
      messageEnd({ input: 250, output: 150, total: 400 }),
      agentEnd(),
    ],
  };
}

export function memorySaveScenario(): MockScenario {
  const tcId = "tc-remember-t6-1";
  return {
    id: "T6.1",
    description: "Memory save (remember)",
    userInput: "Remember that CSS variables are in index.css",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "I'll save that to memory..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "remember",
          arguments: {
            content: "CSS variables are in index.css under :root and html.dark selectors",
          },
        },
      ]),
      toolCallStart(tcId, "remember", {
        content: "CSS variables are in index.css under :root and html.dark selectors",
      }),
      toolCallEnd(tcId, "Memory saved successfully"),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Done" }]),
      messageEnd({ input: 120, output: 60, total: 180 }),
      agentEnd(),
    ],
  };
}

export function coordinatorDelegateScenario(): MockScenario {
  const tcId = "tc-delegate-t8-1";
  return {
    id: "T8.1",
    description: "Coordinator delegate session",
    userInput: "Analyze code complexity in the background",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Creating background session..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "session_delegate",
          arguments: { task: "Analyze code complexity", title: "Complexity Analysis" },
        },
      ]),
      toolCallStart(tcId, "session_delegate", {
        task: "Analyze code complexity",
        title: "Complexity Analysis",
      }),
      toolCallEnd(tcId, JSON.stringify({ sessionId: "delegate-1", status: "running" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Delegate session created" }]),
      messageEnd({ input: 150, output: 80, total: 230 }),
      agentEnd(),
    ],
  };
}

export function compactionScenario(): MockScenario {
  return {
    id: "T14.1",
    description: "Context compaction",
    userInput: "Continue working",
    steps: [
      agentStart(),
      {
        delay: 30,
        event: {
          type: "compaction_start",
        },
      },
      {
        delay: 50,
        event: {
          type: "compaction_end",
          summary: "Compressed 50 messages into 5 key points.",
          tokensBefore: 100000,
          tokensAfter: 15000,
          result: { tokensAfter: 15000 },
        },
      },
      agentEnd(),
    ],
  };
}

export function subagentParallelScenario(): MockScenario {
  const tcId1 = "tc-sub-p1";
  const tcId2 = "tc-sub-p2";
  return {
    id: "T5.2",
    description: "Parallel subagent delegation (two in one message)",
    userInput: "Review the store and write tests in parallel",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Delegating to two agents..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId1,
          name: "subagent",
          arguments: { agent: "code-reviewer", task: "Review store" },
        },
        {
          type: "toolCall",
          id: tcId2,
          name: "subagent",
          arguments: { agent: "test-writer", task: "Write tests" },
        },
      ]),
      toolCallStart(tcId1, "subagent", { agent: "code-reviewer", task: "Review store" }),
      toolCallUpdate(tcId1, "Analyzing code..."),
      toolCallEnd(tcId1, "Review complete. Found 2 issues."),
      toolCallStart(tcId2, "subagent", { agent: "test-writer", task: "Write tests" }),
      toolCallUpdate(tcId2, "Generating test cases..."),
      toolCallEnd(tcId2, "Generated 5 test cases."),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Both agents completed their tasks." }]),
      messageEnd({ input: 400, output: 250, total: 650 }),
      agentEnd(),
    ],
  };
}

export function subagentChainScenario(): MockScenario {
  const tcId1 = "tc-sub-chain1";
  const tcId2 = "tc-sub-chain2";
  return {
    id: "T5.3",
    description: "Chain subagent delegation (sequential with reference)",
    userInput: "Analyze and then refactor the code",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Starting first agent..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId1,
          name: "subagent",
          arguments: { agent: "analyst", task: "Analyze code structure" },
        },
      ]),
      toolCallStart(tcId1, "subagent", { agent: "analyst", task: "Analyze code structure" }),
      toolCallUpdate(tcId1, "Analyzing..."),
      toolCallEnd(tcId1, "Analysis complete. Found key patterns."),
      messageEnd({ input: 200, output: 120, total: 320 }),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "First agent done. Starting second agent..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId2,
          name: "subagent",
          arguments: { agent: "refactorer", task: "Refactor based on {previous} analysis" },
        },
      ]),
      toolCallStart(tcId2, "subagent", {
        agent: "refactorer",
        task: "Refactor based on {previous} analysis",
      }),
      toolCallUpdate(tcId2, "Refactoring..."),
      toolCallEnd(tcId2, "Refactoring complete. 3 files updated."),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Chain complete. Both agents finished." }]),
      messageEnd({ input: 300, output: 180, total: 480 }),
      agentEnd(),
    ],
  };
}

export function rulesSnapshotScenario(): MockScenario {
  return {
    id: "T7.1",
    description: "Rules snapshot (custom_entry)",
    userInput: "Show me the active rules",
    steps: [
      agentStart(),
      {
        delay: 30,
        event: {
          type: "custom_entry",
          customType: "rules_snapshot",
          data: {
            rules: [
              { name: "coding-guardrails", scope: "project" },
              { name: "code-style", scope: "project" },
              { name: "react-component-dev", scope: "project" },
            ],
            totalRules: 3,
          },
        },
      },
      agentEnd(),
    ],
  };
}

export function coordinatorSendMessageScenario(): MockScenario {
  const tcId = "tc-delegate-send";
  return {
    id: "T8.2",
    description: "Coordinator send message to delegate",
    userInput: "Tell the background agent to focus on auth",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Sending message to delegate..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "session_delegate_send",
          arguments: { targetSessionId: "delegate-1", message: "Focus on the auth module" },
        },
      ]),
      toolCallStart(tcId, "session_delegate_send", {
        targetSessionId: "delegate-1",
        message: "Focus on the auth module",
      }),
      toolCallEnd(tcId, JSON.stringify({ ok: true })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Message sent to delegate session." }]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

export function coordinatorStatusCheckScenario(): MockScenario {
  const tcId = "tc-delegate-status";
  return {
    id: "T8.3",
    description: "Coordinator check delegate status",
    userInput: "Check status of delegate session",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Checking delegate status..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "session_delegate_status",
          arguments: { sessionId: "delegate-1" },
        },
      ]),
      toolCallStart(tcId, "session_delegate_status", { sessionId: "delegate-1" }),
      toolCallEnd(
        tcId,
        JSON.stringify({ sessionId: "delegate-1", status: "running", task: "Complexity analysis" }),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Delegate is still running." }]),
      messageEnd({ input: 80, output: 50, total: 130 }),
      agentEnd(),
    ],
  };
}

export function coordinatorListScenario(): MockScenario {
  const tcId = "tc-delegate-list";
  return {
    id: "T8.4",
    description: "Coordinator list all delegates",
    userInput: "List all delegate sessions",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Listing all delegates..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "session_delegate_list", arguments: {} },
      ]),
      toolCallStart(tcId, "session_delegate_list", {}),
      toolCallEnd(
        tcId,
        JSON.stringify([
          { sessionId: "delegate-1", status: "running", task: "Complexity analysis" },
          { sessionId: "delegate-2", status: "done", task: "Code review" },
        ]),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Found 2 delegate sessions." }]),
      messageEnd({ input: 100, output: 70, total: 170 }),
      agentEnd(),
    ],
  };
}

export function coordinatorStopScenario(): MockScenario {
  const tcId = "tc-delegate-stop";
  return {
    id: "T8.5",
    description: "Coordinator stop delegate session",
    userInput: "Stop the background delegate",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Stopping delegate..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "session_delegate_stop",
          arguments: { sessionId: "delegate-1" },
        },
      ]),
      toolCallStart(tcId, "session_delegate_stop", { sessionId: "delegate-1" }),
      toolCallEnd(tcId, JSON.stringify({ ok: true, sessionId: "delegate-1" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Delegate stopped." }]),
      messageEnd({ input: 80, output: 40, total: 120 }),
      agentEnd(),
    ],
  };
}

export function fileSnapshotScenario(): MockScenario {
  const tcId = "tc-edit-snap";
  return {
    id: "T11.1",
    description: "File edit followed by auto snapshot",
    userInput: "Edit src/test.ts and create a snapshot",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Editing file..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "edit",
          arguments: { path: "src/test.ts", content: "export const test = true;" },
        },
      ]),
      toolCallStart(tcId, "edit", { path: "src/test.ts", content: "export const test = true;" }),
      toolCallEnd(tcId, "File edited successfully"),
      {
        delay: 30,
        event: {
          type: "custom_entry",
          customType: "step_snapshot",
          data: { id: "snap-1", files: ["src/test.ts"] },
        },
      },
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Edit complete, snapshot created." }]),
      messageEnd({ input: 150, output: 100, total: 250 }),
      agentEnd(),
    ],
  };
}

export function previewUrlScenario(): MockScenario {
  const tcId = "tc-preview-url";
  return {
    id: "T12.2",
    description: "Preview URL resource",
    userInput: "Preview this URL: https://example.com",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Previewing URL..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "preview",
          arguments: { source: "https://example.com" },
        },
      ]),
      toolCallStart(tcId, "preview", { source: "https://example.com" }),
      toolCallEnd(
        tcId,
        JSON.stringify({
          resourceType: "url",
          url: "https://example.com",
          title: "Example Domain",
        }),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Preview loaded for https://example.com" }]),
      messageEnd({ input: 120, output: 80, total: 200 }),
      agentEnd(),
    ],
  };
}

export function thinkingBlockScenario(): MockScenario {
  return {
    id: "T1.3",
    description: "Thinking block with text response",
    userInput: "Analyze the code structure",
    steps: [
      agentStart(),
      messageStart("assistant"),
      thinkingBlockStart(),
      thinkingUpdate("Analyzing code structure..."),
      thinkingUpdate("Found patterns in state management..."),
      messageUpdate([{ type: "text", text: "Based on my analysis..." }]),
      messageEnd({ input: 120, output: 80, total: 200 }),
      agentEnd(),
    ],
  };
}

export function steeringQueueScenario(): MockScenario {
  return {
    id: "T1.4",
    description: "Steering queue update during message",
    userInput: "Refactor to TypeScript",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "I'm working on..." }]),
      {
        delay: 30,
        event: {
          type: "queue_update",
          steering: ["Switch to TypeScript"],
          followUp: [],
        },
      },
      messageUpdate([{ type: "text", text: "Now using TypeScript..." }]),
      messageEnd({ input: 150, output: 100, total: 250 }),
      agentEnd(),
    ],
  };
}

export function selectDialogScenario(): MockScenario {
  const requestId = "req-select-t9-2";
  return {
    id: "T9.2",
    description: "Select dialog (single choice)",
    userInput: "Choose a theme",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Please choose a theme." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: requestId,
          method: "select",
          title: "Choose Theme",
          options: ["Ocean Blue", "Forest Green", "Sunset Orange"],
          multiple: false,
        },
      },
    ],
  };
}

export function inputDialogScenario(): MockScenario {
  const requestId = "req-input-t9-4";
  return {
    id: "T9.4",
    description: "Input dialog",
    userInput: "Create a component",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "I need a component name." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: requestId,
          method: "input",
          title: "Component Name",
          placeholder: "e.g. UserProfileCard",
        },
      },
    ],
  };
}

export function editorDialogScenario(): MockScenario {
  const requestId = "req-editor-t9-5";
  return {
    id: "T9.5",
    description: "Editor dialog",
    userInput: "Edit commit message",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Please edit the commit message." }]),
      {
        delay: 50,
        event: {
          type: "extension_ui_request",
          id: requestId,
          method: "editor",
          title: "Edit Commit Message",
          prefill: "feat: add feature\n\n- Added X",
        },
      },
    ],
  };
}

export function autoRetryScenario(): MockScenario {
  return {
    id: "T19.1",
    description: "Auto retry lifecycle",
    userInput: "Run tests",
    steps: [
      agentStart(),
      {
        delay: 30,
        event: {
          type: "auto_retry_start",
          attempt: 1,
          maxAttempts: 3,
          errorMessage: "Rate limit exceeded",
        },
      },
      {
        delay: 50,
        event: {
          type: "auto_retry_end",
          success: true,
          attempt: 2,
        },
      },
      agentEnd(),
    ],
  };
}

export function mermaidDiagramScenario(): MockScenario {
  return {
    id: "T24.1",
    description: "Message containing mermaid diagram",
    userInput: "Show architecture diagram",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([
        {
          type: "text",
          text: "Here's the architecture:\n\n```mermaid\ngraph TD;\n    A[Frontend]-->B[Backend];\n    B-->C[Database];\n```\n\nThis shows the three-tier architecture.",
        },
      ]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

export function mcpConnectionChangeScenario(): MockScenario {
  return {
    id: "T20.1",
    description: "MCP connection change events",
    userInput: "Check MCP connections",
    steps: [
      agentStart(),
      {
        delay: 30,
        event: {
          type: "mcp_connection_change",
          name: "filesystem",
          status: "connected",
          tools: [
            {
              originalName: "read_file",
              fullName: "filesystem__read_file",
              description: "Read a file",
            },
            {
              originalName: "write_file",
              fullName: "filesystem__write_file",
              description: "Write a file",
            },
            {
              originalName: "list_dir",
              fullName: "filesystem__list_dir",
              description: "List directory",
            },
            { originalName: "search", fullName: "filesystem__search", description: "Search files" },
            { originalName: "move", fullName: "filesystem__move", description: "Move file" },
          ],
        },
      },
      {
        delay: 50,
        event: {
          type: "mcp_connection_change",
          name: "github",
          status: "error",
          error: "Connection refused",
        },
      },
      agentEnd(),
    ],
  };
}

