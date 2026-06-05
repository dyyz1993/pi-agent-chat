export interface LspPosition {
    line: number;
    character: number;
}
export interface LspRange {
    start: LspPosition;
    end: LspPosition;
}
export interface LspDiagnostic {
    range: LspRange;
    severity?: number;
    code?: string | number;
    source?: string;
    message: string;
}
export declare function normalizeRange(raw: unknown): LspRange | undefined;
export declare function normalizePosition(raw: unknown): LspPosition | undefined;
export declare function languageIdFromPath(filePath: string): string;
export declare function extractPullDiagnostics(payload: unknown): LspDiagnostic[];
//# sourceMappingURL=lsp-helpers.d.ts.map