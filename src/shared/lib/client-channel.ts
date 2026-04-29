export interface ChannelContract {
	methods?: Record<string, { params: unknown; return: unknown }>;
	events?: Record<string, unknown>;
}

type MethodKeys<T extends ChannelContract> = T["methods"] extends Record<string, unknown>
	? keyof T["methods"] & string
	: string;

type MethodParams<T extends ChannelContract, K extends string> = T["methods"] extends Record<string, infer M>
	? K extends keyof M
		? M[K] extends { params: infer P }
			? P
			: unknown
		: unknown
	: unknown;

type MethodReturn<T extends ChannelContract, K extends string> = T["methods"] extends Record<string, infer M>
	? K extends keyof M
		? M[K] extends { return: infer R }
			? R
			: unknown
		: unknown
	: unknown;

export class ClientChannel<T extends ChannelContract = ChannelContract> {
	private invokeFn: (data: unknown) => Promise<unknown>;

	constructor(invokeFn: (data: unknown) => Promise<unknown>) {
		this.invokeFn = invokeFn;
	}

	async call<K extends MethodKeys<T>>(method: K, params: MethodParams<T, K>): Promise<MethodReturn<T, K>> {
		const payload = { ...(params as Record<string, unknown>), __call: method };
		return this.invokeFn(payload) as Promise<MethodReturn<T, K>>;
	}
}
