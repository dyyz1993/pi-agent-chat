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

export function lspDiagnosticsScenario(): MockScenario {
  const tcId = "tc-lsp-diag";
  return {
    id: "T10.1",
    description: "LSP diagnostics result",
    userInput: "Run diagnostics on src/index.ts",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Running LSP diagnostics..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "lsp_diagnostics",
          arguments: { filePath: "src/index.ts" },
        },
      ]),
      toolCallStart(tcId, "lsp_diagnostics", { filePath: "src/index.ts" }),
      toolCallEnd(
        tcId,
        JSON.stringify({
          filePath: "src/index.ts",
          diagnostics: [
            { message: "Unused variable", severity: "hint", line: 10 },
            { message: "Missing return type", severity: "info", line: 15 },
          ],
        }),
      ),
      {
        delay: 30,
        event: {
          type: "custom_entry",
          customType: "lsp_status",
          data: {
            state: "ready",
            servers: [{ name: "typescript", state: "ready", fileTypes: ["ts", "tsx"] }],
            mode: "agent_end",
          },
        },
      },
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Diagnostics complete. Found 2 issues." }]),
      messageEnd({ input: 120, output: 60, total: 180 }),
      agentEnd(),
    ],
  };
}

export function snapshotRollbackScenario(): MockScenario {
  const tcId = "tc-snap-rollback";
  return {
    id: "T11.2",
    description: "Snapshot rollback",
    userInput: "Rollback to snapshot snap-1",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Rolling back to snapshot..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "snapshot_rollback",
          arguments: { snapshotId: "snap-1" },
        },
      ]),
      toolCallStart(tcId, "snapshot_rollback", { snapshotId: "snap-1" }),
      toolCallEnd(
        tcId,
        JSON.stringify({ ok: true, restoredFiles: ["src/index.ts", "src/App.tsx"] }),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Rolled back 2 files from snapshot." }]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

export function snapshotUnrevertScenario(): MockScenario {
  const tcId = "tc-snap-unrevert";
  return {
    id: "T11.3",
    description: "Snapshot unrevert",
    userInput: "Unrevert snapshot snap-1",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Unreverting snapshot..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "snapshot_unrevert",
          arguments: { snapshotId: "snap-1" },
        },
      ]),
      toolCallStart(tcId, "snapshot_unrevert", { snapshotId: "snap-1" }),
      toolCallEnd(tcId, JSON.stringify({ ok: true, unrevertedFiles: ["src/index.ts"] })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Snapshot reverted to previous state." }]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

export function snapshotTreeScenario(): MockScenario {
  const tcId = "tc-snap-tree";
  return {
    id: "T11.4",
    description: "Snapshot get tree",
    userInput: "Show snapshot tree for snap-1",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Getting snapshot tree..." }]),
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcId,
          name: "snapshot_getTree",
          arguments: { snapshotId: "snap-1", filePath: "src" },
        },
      ]),
      toolCallStart(tcId, "snapshot_getTree", { snapshotId: "snap-1", filePath: "src" }),
      toolCallEnd(
        tcId,
        JSON.stringify({
          tree: [
            { path: "src/index.ts", size: 1024 },
            { path: "src/App.tsx", size: 2048 },
          ],
        }),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Snapshot tree loaded: 2 files." }]),
      messageEnd({ input: 100, output: 60, total: 160 }),
      agentEnd(),
    ],
  };
}

