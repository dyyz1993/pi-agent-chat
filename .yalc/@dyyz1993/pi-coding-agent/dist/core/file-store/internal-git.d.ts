export interface TreeEntry {
    path: string;
    hash: string;
}
export interface StepDiff {
    added: string[];
    modified: string[];
    deleted: string[];
}
export interface TreeSnapshot {
    treeHash: string;
    entries: Map<string, TreeEntry>;
}
export interface ObjectMetadata {
    hash: string;
    size: number;
    createdAt: number;
    accessedAt: number;
    type: "file" | "tree";
}
export interface GCResult {
    deletedObjects: number;
    freedBytes: number;
    deletedHashes: string[];
}
export declare function computeProjectHash(projectRoot: string): string;
export declare class InternalGit {
    private readonly objectsDir;
    private readonly metadataDir;
    constructor(storeDir: string);
    writeObject(content: string, type?: "file" | "tree"): string;
    private saveMetadata;
    private updateAccessTime;
    private loadMetadata;
    private deleteMetadata;
    private deleteObject;
    readObject(hash: string): string;
    hasObject(hash: string): boolean;
    scanWorkingDir(cwd: string): Map<string, string>;
    private scanDir;
    writeTree(files: Map<string, string>): TreeSnapshot;
    readTree(treeHash: string): Map<string, string> | null;
    computeDiff(oldEntries: Map<string, TreeEntry>, newEntries: Map<string, TreeEntry>): StepDiff;
    diffTrees(baselineHash: string, snapshotHash: string): StepDiff;
    private parseTreeEntries;
    hashContent(content: string): string;
    gc(activeTreeHashes: Set<string>): Promise<GCResult>;
    scanAllObjects(): ObjectMetadata[];
    pruneOldObjects(maxAgeMs?: number, activeTreeHashes?: Set<string>): Promise<GCResult>;
    getStoreSize(): number;
    enforceLimit(maxBytes?: number, activeTreeHashes?: Set<string>): Promise<GCResult>;
    getStats(): {
        totalObjects: number;
        totalBytes: number;
        treeObjects: number;
        fileObjects: number;
    };
    rm(path: string): void;
    static createForProject(storeRoot: string, projectRoot: string): InternalGit;
}
//# sourceMappingURL=internal-git.d.ts.map