export function stripMarkdownCodeBlock(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^```(?:\w*\n)?([\s\S]*?)```$/);
    if (match?.[1])
        return match[1].trim();
    return trimmed;
}
//# sourceMappingURL=strip-markdown.js.map