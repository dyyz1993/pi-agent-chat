import type { RPCServer } from "@dyyz1993/rpc-core";
import { ClientChannel } from "../lib/client-channel";
import type { HandlerOptions } from "../rpc-schema";
import { getProcessManager } from "./agent";

interface RulesSnapshot {
	type: "snapshot";
	rules: unknown[];
	injectedRuleNames: string[];
	totalRules: number;
	unconditionalCount: number;
	conditionalCount: number;
	matchHistory: unknown[];
	lifecycleLog: unknown[];
	loadedAt: number;
	cacheTTL: number;
}

interface RulesChannelContract {
	methods: {
		"rules.getSnapshot": {
			params: { cwd?: string };
			return: RulesSnapshot;
		};
	};
	events: Record<string, unknown>;
}

function emptySnapshot(): RulesSnapshot {
	return {
		type: "snapshot",
		rules: [],
		injectedRuleNames: [],
		totalRules: 0,
		unconditionalCount: 0,
		conditionalCount: 0,
		matchHistory: [],
		lifecycleLog: [],
		loadedAt: Date.now(),
		cacheTTL: 30000,
	};
}

export function register(server: RPCServer, _options: HandlerOptions): void {
	server.register("rules.list", async () => ({ rules: [], totalRules: 0 }));

	server.register("rules.requestSnapshot", async (params: unknown) => {
		const pm = getProcessManager();
		if (!pm?.sendChannelMessage) return emptySnapshot();

		const sid =
			params && typeof params === "object" && "sessionId" in params
				? String((params as Record<string, unknown>).sessionId)
				: "";

		if (!sid) return emptySnapshot();

		let cwd: string | undefined;
		try {
			const managed = (pm as unknown as { clients: Map<string, { info: { projectPath: string } }> }).clients.get(sid);
			if (managed?.info?.projectPath) cwd = managed.info.projectPath;
		} catch {}

		const hasActiveSession = (() => {
			try {
				const clients = (pm as unknown as { clients: Map<string, unknown> }).clients;
				return clients?.has(sid) ?? false;
			} catch {
				return false;
			}
		})();

		if (!hasActiveSession) return emptySnapshot();

		try {
			const channel = new ClientChannel<RulesChannelContract>((data) =>
				pm.sendChannelMessage!(sid, "rules-engine", data),
			);

			const result = await Promise.race([
			channel.call("rules.getSnapshot", { cwd }),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
			]);

			if (result && typeof result === "object" && "type" in result && result.type === "snapshot") {
				return result;
			}
		} catch {}

		return emptySnapshot();
	});
}
