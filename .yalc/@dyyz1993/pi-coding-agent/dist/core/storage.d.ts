export interface StoragePaths {
    userDir(): string;
    projectDir(storeId: string): string;
    localDir(): string;
    agentDir(agentType: string): string;
    cacheDir(): string;
    projectRoot(): string;
    cwd(): string;
}
export declare function resolveProjectIdentity(cwd: string): string;
export declare function encodeProjectPath(projectPath: string): string;
export declare function resolveProjectRoot(cwd: string): string;
export declare function getSessionDataDir(sessionDir: string, sessionId: string, extName: string): string;
export declare function getProjectDataDir(projectRoot: string, extName: string): string;
export declare function getCwdDataDir(cwd: string, extName: string): string;
export declare function getGlobalDataDir(extName: string): string;
export declare class ExtensionStorage implements StoragePaths {
    private readonly _cwd;
    private readonly _projectRoot;
    constructor(cwd: string);
    userDir(): string;
    projectDir(storeId: string): string;
    localDir(): string;
    agentDir(agentType: string): string;
    cacheDir(): string;
    projectRoot(): string;
    cwd(): string;
}
//# sourceMappingURL=storage.d.ts.map