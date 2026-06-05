import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { findCanonicalGitRoot, getAgentDir } from "../config.js";
function fnv1aHash(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
function sanitizeBasename(path) {
    return basename(path)
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 48);
}
export function resolveProjectIdentity(cwd) {
    return findCanonicalGitRoot(cwd) ?? realpathSync(cwd);
}
export function encodeProjectPath(projectPath) {
    const hash = fnv1aHash(projectPath);
    const name = sanitizeBasename(projectPath);
    return `${hash}--${name}`;
}
export function resolveProjectRoot(cwd) {
    return findCanonicalGitRoot(cwd) ?? cwd;
}
export function getSessionDataDir(sessionDir, sessionId, extName) {
    const dir = join(sessionDir, "data", sessionId, extName);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}
export function getProjectDataDir(projectRoot, extName) {
    const encoded = encodeProjectPath(projectRoot);
    const dir = join(getAgentDir(), "project-data", encoded, extName);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}
export function getCwdDataDir(cwd, extName) {
    const encoded = encodeProjectPath(cwd);
    const dir = join(getAgentDir(), "cwd-data", encoded, extName);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}
export function getGlobalDataDir(extName) {
    const dir = join(getAgentDir(), "extensions-data", extName);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}
export class ExtensionStorage {
    _cwd;
    _projectRoot;
    constructor(cwd) {
        this._cwd = cwd;
        this._projectRoot = resolveProjectIdentity(cwd);
    }
    userDir() {
        return getAgentDir();
    }
    projectDir(storeId) {
        const encoded = encodeProjectPath(this._projectRoot);
        return join(getAgentDir(), storeId, encoded);
    }
    localDir() {
        return join(this._cwd, ".pi");
    }
    agentDir(agentType) {
        return this.projectDir(`agent-${agentType}`);
    }
    cacheDir() {
        return join(getAgentDir(), "cache");
    }
    projectRoot() {
        return this._projectRoot;
    }
    cwd() {
        return this._cwd;
    }
}
//# sourceMappingURL=storage.js.map