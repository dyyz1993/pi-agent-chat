import { ClientChannel } from "./client-channel.js";
import { ServerChannel } from "./server-channel.js";
export function defineChannel() {
    return {
        create(raw) {
            return {
                server: new ServerChannel(raw),
                client: new ClientChannel(raw),
            };
        },
    };
}
export function createTypedChannel(raw) {
    return {
        server: new ServerChannel(raw),
        client: new ClientChannel(raw),
    };
}
//# sourceMappingURL=channel-factory.js.map