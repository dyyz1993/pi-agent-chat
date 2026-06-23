import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface DetectedSshHost {
  host: string;
  name: string;
  source: string;
  hostName?: string;
  user?: string;
  port?: string;
  identityFile?: string;
}

function isConcreteHost(pattern: string): boolean {
  return pattern.length > 0 && !pattern.includes("*") && !pattern.includes("?");
}

function stripInlineComment(line: string): string {
  const hashIndex = line.search(/\s#/);
  return hashIndex >= 0 ? line.slice(0, hashIndex) : line;
}

export function parseSshConfigHosts(raw: string, source = "~/.ssh/config"): DetectedSshHost[] {
  const hosts: DetectedSshHost[] = [];
  const seen = new Set<string>();
  let currentHosts: DetectedSshHost[] = [];

  for (const originalLine of raw.split(/\r?\n/)) {
    const line = stripInlineComment(originalLine).trim();
    if (!line || line.startsWith("#")) continue;

    const hostMatch = /^Host\s+(.+)$/i.exec(line);
    if (hostMatch) {
      currentHosts = [];
      for (const token of hostMatch[1].split(/\s+/)) {
        const host = token.trim();
        if (!isConcreteHost(host) || seen.has(host)) continue;
        seen.add(host);
        const entry = { host, name: host, source };
        hosts.push(entry);
        currentHosts.push(entry);
      }
      continue;
    }

    if (currentHosts.length === 0) continue;
    const optionMatch = /^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/.exec(line);
    if (!optionMatch) continue;

    const key = optionMatch[1].toLowerCase();
    const value = optionMatch[2].trim();
    for (const entry of currentHosts) {
      if (key === "hostname") entry.hostName = value;
      if (key === "user") entry.user = value;
      if (key === "port") entry.port = value;
      if (key === "identityfile") {
        entry.identityFile = value.replace(/^~(?=\/)/, homedir());
      }
    }
  }

  return hosts;
}

export async function listDetectedSshHosts(configPath = join(homedir(), ".ssh", "config")) {
  try {
    const raw = await readFile(configPath, "utf-8");
    return parseSshConfigHosts(raw, "~/.ssh/config");
  } catch {
    return [];
  }
}
