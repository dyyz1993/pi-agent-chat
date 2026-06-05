import type { Channel } from "./channel-types.ts";
import { ClientChannel } from "./client-channel.ts";
import type { ChannelContract } from "./server-channel.ts";
import { ServerChannel } from "./server-channel.ts";
export interface TypedChannel<T extends ChannelContract = ChannelContract> {
    server: ServerChannel<T>;
    client: ClientChannel<T>;
}
export declare function defineChannel<T extends ChannelContract>(): {
    create(raw: Channel): TypedChannel<T>;
};
export declare function createTypedChannel<T extends ChannelContract>(raw: Channel): TypedChannel<T>;
//# sourceMappingURL=channel-factory.d.ts.map