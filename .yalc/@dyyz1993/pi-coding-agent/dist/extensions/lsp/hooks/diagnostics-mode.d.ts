export type DiagnosticsModeName = "agent_end" | "edit_write" | "disabled";
export interface DiagnosticsMode {
    get(): DiagnosticsModeName;
    set(mode: DiagnosticsModeName): void;
    addTouchedFile(filePath: string): void;
    getTouchedFiles(): string[];
    clearTouchedFiles(): void;
}
export declare function createDiagnosticsMode(initial?: DiagnosticsModeName): DiagnosticsMode;
//# sourceMappingURL=diagnostics-mode.d.ts.map