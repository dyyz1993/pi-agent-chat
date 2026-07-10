import type { R } from "../rpc-schema";

export interface RemoteSshConfigureConfig {
  enabled?: boolean;
  host?: string;
  remoteCwd?: string;
  sshArgs?: string[];
  shell?: string;
  persist?: boolean;
}

interface EnsureRemoteSshConfigureOptions {
  sessionId: string;
  config: RemoteSshConfigureConfig;
  force?: boolean;
  configure: () => Promise<R<"agent.remoteSshConfigure">>;
}

function normalizeSshArgs(sshArgs: string[] | undefined): string[] {
  return Array.isArray(sshArgs) ? [...sshArgs] : [];
}

export function getRemoteSshConfigureFingerprint(config: RemoteSshConfigureConfig): string {
  return JSON.stringify({
    enabled: config.enabled === true,
    host: config.host ?? "",
    remoteCwd: config.remoteCwd ?? "",
    sshArgs: normalizeSshArgs(config.sshArgs),
    shell: config.shell ?? "",
    persist: config.persist === true,
  });
}

export class RemoteSshConfigureGuard {
  private readonly configuredBySession = new Map<string, string>();
  private readonly inFlightByKey = new Map<string, Promise<R<"agent.remoteSshConfigure">>>();

  async ensure(
    options: EnsureRemoteSshConfigureOptions,
  ): Promise<{ result: R<"agent.remoteSshConfigure"> | null; skipped: boolean; joined: boolean }> {
    const fingerprint = getRemoteSshConfigureFingerprint(options.config);
    if (!options.force && this.configuredBySession.get(options.sessionId) === fingerprint) {
      return { result: null, skipped: true, joined: false };
    }

    const inFlightKey = `${options.sessionId}\0${fingerprint}`;
    const inFlight = this.inFlightByKey.get(inFlightKey);
    if (inFlight) {
      const result = await inFlight;
      return { result, skipped: false, joined: true };
    }

    const configurePromise = options.configure();
    this.inFlightByKey.set(inFlightKey, configurePromise);
    try {
      const result = await configurePromise;
      if (result.ok) {
        this.configuredBySession.set(options.sessionId, fingerprint);
      }
      return { result, skipped: false, joined: false };
    } finally {
      if (this.inFlightByKey.get(inFlightKey) === configurePromise) {
        this.inFlightByKey.delete(inFlightKey);
      }
    }
  }

  markConfigured(sessionId: string, config: RemoteSshConfigureConfig): void {
    this.configuredBySession.set(sessionId, getRemoteSshConfigureFingerprint(config));
  }

  invalidateSession(sessionId: string): void {
    this.configuredBySession.delete(sessionId);
  }
}
