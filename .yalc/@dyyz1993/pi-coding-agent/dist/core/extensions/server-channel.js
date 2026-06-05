export class ServerChannel {
    raw;
    methodHandlers = new Map();
    constructor(raw) {
        this.raw = raw;
        this.raw.onReceive((data) => {
            const msg = data;
            if (!("__call" in msg))
                return;
            const method = msg.__call;
            const handler = this.methodHandlers.get(method);
            if (!handler)
                return;
            const { invokeId, ...paramsWithCall } = msg;
            delete paramsWithCall.__call;
            const result = handler(paramsWithCall);
            const sendResponse = (res) => {
                if (!invokeId)
                    return;
                if (Array.isArray(res)) {
                    this.raw.send({ result: res, invokeId });
                }
                else {
                    this.raw.send({ ...(res ?? {}), invokeId });
                }
            };
            if (result instanceof Promise) {
                result.then(sendResponse);
            }
            else {
                sendResponse(result);
            }
        });
    }
    handle(method, fn) {
        this.methodHandlers.set(method, fn);
    }
    emit(_event, data) {
        this.raw.send(data);
    }
    get raw_() {
        return this.raw;
    }
}
//# sourceMappingURL=server-channel.js.map