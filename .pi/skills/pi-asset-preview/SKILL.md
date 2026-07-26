---
name: pi-asset-preview
description: Design or debug Pi asset handling, file previews, visual inputs, OCR, binary/text file resolving, remote preview paths, signed URLs, or AssetStore/FileResolver integrations.
---

# Pi Asset Preview

Use shared asset and resolver boundaries for files and visual inputs. Do not add one-off preview paths.

## Core Boundaries

- Prefer `AssetRef`, `AssetStore`, and `FileResolver` over hardcoded file-type branches.
- Do not pass remote project paths directly to browser `file://`.
- For web and mobile previews, use gateway-backed file serving or resolver-backed URLs.
- For desktop IPC previews, read file content through RPC and render data URLs or parsed text as needed.
- Store project-private asset state under the project user state directory, not global app config and not the repo by default.

## Text And Binary Budgets

- Large text, logs, JSONL, CSV, and code files must respect shared read budgets.
- Do not inject entire large files through `@file` or `read` just because they are text.
- Use offsets, search, parsers, or resolver metadata for follow-up reads.

## Validation

1. Validate the resolver path directly.
2. Validate local preview.
3. Validate remote or shadow-path preview when the change touches SSH or remote projects.
4. Validate refresh/replay if URLs, signed URLs, or generated previews can expire.
