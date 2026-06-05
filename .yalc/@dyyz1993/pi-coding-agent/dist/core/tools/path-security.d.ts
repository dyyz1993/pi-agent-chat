export type PathSecurityViolation = "null_byte" | "not_within_sandbox" | "symlink_escape" | "empty_path";
export declare class PathSecurityError extends Error {
    readonly violation: PathSecurityViolation;
    constructor(violation: PathSecurityViolation, message: string);
}
export declare function sanitizePath(input: string): string;
export declare function sanitizeFilename(filename: string): string;
export declare function isWithinSandboxSync(filePath: string, sandboxDir: string): boolean;
export declare function isWithinSandbox(filePath: string, sandboxDir: string, options?: {
    resolveSymlinks?: boolean;
}): Promise<boolean>;
export declare function safeJoin(sandboxDir: string, filename: string, options?: {
    resolveSymlinks?: boolean;
}): Promise<string>;
//# sourceMappingURL=path-security.d.ts.map