// --- T12.x Preview variants ---
export function previewImageScenario(): MockScenario {
  const tcId = "tc-preview-img";
  return {
    id: "T12.1",
    description: "Preview image",
    userInput: "Preview logo.svg",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Previewing logo..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "preview", arguments: { source: "logo.svg" } },
      ]),
      toolCallStart(tcId, "preview", { source: "logo.svg" }),
      toolCallEnd(
        tcId,
        JSON.stringify({ source: "logo.svg", resourceType: "image", mimeType: "image/svg+xml" }),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Image loaded." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}
export function previewHtmlScenario(): MockScenario {
  const tcId = "tc-preview-html";
  return {
    id: "T12.3",
    description: "Preview HTML",
    userInput: "Preview test.html",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Rendering HTML..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "preview", arguments: { source: "test.html" } },
      ]),
      toolCallStart(tcId, "preview", { source: "test.html" }),
      toolCallEnd(tcId, JSON.stringify({ source: "test.html", resourceType: "html" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "HTML rendered." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}
export function previewPdfScenario(): MockScenario {
  const tcId = "tc-preview-pdf";
  return {
    id: "T12.4",
    description: "Preview PDF",
    userInput: "Preview report.pdf",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Loading PDF..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "preview", arguments: { source: "report.pdf" } },
      ]),
      toolCallStart(tcId, "preview", { source: "report.pdf" }),
      toolCallEnd(tcId, JSON.stringify({ source: "report.pdf", resourceType: "pdf" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "PDF loaded." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}
export function previewVideoAudioScenario(): MockScenario {
  const tcIdV = "tc-preview-vid";
  const tcIdA = "tc-preview-aud";
  return {
    id: "T12.5",
    description: "Preview video + audio",
    userInput: "Preview demo.mp4 and notification.mp3",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Loading media..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcIdV, name: "preview", arguments: { source: "demo.mp4" } },
        { type: "toolCall", id: tcIdA, name: "preview", arguments: { source: "notification.mp3" } },
      ]),
      toolCallStart(tcIdV, "preview", { source: "demo.mp4" }),
      toolCallEnd(tcIdV, JSON.stringify({ resourceType: "video" })),
      toolCallStart(tcIdA, "preview", { source: "notification.mp3" }),
      toolCallEnd(tcIdA, JSON.stringify({ resourceType: "audio" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Media loaded." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}
export function previewMarkdownScenario(): MockScenario {
  const tcId = "tc-preview-md";
  return {
    id: "T12.6",
    description: "Preview markdown",
    userInput: "Preview README.md",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Rendering..." }]),
      messageStart("assistant", [
        { type: "toolCall", id: tcId, name: "preview", arguments: { source: "README.md" } },
      ]),
      toolCallStart(tcId, "preview", { source: "README.md" }),
      toolCallEnd(tcId, JSON.stringify({ resourceType: "markdown" })),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Markdown rendered." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}
// --- T13.x ---
export function sessionRenameScenario(): MockScenario {
  return {
    id: "T13.1",
    description: "Auto session rename",
    userInput: "Hello",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Hi!" }]),
      messageEnd(),
      { delay: 20, event: { type: "session_rename", name: "Performance optimization" } },
      agentEnd(),
    ],
  };
}
// --- T14.2 ---
export function contextUsageHighScenario(): MockScenario {
  return {
    id: "T14.2",
    description: "Context usage high",
    userInput: "Show context",
    steps: [
      agentStart(),
      {
        delay: 20,
        event: {
          type: "custom_entry",
          customType: "context_usage",
          data: { tokens: 95000, contextWindow: 100000, percent: 95 },
        },
      },
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Context at 95%." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}
// --- T24.3 ---
export function mermaidErrorScenario(): MockScenario {
  return {
    id: "T24.3",
    description: "Mermaid with invalid syntax",
    userInput: "Draw an invalid diagram",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "```mermaid\ngraph TB\n  A-->|invalid|\n```" }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}
// --- T30.3 ---
export function tabManagementScenario(): MockScenario {
  return {
    id: "T30.3",
    description: "Tab management multi-project",
    userInput: "Switch projects",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Managing projects..." }]),
      {
        delay: 20,
        event: {
          type: "custom_entry",
          customType: "tab_sync",
          data: {
            tabs: [
              { id: "proj-1", name: "Project A" },
              { id: "proj-2", name: "Project B" },
            ],
            activeTabId: "proj-1",
          },
        },
      },
      messageEnd(),
      agentEnd(),
    ],
  };
}
// --- T30.5 ---
export function longRunningWithSubagentScenario(): MockScenario {
  const tcBash = "tc-long-bash";
  const tcSub = "tc-long-sub";
  return {
    id: "T30.4",
    description: "Long running build + subagent + editing",
    userInput: "Start build, review code, then write new feature",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Starting build in background..." }]),
      // Both toolCalls in ONE messageStart to avoid content overwrite
      messageStart("assistant", [
        {
          type: "toolCall",
          id: tcBash,
          name: "bash",
          arguments: JSON.stringify({ command: "npm run build", backgroundAfter: 5 }),
        },
        {
          type: "toolCall",
          id: tcSub,
          name: "subagent",
          arguments: JSON.stringify({ agent: "code-reviewer", task: "Review recent changes" }),
        },
      ]),
      toolCallStart(tcBash, "bash", { command: "npm run build", backgroundAfter: 5 }),
      toolCallUpdate(tcBash, "Building...\nCompiling modules...\n"),
      toolCallUpdate(tcSub, "Analyzing diff..."),
      toolCallEnd(tcSub, "Review complete: 3 suggestions"),
      toolCallEnd(
        tcBash,
        JSON.stringify({ exitCode: 0, output: "Build complete", background: true, pid: 12345 }),
      ),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Both build and review done." }]),
      messageEnd(),
      agentEnd(),
    ],
  };
}

export function permissionModeSwitchScenario(): MockScenario {
  return {
    id: "T30.5",
    description: "Permission mode switch",
    userInput: "Switch to plan mode",
    steps: [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "Switching..." }]),
      {
        delay: 20,
        event: {
          type: "custom_entry",
          customType: "permission_mode_change",
          data: { mode: "plan", description: "Read-only mode" },
        },
      },
      messageEnd(),
      agentEnd(),
    ],
  };
}

export function allScenarios(): MockScenario[] {
  return [
    firstMessageScenario(),
    streamingMessageScenario(),
    basicBashScenario(),
    readFileScenario(),
    createFileScenario(),
    confirmDialogScenario(),
    bashBackgroundScenario(),
    bashFailureScenario(),
    todoCreateScenario(),
    todoToggleScenario(),
    subagentSingleScenario(),
    subagentParallelScenario(),
    subagentChainScenario(),
    rulesSnapshotScenario(),
    rulesMatchedScenario(),
    rulesReloadedScenario(),
    memorySaveScenario(),
    coordinatorDelegateScenario(),
    coordinatorSendMessageScenario(),
    coordinatorStatusCheckScenario(),
    coordinatorListScenario(),
    coordinatorStopScenario(),
    coordinatorForkScenario(),
    fileSnapshotScenario(),
    snapshotRollbackScenario(),
    snapshotUnrevertScenario(),
    snapshotTreeScenario(),
    previewUrlScenario(),
    compactionScenario(),
    thinkingBlockScenario(),
    steeringQueueScenario(),
    selectDialogScenario(),
    selectMultiScenario(),
    inputDialogScenario(),
    editorDialogScenario(),
    notifyScenario(),
    pendingCenterScenario(),
    autoRetryScenario(),
    mermaidDiagramScenario(),
    mcpConnectionChangeScenario(),
    fullExtensionChainScenario(),
    multiSessionParallelScenario(),
    abortExecutionScenario(),
    followUpModeScenario(),
    bashBackgroundKillScenario(),
    bashStdinScenario(),
    dangerousCommandInterceptScenario(),
    bashBackgroundLogScenario(),
    editFileDiffScenario(),
    fileSearchGrepScenario(),
    globPatternScenario(),
    deleteTodoScenario(),
    clearTodosScenario(),
    listTodosScenario(),
    memoryPrefetchScenario(),
    memoryDreamScenario(),
    lspDiagnosticsScenario(),
    previewImageScenario(),
    previewHtmlScenario(),
    previewPdfScenario(),
    previewVideoAudioScenario(),
    previewMarkdownScenario(),
    sessionRenameScenario(),
    contextUsageHighScenario(),
    mermaidErrorScenario(),
    tabManagementScenario(),
    permissionModeSwitchScenario(),
    longRunningWithSubagentScenario(),
  ];
}
