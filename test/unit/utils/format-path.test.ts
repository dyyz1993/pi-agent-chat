import { afterEach, describe, expect, it } from "vitest";
import {
  formatFilePath,
  formatPathLikeText,
  formatToolHeaderPath,
} from "../../../src/mainview/lib/format-path";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

describe("formatFilePath", () => {
  afterEach(() => {
    useSessionStore.setState({
      activeProjectId: null,
      projectTabs: [],
    });
  });

  it("removes trailing separators from non-root file paths", () => {
    expect(
      formatFilePath("/Users/xyz/Projects/44444/demo.html/", {
        projectRoot: "",
      }),
    ).toBe("/Users/xyz/Projects/44444/demo.html");
  });

  it("keeps root paths intact", () => {
    expect(formatFilePath("/", { projectRoot: "" })).toBe("/");
    expect(formatFilePath("C:/", { projectRoot: "" })).toBe("C:/");
  });

  it("truncates from the front on path segment boundaries", () => {
    expect(
      formatFilePath("/Users/xyz/Projects/44444/demo.html", {
        projectRoot: "",
        maxLen: 24,
      }),
    ).toBe("…/44444/demo.html");
  });

  it("falls back to the basename when parent segments do not fit", () => {
    expect(
      formatFilePath("/Users/xyz/Projects/44444/demo.html", {
        projectRoot: "",
        maxLen: 14,
      }),
    ).toBe("…/demo.html");
  });

  it("only truncates inside a segment when the basename itself is too long", () => {
    expect(
      formatFilePath("/Users/xyz/Projects/44444/very-long-demo-file-name.html", {
        projectRoot: "",
        maxLen: 20,
      }),
    ).toBe("…demo-file-name.html");
  });

  it("formats tool header paths before CSS truncation", () => {
    expect(formatToolHeaderPath("/Users/xyz/Projects/44444/demo.html/")).toBe(
      "/Users/xyz/Projects/44444/demo.html",
    );
  });

  it("formats remote absolute paths relative to the remote project root", () => {
    expect(
      formatFilePath("/Users/xyz/Projects/44444/demo.html/", {
        projectRoot: [
          "/Users/xyz/Projects/44444",
          "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-3d69674016199bff",
        ],
      }),
    ).toBe("demo.html");
  });

  it("uses the active remote tab path as the tool header root", () => {
    useSessionStore.setState({
      activeProjectId: "remote-44444",
      projectTabs: [
        {
          id: "remote-44444",
          name: "44444",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-3d69674016199bff",
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            sshRuntimeKind: "remote-agent-child",
            profileId: "ssh-profile",
            host: "xyz-mac",
            remotePath: "/Users/xyz/Projects/44444",
            localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-3d69674016199bff",
          },
        },
      ],
    });

    expect(formatToolHeaderPath("/Users/xyz/Projects/44444/demo.html/")).toBe("demo.html");
  });

  it("matches remote paths from other open tabs when the active tab is different", () => {
    useSessionStore.setState({
      activeProjectId: "remote-22222",
      projectTabs: [
        {
          id: "remote-22222",
          name: "22222",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-333aa261e9de819b",
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            sshRuntimeKind: "ssh-command",
            profileId: "ssh-profile",
            host: "xyz-mac",
            remotePath: "/Users/xyz/Projects/22222",
            localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-333aa261e9de819b",
          },
        },
        {
          id: "remote-44444",
          name: "44444",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-3d69674016199bff",
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            sshRuntimeKind: "remote-agent-child",
            profileId: "ssh-profile",
            host: "xyz-mac",
            remotePath: "/Users/xyz/Projects/44444",
            localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-3d69674016199bff",
          },
        },
      ],
    });

    expect(formatToolHeaderPath("/Users/xyz/Projects/44444/demo.html/")).toBe("demo.html");
  });


  it("normalizes path-like text from historic tool descriptions", () => {
    expect(formatPathLikeText("Users/xyz/Projects/44444/demo.html/")).toBe(
      "Users/xyz/Projects/44444/demo.html",
    );
  });

  it("does not treat provider model ids as paths", () => {
    expect(formatPathLikeText("opencode-go/deepseek-v4-flash")).toBe(
      "opencode-go/deepseek-v4-flash",
    );
  });
});
