export { DEFAULT_INPUT_MAX_BYTES } from "./tools/truncate.ts";
export interface LargeInputResult {
    text: string;
    savedFilePath?: string;
    wasLarge: boolean;
}
export declare function handleLargeInput(text: string): LargeInputResult;
//# sourceMappingURL=large-input.d.ts.map