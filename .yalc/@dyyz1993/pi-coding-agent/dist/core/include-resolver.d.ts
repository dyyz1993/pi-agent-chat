export interface IncludeDiagnostic {
    type: "warning" | "error";
    path: string;
    message: string;
}
export interface IncludeResult {
    content: string;
    diagnostics: IncludeDiagnostic[];
    includedPaths: string[];
}
export declare function resolveIncludes(content: string, sourcePath: string, options: {
    cwd: string;
    agentDir: string;
    maxDepth?: number;
    maxFileSize?: number;
    maxTotalSize?: number;
}): IncludeResult;
//# sourceMappingURL=include-resolver.d.ts.map