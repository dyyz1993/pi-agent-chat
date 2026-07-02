/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const contentSurfaceFiles = [
  "src/mainview/components/diff/DiffOverlay.tsx",
  "src/mainview/components/file-preview/FileOverlay.tsx",
  "src/mainview/components/primitives/IframeFullscreenOverlay.tsx",
  "src/mainview/components/chat/MarkdownExpandOverlay.tsx",
  "src/mainview/components/chat/primitives/CodeExpandOverlay.tsx",
  "src/mainview/components/chat/mermaid/MermaidFullscreen.tsx",
];

describe("ContentSurface adoption", () => {
  it("keeps chat/content preview overlays on the shared ContentSurface primitive", () => {
    for (const file of contentSurfaceFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8");

      expect(source, file).toContain("ContentSurface");
      expect(source, file).not.toMatch(/import\s+\{[^}]*FullscreenOverlay/);
      expect(source, file).not.toContain("<FullscreenOverlay");
    }
  });
});
