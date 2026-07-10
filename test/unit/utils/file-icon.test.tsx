import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getFileIcon } from "../../../src/mainview/utils/file-icon";
import type { TreeNode } from "../../../src/mainview/types";

function renderIcon(node: Partial<TreeNode> & Pick<TreeNode, "name" | "type">) {
  const treeNode: TreeNode = {
    path: `/tmp/${node.name}`,
    ...node,
  };

  const { container } = render(getFileIcon(treeNode));
  return container.querySelector("svg");
}

describe("getFileIcon", () => {
  it.each([
    [".github", "lucide-folder-git"],
    [".ion", "lucide-folder-cog"],
    [".uploads", "lucide-folder-up"],
    ["dashboard", "lucide-folder-kanban"],
    ["node_modules", "lucide-package"],
    ["src", "lucide-folder-code"],
    ["docs", "lucide-book-open-text"],
  ])("uses a recognizable folder icon for %s", (name, iconClass) => {
    const icon = renderIcon({ name, type: "directory" });

    expect(icon).not.toBeNull();
    expect(icon).toHaveClass(iconClass);
  });

  it.each([
    ["package.json", "lucide-package"],
    ["Cargo.toml", "lucide-package"],
    ["bun.lock", "lucide-file-lock"],
    ["README.md", "lucide-book-open-text"],
    ["AGENTS.md", "lucide-bot"],
    ["tsconfig.json", "lucide-file-cog"],
    [".gitignore", "lucide-folder-git"],
  ])("uses a recognizable special file icon for %s", (name, iconClass) => {
    const icon = renderIcon({ name, type: "file" });

    expect(icon).not.toBeNull();
    expect(icon).toHaveClass(iconClass);
  });

  it.each([
    ["main.ts", "lucide-file-code"],
    ["styles.css", "lucide-palette"],
    ["data.json", "lucide-file-braces"],
    ["schema.sql", "lucide-database"],
    ["image.svg", "lucide-file-image"],
    ["archive.tar", "lucide-file-archive"],
  ])("uses extension icons for %s", (name, iconClass) => {
    const icon = renderIcon({ name, type: "file" });

    expect(icon).not.toBeNull();
    expect(icon).toHaveClass(iconClass);
  });
});
