import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, _options: HandlerOptions): void {
	const r = <K extends keyof RPCMethods & string>(
		method: K,
		handler: (params: P<K>) => Promise<R<K>>,
	) => {
		server.register(method, handler as (params: unknown) => Promise<unknown>);
	};

	r("rules.list", async () => {
		return { rules: [], totalRules: 0 };
	});
}
