import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

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
		if (!pm) {
			log.warn("requestSnapshot: no processManager");
			return emptySnapshot();
		}

		const sid =
			params && typeof params === "object" && "sessionId" in params
				? String((params as Record<string, unknown>).sessionId)
				: "";

		if (!sid) {
			log.warn("requestSnapshot: no sessionId");
			return emptySnapshot();
		}

		if (!pm.hasSession(sid)) {
			log.warn("requestSnapshot: no active session", { sid });
			return emptySnapshot();
		}

		let cwd: string | undefined;
		try {
			cwd = pm.getProjectPath(sid);
		} catch (err) { log.debug("getProjectPath failed:", { err: String(err) }) }

		try {
			const result = await Promise.race([
				pm.callChannel(sid, "rules-engine", "getSnapshot", { cwd: cwd ?? "" }),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
			]);

			if (result && typeof result === "object" && "type" in result && (result as Record<string, unknown>).type === "snapshot") {
				const snap = result as RulesSnapshot;
				log.info("requestSnapshot: got snapshot", { sid, totalRules: snap.totalRules });
				return snap;
			}
			log.warn("requestSnapshot: channel call returned no valid result", { sid });
		} catch (err) {
			log.warn("requestSnapshot: channel call failed", { sid, err: String(err) });
		}

		return emptySnapshot();
	});
}
