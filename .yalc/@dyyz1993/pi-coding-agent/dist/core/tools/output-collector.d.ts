import { type TruncationResult } from "./truncate.ts";
export declare class OutputCollector {
    private chunks;
    private chunksBytes;
    private totalBytes;
    private tempFilePath;
    private tempFileStream;
    private readonly maxChunksBytes;
    private readonly maxBytes;
    constructor(options?: {
        maxBytes?: number;
        maxChunksBytes?: number;
    });
    push(data: Buffer): void;
    getBufferedText(): string;
    getTruncation(): TruncationResult;
    finalize(): TruncationResult;
    close(): void;
    get fullOutputPath(): string | undefined;
    get totalBytesWritten(): number;
    private ensureTempFile;
}
//# sourceMappingURL=output-collector.d.ts.map