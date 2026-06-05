const DEFAULT_CALL_TIMEOUT = 30_000;
export class ClientChannel {
    raw;
    constructor(raw) {
        this.raw = raw;
    }
    call(method, params, timeoutMs = DEFAULT_CALL_TIMEOUT) {
        return this.raw.call(method, params, timeoutMs);
    }
    on(_event, handler) {
        return this.raw.onReceive(handler);
    }
    get raw_() {
        return this.raw;
    }
}
//# sourceMappingURL=client-channel.js.map