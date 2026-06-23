import { describe, expect, it } from "vitest";
import { homedir } from "os";
import { parseSshConfigHosts } from "../../../src/shared/lib/ssh-config";

describe("parseSshConfigHosts", () => {
  it("extracts concrete host aliases from ssh config", () => {
    const hosts = parseSshConfigHosts(
      `
Host xyz-mac prod-box
  HostName 192.168.1.10
  User xyz
  Port 2222
  IdentityFile ~/.ssh/id_rsa

Host *
  ForwardAgent no

Host github-* *.internal
  User git

Host staging # inline comment
  HostName staging.example.com
`,
      "fixture",
    );

    expect(hosts).toEqual([
      {
        host: "xyz-mac",
        name: "xyz-mac",
        source: "fixture",
        hostName: "192.168.1.10",
        user: "xyz",
        port: "2222",
        identityFile: `${homedir()}/.ssh/id_rsa`,
      },
      {
        host: "prod-box",
        name: "prod-box",
        source: "fixture",
        hostName: "192.168.1.10",
        user: "xyz",
        port: "2222",
        identityFile: `${homedir()}/.ssh/id_rsa`,
      },
      { host: "staging", name: "staging", source: "fixture", hostName: "staging.example.com" },
    ]);
  });

  it("deduplicates aliases and ignores comments", () => {
    const hosts = parseSshConfigHosts(`
# Host ignored
Host dev
Host dev other
`);

    expect(hosts.map((host) => host.host)).toEqual(["dev", "other"]);
  });
});
