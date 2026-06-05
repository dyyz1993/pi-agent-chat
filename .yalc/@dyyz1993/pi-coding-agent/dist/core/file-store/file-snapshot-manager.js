import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const FILE_SIZE_LIMIT = 1024 * 1024;
function readFilteredWorkingDir(git, cwd) {
    const all = git.scanWorkingDir(cwd);
    const filtered = new Map();
    for (const [path, content] of all) {
        if (content.length <= FILE_SIZE_LIMIT) {
            filtered.set(path, content);
        }
    }
    return filtered;
}
function generateUnifiedDiff(oldContent, newContent, filePath) {
    const oldLines = oldContent === null ? [] : oldContent.split("\n");
    const newLines = newContent === null ? [] : newContent.split("\n");
    const hunks = [];
    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
        if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
            i++;
            j++;
            continue;
        }
        const oldStart = i;
        const newStart = j;
        const contextStart = Math.max(0, oldStart - 2);
        const lines = [];
        for (let c = contextStart; c < oldStart; c++) {
            lines.push(` ${oldLines[c]}`);
        }
        let changed = 0;
        while ((i < oldLines.length || j < newLines.length) && changed < 8) {
            if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
                break;
            }
            if (i < oldLines.length) {
                lines.push(`-${oldLines[i]}`);
                i++;
            }
            if (j < newLines.length) {
                lines.push(`+${newLines[j]}`);
                j++;
            }
            changed++;
        }
        for (let c = j; c < Math.min(newLines.length, j + 2); c++) {
            lines.push(` ${newLines[c]}`);
        }
        hunks.push(`@@ -${oldStart + 1},${Math.max(1, i - oldStart)} +${newStart + 1},${Math.max(1, j - newStart)} @@`);
        hunks.push(...lines);
    }
    if (hunks.length === 0)
        return "";
    return [`--- ${filePath}`, `+++ ${filePath}`, ...hunks].join("\n");
}
function isOnPathTo(byId, startId, targetId) {
    let current = startId;
    while (current !== null) {
        if (current === targetId)
            return true;
        const entry = byId.get(current);
        if (!entry)
            break;
        current = entry.parentId;
    }
    return false;
}
export class FileSnapshotManager {
    git;
    sessionStartTreeHash = null;
    lastCommittedTreeHash = null;
    turnIndex = 0;
    snapshotIndex = new Map();
    turnIndexMap = new Map();
    constructor(git) {
        this.git = git;
    }
    initialize(cwd) {
        if (this.snapshotIndex.size > 0)
            return;
        const files = readFilteredWorkingDir(this.git, cwd);
        this.sessionStartTreeHash = files.size > 0 ? this.git.writeTree(files).treeHash : null;
        this.lastCommittedTreeHash = null;
        this.turnIndex = 0;
    }
    getLiveChanges(cwd) {
        const currentFiles = readFilteredWorkingDir(this.git, cwd);
        const baselineHash = this.lastCommittedTreeHash ?? this.sessionStartTreeHash;
        const baselineFiles = this.readTree(baselineHash);
        const changes = [];
        for (const [path, content] of currentFiles) {
            const oldContent = baselineFiles.get(path);
            if (oldContent === undefined) {
                changes.push({ path, status: "added", diff: { oldContent: null, newContent: content } });
            }
            else if (oldContent !== content) {
                changes.push({ path, status: "modified", diff: { oldContent, newContent: content } });
            }
        }
        for (const [path, oldContent] of baselineFiles) {
            if (!currentFiles.has(path)) {
                changes.push({ path, status: "deleted", diff: { oldContent, newContent: null } });
            }
        }
        return changes;
    }
    onTurnEnd(cwd, turnIndex, appendEntry) {
        const files = readFilteredWorkingDir(this.git, cwd);
        const { treeHash: snapshotTreeHash, entries: newEntries } = this.git.writeTree(files);
        const compareTo = this.lastCommittedTreeHash ?? this.sessionStartTreeHash;
        const oldEntries = compareTo ? this.parseTreeEntriesFromHash(compareTo) : new Map();
        const diff = this.git.computeDiff(oldEntries, newEntries);
        const hasChanges = diff.added.length > 0 || diff.modified.length > 0 || diff.deleted.length > 0;
        if (!hasChanges) {
            this.turnIndex = turnIndex + 1;
            return;
        }
        const entryId = appendEntry("step-snapshot", {
            baselineTreeHash: compareTo,
            snapshotTreeHash,
            diff,
            turnIndex,
        });
        this.snapshotIndex.set(entryId, {
            baselineTreeHash: compareTo,
            snapshotTreeHash,
            diff,
            turnIndex,
            entryId,
            timestamp: new Date().toISOString(),
        });
        this.turnIndexMap.set(turnIndex, entryId);
        this.lastCommittedTreeHash = snapshotTreeHash;
        this.turnIndex = turnIndex + 1;
    }
    rebuildIndex(entries, leafId) {
        this.snapshotIndex.clear();
        this.turnIndexMap.clear();
        this.lastCommittedTreeHash = null;
        this.sessionStartTreeHash = null;
        this.turnIndex = 0;
        const byId = new Map(entries.map((entry) => [entry.id, entry]));
        for (const entry of entries) {
            if (entry.type !== "custom" || entry.customType !== "step-snapshot")
                continue;
            if (leafId && !isOnPathTo(byId, leafId, entry.id))
                continue;
            const data = entry.data;
            if (!data)
                continue;
            if (this.sessionStartTreeHash === null && this.lastCommittedTreeHash === null) {
                this.sessionStartTreeHash = data.baselineTreeHash ?? "";
            }
            this.snapshotIndex.set(entry.id, { ...data, entryId: entry.id, timestamp: entry.timestamp });
            this.turnIndexMap.set(data.turnIndex, entry.id);
            this.lastCommittedTreeHash = data.snapshotTreeHash;
            this.turnIndex = Math.max(this.turnIndex, data.turnIndex + 1);
        }
    }
    getLatestSnapshotOnPath(entries, leafId) {
        if (!leafId)
            return null;
        const byId = new Map(entries.map((entry) => [entry.id, entry]));
        const snapshots = [];
        for (const entry of entries) {
            if (entry.type !== "custom" || entry.customType !== "step-snapshot")
                continue;
            if (!isOnPathTo(byId, leafId, entry.id))
                continue;
            snapshots.push(entry.data);
        }
        if (snapshots.length > 0)
            return snapshots.at(-1) ?? null;
        const children = [];
        for (const entry of entries) {
            if (entry.type !== "custom" || entry.customType !== "step-snapshot")
                continue;
            if (entry.parentId !== leafId)
                continue;
            children.push(entry.data);
        }
        return children.at(-1) ?? null;
    }
    /**
     * Get the snapshot data for a specific entry ID.
     * Returns null if no snapshot was recorded for the given entry.
     */
    getSnapshotAtEntry(entryId) {
        const snap = this.snapshotIndex.get(entryId);
        if (!snap)
            return null;
        return {
            baselineTreeHash: snap.baselineTreeHash,
            snapshotTreeHash: snap.snapshotTreeHash,
            diff: snap.diff,
            turnIndex: snap.turnIndex,
        };
    }
    resolveSnapshotEntryIdForTarget(targetEntryId, entries) {
        if (this.snapshotIndex.has(targetEntryId))
            return targetEntryId;
        const pathSnap = this.getLatestSnapshotOnPath(entries, targetEntryId);
        if (pathSnap) {
            for (const [entryId, snapshot] of this.snapshotIndex.entries()) {
                if (snapshot.snapshotTreeHash === pathSnap.snapshotTreeHash) {
                    return entryId;
                }
            }
        }
        const children = [];
        for (const entry of entries) {
            if (entry.type !== "custom" || entry.customType !== "step-snapshot")
                continue;
            if (entry.parentId !== targetEntryId)
                continue;
            children.push({ entryId: entry.id, data: entry.data });
        }
        if (children.length > 0) {
            return children[children.length - 1].entryId;
        }
        return null;
    }
    resolveTargetTreeHash(targetEntryId, entries) {
        const snapshot = this.snapshotIndex.get(targetEntryId);
        if (snapshot)
            return snapshot.snapshotTreeHash;
        const pathSnap = this.getLatestSnapshotOnPath(entries, targetEntryId);
        if (pathSnap)
            return pathSnap.snapshotTreeHash;
        const children = [];
        for (const entry of entries) {
            if (entry.type !== "custom" || entry.customType !== "step-snapshot")
                continue;
            if (entry.parentId !== targetEntryId)
                continue;
            children.push(entry.data);
        }
        if (children.length > 0) {
            return children[children.length - 1].snapshotTreeHash;
        }
        return this.sessionStartTreeHash;
    }
    getRollbackPreviewFiles(options) {
        const targetTreeHash = this.resolveTargetTreeHash(options.targetEntryId, options.entries);
        const currentTreeHash = this.lastCommittedTreeHash ?? this.sessionStartTreeHash;
        if (targetTreeHash === currentTreeHash)
            return [];
        const emptyFiles = new Map();
        const targetFiles = targetTreeHash ? (this.git.readTree(targetTreeHash) ?? emptyFiles) : emptyFiles;
        const currentFiles = currentTreeHash ? (this.git.readTree(currentTreeHash) ?? emptyFiles) : emptyFiles;
        const files = [];
        for (const [path, content] of currentFiles) {
            const targetContent = targetFiles.get(path);
            if (targetContent === undefined) {
                files.push({ path, status: "added", turnIndex: -1, entryId: "" });
            }
            else if (targetContent !== content) {
                files.push({ path, status: "modified", turnIndex: -1, entryId: "" });
            }
        }
        for (const path of targetFiles.keys()) {
            if (!currentFiles.has(path)) {
                files.push({ path, status: "deleted", turnIndex: -1, entryId: "" });
            }
        }
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }
    getModifiedFiles(options) {
        const snapshots = [...this.snapshotIndex.values()].sort((a, b) => a.turnIndex - b.turnIndex);
        if (snapshots.length === 0)
            return [];
        let startIdx = 0;
        const effectiveFromTurnIndex = options?.fromTurnIndex ?? options?.toTurnIndex;
        if (effectiveFromTurnIndex !== undefined) {
            const entryId = this.turnIndexMap.get(effectiveFromTurnIndex);
            if (!entryId)
                return [];
            startIdx = snapshots.findIndex((snapshot) => snapshot.entryId === entryId);
            if (startIdx === -1)
                return [];
        }
        if (options?.fromEntryId) {
            const idx = snapshots.findIndex((snapshot) => snapshot.entryId === options.fromEntryId);
            if (idx !== -1)
                startIdx = idx;
        }
        let endIdx = snapshots.length - 1;
        if (options?.toEntryId) {
            const idx = snapshots.findIndex((snapshot) => snapshot.entryId === options.toEntryId);
            if (idx !== -1)
                endIdx = idx;
        }
        if (startIdx > endIdx)
            return [];
        const fileMap = new Map();
        for (let i = startIdx; i <= endIdx; i++) {
            const snapshot = snapshots[i];
            if (!snapshot?.diff)
                continue;
            for (const path of snapshot.diff.added) {
                if (!fileMap.has(path)) {
                    fileMap.set(path, { path, status: "added", turnIndex: snapshot.turnIndex, entryId: snapshot.entryId });
                }
            }
            for (const path of snapshot.diff.modified) {
                if (!fileMap.has(path)) {
                    fileMap.set(path, {
                        path,
                        status: "modified",
                        turnIndex: snapshot.turnIndex,
                        entryId: snapshot.entryId,
                    });
                }
                else {
                    const existing = fileMap.get(path);
                    if (existing && existing.status !== "added") {
                        existing.status = "modified";
                    }
                }
            }
            for (const path of snapshot.diff.deleted) {
                if (!fileMap.has(path)) {
                    fileMap.set(path, { path, status: "deleted", turnIndex: snapshot.turnIndex, entryId: snapshot.entryId });
                }
            }
        }
        return [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
    }
    getFileDiff(options) {
        const snapshots = [...this.snapshotIndex.values()].sort((a, b) => a.turnIndex - b.turnIndex);
        const fromSnap = options.fromEntryId
            ? snapshots.find((snapshot) => snapshot.entryId === options.fromEntryId)
            : undefined;
        const toSnap = options.toEntryId
            ? snapshots.find((snapshot) => snapshot.entryId === options.toEntryId)
            : undefined;
        const fromHash = options.fromEntryId
            ? options.useBaselineHash
                ? (fromSnap?.baselineTreeHash ?? this.sessionStartTreeHash)
                : (fromSnap?.snapshotTreeHash ?? null)
            : this.sessionStartTreeHash;
        const toHash = options.toEntryId
            ? (toSnap?.snapshotTreeHash ?? null)
            : (this.lastCommittedTreeHash ?? this.sessionStartTreeHash);
        let oldContent = this.readTree(fromHash).get(options.filePath) ?? null;
        const newContent = this.readTree(toHash).get(options.filePath) ?? null;
        if (oldContent === null && newContent === null) {
            const fromIdx = options.fromEntryId
                ? snapshots.findIndex((snapshot) => snapshot.entryId === options.fromEntryId)
                : 0;
            const toIdx = options.toEntryId
                ? snapshots.findIndex((snapshot) => snapshot.entryId === options.toEntryId)
                : snapshots.length - 1;
            for (let i = toIdx; i >= fromIdx; i--) {
                const snapshot = snapshots[i];
                if (!snapshot)
                    continue;
                const content = this.readTree(snapshot.snapshotTreeHash).get(options.filePath);
                if (content !== undefined) {
                    oldContent = content;
                    break;
                }
            }
            if (oldContent === null)
                return null;
        }
        return {
            path: options.filePath,
            oldContent,
            newContent,
            oldHash: oldContent === null ? null : this.git.hashContent(oldContent),
            newHash: newContent === null ? null : this.git.hashContent(newContent),
            unifiedDiff: generateUnifiedDiff(oldContent, newContent, options.filePath),
        };
    }
    getBatchDiffs(options) {
        const files = this.getModifiedFiles(options);
        let added = 0;
        let modified = 0;
        let deleted = 0;
        return {
            files: files.map((file) => {
                if (file.status === "added")
                    added++;
                if (file.status === "modified")
                    modified++;
                if (file.status === "deleted")
                    deleted++;
                let diff = null;
                try {
                    diff = this.getFileDiff({ filePath: file.path, ...options });
                }
                catch { }
                return {
                    path: file.path,
                    status: file.status,
                    diff,
                };
            }),
            summary: { totalFiles: files.length, added, modified, deleted },
        };
    }
    getFileHistory(options) {
        const history = [];
        for (const snapshot of [...this.snapshotIndex.values()].sort((a, b) => a.turnIndex - b.turnIndex)) {
            if (!snapshot.diff)
                continue;
            const status = snapshot.diff.added.includes(options.filePath)
                ? "added"
                : snapshot.diff.modified.includes(options.filePath)
                    ? "modified"
                    : snapshot.diff.deleted.includes(options.filePath)
                        ? "deleted"
                        : null;
            if (!status)
                continue;
            history.push({
                entryId: snapshot.entryId,
                turnIndex: snapshot.turnIndex,
                timestamp: snapshot.timestamp,
                status,
                snapshotHash: snapshot.snapshotTreeHash,
                previousHash: snapshot.baselineTreeHash,
            });
        }
        return history;
    }
    async restoreFiles(cwd, options) {
        const empty = { restored: [], deleted: [], skipped: [], dirty: [], forceRestored: [] };
        let targetTreeHash;
        let targetIsEmpty = false;
        if (options.snapshotHash) {
            targetTreeHash = options.snapshotHash;
        }
        else if (options.targetEntryId) {
            const snapshot = this.snapshotIndex.get(options.targetEntryId);
            if (snapshot) {
                targetTreeHash = snapshot.snapshotTreeHash;
            }
            else {
                const pathSnap = this.getLatestSnapshotOnPath(options.entries, options.targetEntryId);
                targetTreeHash = pathSnap?.snapshotTreeHash ?? null;
                if (targetTreeHash === null && !this.sessionStartTreeHash) {
                    targetIsEmpty = true;
                }
            }
        }
        else {
            targetTreeHash = this.sessionStartTreeHash;
            targetIsEmpty = !targetTreeHash;
        }
        const currentSnapshot = options.currentLeafId !== undefined
            ? this.getLatestSnapshotOnPath(options.entries, options.currentLeafId)
            : null;
        const currentTreeHash = currentSnapshot?.snapshotTreeHash ?? this.lastCommittedTreeHash ?? this.sessionStartTreeHash;
        if (targetTreeHash === currentTreeHash)
            return empty;
        if (targetTreeHash === null && !targetIsEmpty)
            return empty;
        const targetFiles = this.readTree(targetTreeHash);
        const currentFiles = this.readTree(currentTreeHash);
        const actualDiskFiles = readFilteredWorkingDir(this.git, cwd);
        let restore = [...targetFiles.entries()]
            .filter(([path, content]) => actualDiskFiles.get(path) !== content)
            .map(([path]) => path);
        let deleted = [...currentFiles.keys()].filter((path) => !targetFiles.has(path));
        if (options.files) {
            const fileSet = new Set(options.files);
            restore = restore.filter((path) => fileSet.has(path));
            deleted = deleted.filter((path) => fileSet.has(path));
        }
        if (restore.length === 0 && deleted.length === 0)
            return empty;
        const dirty = this.findDirtyFiles(cwd, currentFiles, restore);
        if (options.preview) {
            return { restored: restore.sort(), deleted: deleted.sort(), skipped: [], dirty, forceRestored: [] };
        }
        const preRollbackFiles = readFilteredWorkingDir(this.git, cwd);
        const preRollbackTreeHash = preRollbackFiles.size > 0 ? this.git.writeTree(preRollbackFiles).treeHash : null;
        options.appendEntry?.("unrevert-point", {
            preRollbackTreeHash,
            rolledBackToLeaf: options.targetEntryId ?? "",
            restoredFiles: restore,
            deletedFiles: deleted,
        });
        for (const path of restore) {
            const content = targetFiles.get(path);
            if (content === undefined)
                continue;
            const absolutePath = join(cwd, path);
            mkdirSync(dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, content, "utf-8");
        }
        for (const path of deleted) {
            this.git.rm(join(cwd, path));
        }
        this.lastCommittedTreeHash = targetTreeHash;
        return { restored: restore.sort(), deleted: deleted.sort(), skipped: [], dirty, forceRestored: dirty };
    }
    findDirtyFiles(cwd, currentFiles, restore) {
        const dirty = [];
        for (const path of restore) {
            const absolutePath = join(cwd, path);
            if (!existsSync(absolutePath))
                continue;
            const expected = currentFiles.get(path);
            if (expected === undefined)
                continue;
            try {
                const stat = lstatSync(absolutePath);
                if (stat.size > FILE_SIZE_LIMIT)
                    continue;
                const actual = readFileSync(absolutePath, "utf-8");
                if (this.git.hashContent(actual) !== this.git.hashContent(expected)) {
                    dirty.push(path);
                }
            }
            catch { }
        }
        return dirty.sort();
    }
    parseTreeEntriesFromHash(treeHash) {
        if (!this.git.hasObject(treeHash))
            return new Map();
        const entries = new Map();
        for (const line of this.git.readObject(treeHash).split("\n")) {
            if (!line)
                continue;
            const sep = line.indexOf("\0");
            if (sep === -1)
                continue;
            const path = line.slice(0, sep);
            const hash = line.slice(sep + 1);
            entries.set(path, { path, hash });
        }
        return entries;
    }
    getActiveTreeHashes() {
        const activeHashes = new Set();
        if (this.sessionStartTreeHash) {
            activeHashes.add(this.sessionStartTreeHash);
        }
        for (const snapshot of this.snapshotIndex.values()) {
            activeHashes.add(snapshot.snapshotTreeHash);
            if (snapshot.baselineTreeHash) {
                activeHashes.add(snapshot.baselineTreeHash);
            }
        }
        return activeHashes;
    }
    readTree(treeHash) {
        return treeHash ? (this.git.readTree(treeHash) ?? new Map()) : new Map();
    }
}
//# sourceMappingURL=file-snapshot-manager.js.map