import type { Channel } from "./channel-types.ts";
export interface ChannelContract {
    methods?: Record<string, {
        params: unknown;
        return: unknown;
    }>;
    events?: Record<string, unknown>;
}
type MethodKeys<T extends ChannelContract> = keyof NonNullable<T["methods"]> & string;
type MethodParams<T extends ChannelContract, K extends MethodKeys<T>> = NonNullable<T["methods"]>[K] extends {
    params: infer P;
} ? P : unknown;
type MethodReturn<T extends ChannelContract, K extends MethodKeys<T>> = NonNullable<T["methods"]>[K] extends {
    return: infer R;
} ? R : unknown;
type EventKeys<T extends ChannelContract> = keyof NonNullable<T["events"]> & string;
type EventData<T extends ChannelContract, K extends EventKeys<T>> = NonNullable<T["events"]>[K];
export declare class ServerChannel<T extends ChannelContract = ChannelContract> {
    private raw;
    private methodHandlers;
    constructor(raw: Channel);
    handle<K extends MethodKeys<T>>(method: K, fn: (params: MethodParams<T, K>) => MethodReturn<T, K> | Promise<MethodReturn<T, K>>): void;
    emit<K extends EventKeys<T>>(_event: K, data: EventData<T, K>): void;
    get raw_(): Channel;
}
export type { MethodKeys, MethodParams, MethodReturn, EventKeys, EventData };
//# sourceMappingURL=server-channel.d.ts.map