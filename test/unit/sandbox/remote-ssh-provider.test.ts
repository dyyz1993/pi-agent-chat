import { describe, expect, it } from "vitest";
import {
  buildLsofListenPidsArgs,
  encodeRemoteInstanceId,
  buildRemoteStartCommand,
  buildScpArgs,
  buildSshArgs,
  getLocalScopePackageNames,
  shQuote,
  shRemotePath,
} from "../../../src/sandbox/providers/ssh";
import {
  buildRemoteChildExtensionsDir,
  buildRemoteChildInstallCommand,
  buildRemoteChildInstallExtensionsCommand,
  buildRemoteChildPaths,
  buildRemoteChildReadyCommand,
} from "../../../src/sandbox/remote-child-bootstrap";

describe("RemoteSshProvider helpers", () => {
  it("quotes shell arguments safely", () => {
    expect(shQuote("/tmp/project with spaces")).toBe("'/tmp/project with spaces'");
    expect(shQuote("it's-ok")).toBe("'it'\\''s-ok'");
    expect(shRemotePath("~/project")).toBe('"${HOME}/project"');
  });

  it("builds non-interactive ssh args from ssh config profile", () => {
    expect(
      buildSshArgs({
        target: "xyz",
        port: 2222,
        keyPath: "/tmp/id",
        extra: ["-N"],
      }),
    ).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=2",
      "-i",
      "/tmp/id",
      "-p",
      "2222",
      "-N",
      "xyz",
    ]);
  });

  it("builds scp args without requiring explicit port or key", () => {
    expect(
      buildScpArgs({
        target: "xyz",
        localPath: "/tmp/sandbox-agent.js",
        remotePath: "~/.pi/agent/remote-runtime/sandbox-agent.js",
      }),
    ).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "/tmp/sandbox-agent.js",
      "xyz:~/.pi/agent/remote-runtime/sandbox-agent.js",
    ]);
  });

  it("builds lsof args that only match listening tunnels on one port", () => {
    expect(buildLsofListenPidsArgs(3430)).toEqual([
      "-n",
      "-P",
      "-t",
      "-iTCP:3430",
      "-sTCP:LISTEN",
    ]);
  });

  it("encodes remote instance ids for per-connection bridge directories", () => {
    expect(encodeRemoteInstanceId("user/a:b c")).toBe("user_a_b_c");
    expect(encodeRemoteInstanceId("")).toBe("default");
  });

  it("builds a lightweight remote bridge start command", () => {
    const command = buildRemoteStartCommand({
      target: "xyz",
      localBasePort: 3300,
      remoteBridgePort: 3101,
      remoteProjectPath: "/home/me/project",
      remoteAgentDir: "~/.pi/agent/remote-runtime",
      remotePiCliPath: "pi",
      remoteNodePath: "node",
      remotePiAgentDir: "~/.pi/agent",
      childNodeOptions: "--max-old-space-size=1024",
      bootstrapPiPackage: true,
      localPiPackagePath: "/tmp/pi-coding-agent",
      remoteShell: "zsh -lc",
    });

    expect(command).toContain('mkdir -p "${HOME}/.pi/agent/remote-runtime" \'/home/me/project\'');
    expect(command).toContain("PI_CHILD_NODE_OPTIONS='--max-old-space-size=1024'");
    expect(command).toContain('PI_CODING_AGENT_DIR="${HOME}/.pi/agent"');
    expect(command).toContain('\'node\' "${HOME}/.pi/agent/remote-runtime/sandbox-agent.js"');
    expect(command).toContain("--port=3101");
    expect(command).toContain("--cli-path='pi'");
    expect(command).toContain("--cwd='/home/me/project'");
    expect(command).toContain('>"${HOME}/.pi/agent/remote-runtime/bridge.log" 2>&1 &');
  });

  it("expands bootstrapped remote cli paths before starting the bridge", () => {
    const command = buildRemoteStartCommand({
      target: "xyz",
      localBasePort: 3300,
      remoteBridgePort: 3101,
      remoteProjectPath: "/home/me/project",
      remoteAgentDir: "~/.pi/agent/remote-runtime",
      remotePiCliPath: "~/.pi/agent/remote-runtime/pi-coding-agent/dist/cli.js",
      remoteNodePath: "node",
      childNodeOptions: "--max-old-space-size=1024",
      bootstrapPiPackage: true,
      localPiPackagePath: "/tmp/pi-coding-agent",
      remoteShell: "zsh -lc",
    });

    expect(command).toContain(
      '--cli-path="${HOME}/.pi/agent/remote-runtime/pi-coding-agent/dist/cli.js"',
    );
    expect(command).not.toContain("--cli-path='~/.pi");
  });

  it("discovers sibling yalc packages needed by the remote bootstrap", () => {
    const names = getLocalScopePackageNames(".yalc/@dyyz1993/pi-coding-agent");

    expect(names).toEqual(
      expect.arrayContaining(["pi-agent-core", "pi-ai", "pi-tui"]),
    );
    expect(names).not.toContain("pi-coding-agent");
  });

  it("builds versioned remote child paths from the local binary hash", () => {
    expect(
      buildRemoteChildPaths({
        remoteRuntimeDir: "~/.pi/agent/remote-runtime/child",
        localBinaryPath: "/tmp/pi remote child",
        sha256: "abcdef0123456789ffffffffffffffffffffffffffffffffffffffffffffffff",
        binaryName: "pi remote",
      }),
    ).toEqual({
      remoteVersionDir: "~/.pi/agent/remote-runtime/child/children/abcdef0123456789",
      remoteBinaryPath: "~/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi_remote",
      remoteHashPath:
        "~/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi_remote.sha256",
      remoteUploadPath:
        "~/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi_remote.uploading",
    });
  });

  it("builds remote child ready and install commands", () => {
    const paths = buildRemoteChildPaths({
      remoteRuntimeDir: "~/.pi/agent/remote-runtime/child",
      localBinaryPath: "/tmp/pi",
      sha256: "abcdef0123456789",
      binaryName: "pi",
    });

    expect(buildRemoteChildReadyCommand({ ...paths, sha256: "abcdef0123456789" })).toBe(
      'test -x "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi" && test "$(cat "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi.sha256" 2>/dev/null || true)" = \'abcdef0123456789\'',
    );
    expect(buildRemoteChildInstallCommand({ ...paths, sha256: "abcdef0123456789" })).toBe(
      'mkdir -p "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789" && mv "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi.uploading" "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi" && chmod 755 "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi" && printf %s \'abcdef0123456789\' > "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/pi.sha256"',
    );
  });

  it("includes the extension directory in remote child readiness when extensions are uploaded", () => {
    const paths = buildRemoteChildPaths({
      remoteRuntimeDir: "~/.pi/agent/remote-runtime/child",
      localBinaryPath: "/tmp/pi",
      sha256: "abcdef0123456789",
      binaryName: "pi",
    });
    const remoteExtensionsDir = buildRemoteChildExtensionsDir(paths.remoteVersionDir);

    expect(
      buildRemoteChildReadyCommand({
        ...paths,
        remoteExtensionsDir,
        sha256: "abcdef0123456789",
      }),
    ).toContain(
      'test -d "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/extensions"',
    );
    expect(
      buildRemoteChildInstallExtensionsCommand({
        remoteExtensionsDir,
        remoteExtensionsTarball: `${paths.remoteVersionDir}/extensions.tgz`,
      }),
    ).toBe(
      'rm -rf "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/extensions" && mkdir -p "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/extensions" && tar xzf "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/extensions.tgz" -C "${HOME}/.pi/agent/remote-runtime/child/children/abcdef0123456789/extensions"',
    );
  });
});
