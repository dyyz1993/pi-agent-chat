/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  buildRpcClientArgs,
  getSessionIdFromSessionPath,
} from "../../../src/shared/agent/agent-runtime-client";
import {
  getRemoteChildSessionDir,
  normalizeRemoteSessionJsonlForLocalIndex,
} from "../../../src/shared/agent/remote-session-mirror";
import {
  buildRemoteAgentChildRuntimeEnv,
  buildSshCommandRuntimeEnv,
} from "../../../src/shared/agent/runtime-resource-env";

describe("agent runtime client helpers", () => {
  it("keeps extension args and appends an existing session path", () => {
    expect(
      buildRpcClientArgs({
        extensionArgs: ["--no-extensions", "--extension", "/tmp/ext"],
        sessionPath: "/tmp/session.jsonl",
        sessionExists: true,
      }),
    ).toEqual(["--no-extensions", "--extension", "/tmp/ext", "--session", "/tmp/session.jsonl"]);
  });

  it("skips missing or empty session paths", () => {
    expect(
      buildRpcClientArgs({
        extensionArgs: ["--no-extensions"],
        sessionPath: "/tmp/missing.jsonl",
        sessionExists: false,
      }),
    ).toEqual(["--no-extensions"]);

    expect(
      buildRpcClientArgs({
        extensionArgs: ["--no-extensions"],
        sessionPath: undefined,
        sessionExists: true,
      }),
    ).toEqual(["--no-extensions"]);
  });

  it("uses explicit session id for remote child resumes instead of local session paths", () => {
    expect(
      buildRpcClientArgs({
        extensionArgs: ["--no-extensions"],
        sessionId: "cfce2d8e-1e6b-4ce3-be9e-59059888e49d",
        sessionDir: "~/.pi/agent/remote-runtime/child/agent-resources/sessions/--root-project--",
        sessionPath: "/tmp/cfce2d8e-1e6b-4ce3-be9e-59059888e49d.jsonl",
        sessionExists: true,
      }),
    ).toEqual([
      "--no-extensions",
      "--session-dir",
      "~/.pi/agent/remote-runtime/child/agent-resources/sessions/--root-project--",
      "--session-id",
      "cfce2d8e-1e6b-4ce3-be9e-59059888e49d",
    ]);
  });

  it("extracts session ids from local JSONL paths", () => {
    expect(getSessionIdFromSessionPath("/tmp/cfce2d8e.jsonl")).toBe("cfce2d8e");
    expect(getSessionIdFromSessionPath(undefined)).toBeUndefined();
  });

  it("marks quick SSH sandbox clients as ssh-command runtime", () => {
    expect(
      buildSshCommandRuntimeEnv({
        host: "devbox",
        remotePath: "/srv/app",
      }),
    ).toEqual({
      PI_RUNTIME_KIND: "ssh-command",
      PI_REMOTE_SSH_TOOL_PROXY: "1",
      PI_REMOTE_SSH_HOST: "devbox",
      PI_REMOTE_SSH_CWD: "/srv/app",
    });
  });

  it("marks standard SSH child clients as remote-agent-child runtime", () => {
    expect(
      buildRemoteAgentChildRuntimeEnv({
        remotePiAgentDir: "/tmp/pi-agent",
        nodeOptions: "--max-old-space-size=1536",
        skipMcp: true,
      }),
    ).toEqual({
      PI_CODING_AGENT_DIR: "/tmp/pi-agent",
      PI_RUNTIME_KIND: "remote-agent-child",
      NODE_OPTIONS: "--max-old-space-size=1536",
      PI_SKIP_MCP: "1",
    });
  });

  it("derives a stable remote child session directory from remote cwd", () => {
    expect(
      getRemoteChildSessionDir({
        remotePiAgentDir: "~/.pi/agent/remote-runtime/child/agent-resources",
        remoteCwd: "/root/projects/fullstack-admin",
      }),
    ).toBe("~/.pi/agent/remote-runtime/child/agent-resources/sessions/--root-projects-fullstack-admin--");
  });

  it("normalizes mirrored remote session JSONL for the local project index", () => {
    const mirrored = normalizeRemoteSessionJsonlForLocalIndex({
      sessionId: "sess-1",
      localProjectPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-abc",
      content:
        '{"type":"session","version":3,"id":"sess-1","timestamp":"2026-06-24T00:00:00.000Z","cwd":"/root/project"}\n' +
        '{"type":"session_info","id":"info","cwd":"/root/project","name":"Remote"}\n' +
        '{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n',
    });

    expect(mirrored).toBe(
      '{"type":"session","version":3,"id":"sess-1","timestamp":"2026-06-24T00:00:00.000Z","cwd":"/Users/me/.pi-agent-chat/remote-projects/ssh-abc"}\n' +
        '{"type":"session_info","id":"info","cwd":"/Users/me/.pi-agent-chat/remote-projects/ssh-abc","name":"Remote"}\n' +
        '{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n',
    );
  });

  it("rejects mirrored session content for a different session id", () => {
    expect(
      normalizeRemoteSessionJsonlForLocalIndex({
        sessionId: "expected",
        localProjectPath: "/local/project",
        content: '{"type":"session","version":3,"id":"other","timestamp":"now","cwd":"/remote"}\n',
      }),
    ).toBeNull();
  });
});
