import type { IncomingMessage, ServerResponse } from "http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());
const listRemoteProjectsMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawnSync: spawnSyncMock },
  spawnSync: spawnSyncMock,
}));

vi.mock("../../../src/shared/lib/project-config", () => ({
  listRemoteProjects: listRemoteProjectsMock,
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { handleFileContent } from "../../../src/gateway/file-handlers";

function createMockIncomingMessage(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as IncomingMessage;
}

function createMockServerResponse(): ServerResponse & {
  statusCode: number;
  body: Buffer;
  headers: Record<string, string | number>;
} {
  const headers: Record<string, string | number> = {};
  const res = {
    statusCode: 200,
    body: Buffer.alloc(0),
    headers,
    setHeader(key: string, value: string | number) {
      headers[key] = value;
    },
    writeHead(code: number, hdrs?: Record<string, string | number>) {
      res.statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return res;
    },
    end(data?: string | Buffer) {
      res.body = typeof data === "string" ? Buffer.from(data) : data ?? Buffer.alloc(0);
      return res;
    },
  } as unknown as ServerResponse & {
    statusCode: number;
    body: Buffer;
    headers: Record<string, string | number>;
  };
  return res;
}

describe("gateway remote file handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRemoteProjectsMock.mockResolvedValue([
      {
        id: "remote-1",
        name: "demo",
        profileId: "default",
        host: "demo-host",
        remotePath: "/root/projects/demo",
        localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-demo",
        sshArgs: ["-p", "2222"],
        createdAt: 1,
        lastOpened: 1,
      },
    ]);
  });

  it("serves a remote project file through ssh when /file receives a local shadow path", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: Buffer.from("11\n"), stderr: Buffer.alloc(0) })
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from("<svg></svg>"),
        stderr: Buffer.alloc(0),
      });

    const req = createMockIncomingMessage();
    const res = createMockServerResponse();

    await handleFileContent(
      encodeURIComponent("/Users/me/.pi-agent-chat/remote-projects/ssh-demo/drawings/dragon-boat.svg"),
      req,
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/svg+xml");
    expect(res.body.toString()).toBe("<svg></svg>");
    expect(spawnSyncMock).toHaveBeenLastCalledWith(
      "ssh",
      expect.arrayContaining(["-p", "2222", "demo-host", "cat -- '/root/projects/demo/drawings/dragon-boat.svg'"]),
      expect.objectContaining({ encoding: "buffer" }),
    );
  });

  it("serves remote range requests without reading the full file into the gateway", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: Buffer.from("10\n"), stderr: Buffer.alloc(0) })
      .mockReturnValueOnce({ status: 0, stdout: Buffer.from("mot"), stderr: Buffer.alloc(0) });

    const req = createMockIncomingMessage({ range: "bytes=2-4" });
    const res = createMockServerResponse();

    await handleFileContent(
      encodeURIComponent("/Users/me/.pi-agent-chat/remote-projects/ssh-demo/readme.txt"),
      req,
      res,
    );

    expect(res.statusCode).toBe(206);
    expect(res.headers["Content-Range"]).toBe("bytes 2-4/10");
    expect(res.body.toString()).toBe("mot");
    expect(spawnSyncMock).toHaveBeenLastCalledWith(
      "ssh",
      expect.arrayContaining(["demo-host", "dd if='/root/projects/demo/readme.txt' bs=1 skip=2 count=3 2>/dev/null"]),
      expect.objectContaining({ encoding: "buffer" }),
    );
  });
});
