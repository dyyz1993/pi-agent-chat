import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, truncateTail } from "./truncate.js";
export class OutputCollector {
    chunks = [];
    chunksBytes = 0;
    totalBytes = 0;
    tempFilePath;
    tempFileStream;
    maxChunksBytes;
    maxBytes;
    constructor(options) {
        this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
        this.maxChunksBytes = options?.maxChunksBytes ?? this.maxBytes * 2;
    }
    push(data) {
        this.totalBytes += data.length;
        if (this.totalBytes > this.maxBytes)
            this.ensureTempFile();
        if (this.tempFileStream)
            this.tempFileStream.write(data);
        this.chunks.push(data);
        this.chunksBytes += data.length;
        while (this.chunksBytes > this.maxChunksBytes && this.chunks.length > 1) {
            const removed = this.chunks.shift();
            if (!removed)
                break;
            this.chunksBytes -= removed.length;
        }
    }
    getBufferedText() {
        return Buffer.concat(this.chunks).toString("utf-8");
    }
    getTruncation() {
        const fullText = this.getBufferedText();
        const result = truncateTail(fullText);
        if (result.truncated)
            this.ensureTempFile();
        return result;
    }
    finalize() {
        const truncation = this.getTruncation();
        this.close();
        return truncation;
    }
    close() {
        this.tempFileStream?.end();
    }
    get fullOutputPath() {
        return this.tempFilePath;
    }
    get totalBytesWritten() {
        return this.totalBytes;
    }
    ensureTempFile() {
        if (this.tempFilePath)
            return;
        const id = randomBytes(8).toString("hex");
        this.tempFilePath = join(tmpdir(), `pi-bash-${id}.log`);
        this.tempFileStream = createWriteStream(this.tempFilePath);
        for (const chunk of this.chunks)
            this.tempFileStream.write(chunk);
    }
}
//# sourceMappingURL=output-collector.js.map