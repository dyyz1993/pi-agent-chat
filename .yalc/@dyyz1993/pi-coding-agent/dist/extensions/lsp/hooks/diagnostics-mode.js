const VALID_MODES = ["agent_end", "edit_write", "disabled"];
export function createDiagnosticsMode(initial) {
    let current = VALID_MODES.includes(initial) ? initial : "edit_write";
    const touchedFiles = [];
    const touchedSet = new Set();
    return {
        get() {
            return current;
        },
        set(mode) {
            if (VALID_MODES.includes(mode)) {
                current = mode;
            }
        },
        addTouchedFile(filePath) {
            if (!touchedSet.has(filePath)) {
                touchedSet.add(filePath);
                touchedFiles.push(filePath);
            }
        },
        getTouchedFiles() {
            return [...touchedFiles];
        },
        clearTouchedFiles() {
            touchedFiles.length = 0;
            touchedSet.clear();
        },
    };
}
//# sourceMappingURL=diagnostics-mode.js.map