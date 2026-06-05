export class McpLogger {
    minLevel;
    levels = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    };
    constructor(minLevel = "info") {
        this.minLevel = minLevel;
    }
    debug(server, msg, ...args) {
        this.log("debug", server, msg, ...args);
    }
    info(server, msg, ...args) {
        this.log("info", server, msg, ...args);
    }
    warn(server, msg, ...args) {
        this.log("warn", server, msg, ...args);
    }
    error(server, msg, ...args) {
        this.log("error", server, msg, ...args);
    }
    log(level, server, msg, ...args) {
        if (this.levels[level] < this.levels[this.minLevel])
            return;
        const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
        fn(`[mcp:${level}] [${server}] ${msg}`, ...args);
    }
}
//# sourceMappingURL=logger.js.map