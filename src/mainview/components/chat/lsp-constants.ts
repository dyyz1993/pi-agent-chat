export const MEMORY_HIDDEN_IN_CHAT = new Set<string>([]);

const LSP_CUSTOM_TYPES: Record<string, { label: string; color: string }> = {
  lsp: { label: "LSP", color: "text-status-info" },
  lsp_notify: { label: "LSP Diagnostics", color: "text-status-warning" },
  lsp_diagnostics: { label: "LSP Diagnostics", color: "text-status-warning" },
};

export const LSP_CUSTOM_TYPES_SET = new Set(Object.keys(LSP_CUSTOM_TYPES));

export const LSP_VISIBLE_TYPES = new Set(["lsp_diagnostics"]);

export function isLspCustomType(customType: string): boolean {
  return LSP_CUSTOM_TYPES_SET.has(customType);
}

export function isLspVisibleInChat(customType: string): boolean {
  return LSP_VISIBLE_TYPES.has(customType);
}
