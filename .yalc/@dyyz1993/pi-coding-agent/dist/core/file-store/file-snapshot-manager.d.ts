import type { SessionEntry } from "../session-manager.ts";
import type { InternalGit } from "./internal-git.ts";
export interface StepSnapshotData {
    baselineTreeHash: string | null;
    snapshotTreeHash: string;
    diff: {
        added: string[];
        modified: string[];
        deleted: string[];
    } | null;
    turnIndex: number;
}
export interface ModifiedFileInfo {
    path: string;
    status: "added" | "modified" | "deleted";
    turnIndex: number;
    entryId: string;
}
export interface FileDiffInfo {
    path: string;
    oldContent: string | null;
    newContent: string | null;
    oldHash: string | null;
    newHash: string | null;
    unifiedDiff: string;
}
export interface RestoreResult {
    restored: string[];
    deleted: string[];
    skipped: string[];
    dirty: string[];
    forceRestored: string[];
}
export interface BatchDiffResult {
    files: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        diff: FileDiffInfo | null;
    }>;
    summary: {
        totalFiles: number;
        added: number;
        modified: number;
        deleted: number;
    };
}
export interface FileHistoryEntry {
    entryId: string;
    turnIndex: number;
    timestamp: string;
    status: "added" | "modified" | "deleted";
    snapshotHash: string;
    previousHash: string | null;
}
export interface LiveChange {
    path: string;
    status: "added" | "modified" | "deleted";
    diff: {
        oldContent: string | null;
        newContent: string | null;
    } | null;
}
export declare class FileSnapshotManager {
    private readonly git;
    private sessionStartTreeHash;
    private lastCommittedTreeHash;
    private turnIndex;
    private snapshotIndex;
    private turnIndexMap;
    constructor(git: InternalGit);
    initialize(cwd: string): void;
    getLiveChanges(cwd: string): LiveChange[];
    onTurnEnd(cwd: string, turnIndex: number, appendEntry: (type: string, data: unknown) => string): void;
    rebuildIndex(entries: SessionEntry[], leafId?: string | null): void;
    getLatestSnapshotOnPath(entries: SessionEntry[], leafId: string | null): StepSnapshotData | null;
    /**
     * Get the snapshot data for a specific entry ID.
     * Returns null if no snapshot was recorded for the given entry.
     */
    getSnapshotAtEntry(entryId: string): StepSnapshotData | null;
    resolveSnapshotEntryIdForTarget(targetEntryId: string, entries: SessionEntry[]): string | null;
    private resolveTargetTreeHash;
    getRollbackPreviewFiles(options: {
        targetEntryId: string;
        entries: SessionEntry[];
    }): ModifiedFileInfo[];
    getModifiedFiles(options?: {
        fromEntryId?: string;
        toEntryId?: string;
        toTurnIndex?: number;
        fromTurnIndex?: number;
    }): ModifiedFileInfo[];
    getFileDiff(options: {
        filePath: string;
        fromEntryId?: string;
        toEntryId?: string;
        useBaselineHash?: boolean;
    }): FileDiffInfo | null;
    getBatchDiffs(options?: {
        fromEntryId?: string;
        toEntryId?: string;
    }): BatchDiffResult;
    getFileHistory(options: {
        filePath: string;
    }): FileHistoryEntry[];
    restoreFiles(cwd: string, options: {
        targetEntryId?: string;
        snapshotHash?: string;
        files?: string[];
        preview?: boolean;
        currentLeafId?: string | null;
        entries: SessionEntry[];
        appendEntry?: (type: string, data: unknown) => void;
    }): Promise<RestoreResult>;
    private findDirtyFiles;
    private parseTreeEntriesFromHash;
    getActiveTreeHashes(): Set<string>;
    private readTree;
}
//# sourceMappingURL=file-snapshot-manager.d.ts.map