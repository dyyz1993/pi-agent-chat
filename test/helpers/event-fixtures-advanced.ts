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
} from "./mock-llm";

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
