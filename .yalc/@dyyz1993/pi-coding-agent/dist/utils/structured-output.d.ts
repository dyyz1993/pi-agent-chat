import type { TSchema } from "typebox";
export interface StructuredOutputResult {
    success: boolean;
    data?: unknown;
    error?: string;
    raw: string;
}
export declare function resolveSchema(value: string): TSchema;
export declare function validateStructuredOutput(raw: string, schema: TSchema): StructuredOutputResult;
//# sourceMappingURL=structured-output.d.ts.map