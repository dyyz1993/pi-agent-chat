import { randomUUID } from "node:crypto";
const DEFAULT_INVOKE_TIMEOUT = 30_000;
export class ChannelManager {
    channels = new Map();
    outputFn;
    constructor(outputFn) {
        this.outputFn = outputFn;
    }
    register(name) {
        if (this.channels.has(name)) {
            throw new Error(`Channel "${name}" is already registered`);
        }
        const entry = {
            name,
            handlers: new Set(),
            pendingInvokes: new Map(),
        };
        this.channels.set(name, entry);
        const invokeImpl = (data, timeoutMs = DEFAULT_INVOKE_TIMEOUT) => {
            return new Promise((resolve, reject) => {
                const invokeId = `inv_${randomUUID().slice(0, 8)}`;
                const timer = setTimeout(() => {
                    entry.pendingInvokes.delete(invokeId);
                    reject(new Error(`Channel invoke "${name}" timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                entry.pendingInvokes.set(invokeId, { resolve, reject, timer });
                this.outputFn({
                    type: "channel_data",
                    name,
                    data: { ...(data ?? {}), invokeId },
                });
            });
        };
        return {
            name,
            send: (data) => {
                this.outputFn({ type: "channel_data", name, data });
            },
            onReceive: (handler) => {
                entry.handlers.add(handler);
                return () => {
                    entry.handlers.delete(handler);
                };
            },
            invoke: invokeImpl,
            call: (method, params, timeoutMs) => {
                const payload = { ...params, __call: method };
                return invokeImpl(payload, timeoutMs ?? DEFAULT_INVOKE_TIMEOUT);
            },
        };
    }
    handleInbound(message) {
        const entry = this.channels.get(message.name);
        if (!entry)
            return;
        const data = message.data;
        if (data && typeof data === "object" && typeof data.invokeId === "string") {
            const pending = entry.pendingInvokes.get(data.invokeId);
            if (pending) {
                clearTimeout(pending.timer);
                entry.pendingInvokes.delete(data.invokeId);
                pending.resolve(data);
                return;
            }
        }
        for (const handler of entry.handlers) {
            try {
                handler(message.data);
            }
            catch {
                // Ignore channel handler errors so one subscriber cannot break delivery.
            }
        }
    }
    has(name) {
        return this.channels.has(name);
    }
    unregister(name) {
        const entry = this.channels.get(name);
        if (!entry)
            return;
        for (const [, pending] of entry.pendingInvokes) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`Channel "${name}" was unregistered`));
        }
        this.channels.delete(name);
    }
}
//# sourceMappingURL=channel-manager.js.map