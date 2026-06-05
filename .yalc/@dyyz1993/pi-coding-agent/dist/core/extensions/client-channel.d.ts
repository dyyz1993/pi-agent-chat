import type { Channel } from "./channel-types.ts";
import type { ChannelContract, EventData, EventKeys, MethodKeys, MethodParams, MethodReturn } from "./server-channel.ts";
export type { ChannelContract, EventData, EventKeys, MethodKeys, MethodParams, MethodReturn, } from "./server-channel.ts";
export declare class ClientChannel<T extends ChannelContract = ChannelContract> {
    private raw;
    constructor(raw: Channel);
    call<K extends MethodKeys<T>>(method: K, params: MethodParams<T, K>, timeoutMs?: number): Promise<MethodReturn<T, K>>;
    on<K extends EventKeys<T>>(_event: K, handler: (data: EventData<T, K>) => void): () => void;
    get raw_(): Channel;
}
//# sourceMappingURL=client-channel.d.ts.map