import type { Channel, ChannelDataMessage, ChannelOutputFn } from "./channel-types.ts";
export declare class ChannelManager {
    private channels;
    private outputFn;
    constructor(outputFn: ChannelOutputFn);
    register(name: string): Channel;
    handleInbound(message: ChannelDataMessage): void;
    has(name: string): boolean;
    unregister(name: string): void;
}
//# sourceMappingURL=channel-manager.d.ts.map