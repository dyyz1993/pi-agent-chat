# Asset Store and Vision Inputs

This project treats file reading, asset storage, model input conversion, and visual understanding as separate layers.

## Current Boundary

- `pi-coding-agent` can read image files and return `ImageContent` blocks.
- The legacy provider contract still carries image bytes as base64.
- The runtime now attaches an asset reference to image blocks when available, while keeping base64 for provider compatibility.
- File-specific handling is routed through `FileResolver` instances. The built-in text and image resolvers are only default resolvers, not hardcoded branches inside `read` or CLI `@file`.
- Large text inputs are budgeted before they enter the model. `read` and CLI `@file` must share the same truncation rules instead of letting `@file` inject an entire log, CSV, JSONL, or other large text file.
- Local image assets are stored under the project-private user state directory:

```text
<PI_AGENT_DIR>/projects/<PROJECT_KEY>/assets/images/
```

Do not store project-private asset state in `~/.pi/chat/config.json`, and do not write it into repository files unless the user explicitly requests export.

## Plugin Boundary

The stable core owns the protocol and dispatch points. Feature-specific behavior should be pluginized whenever possible.

| Layer | Core-owned | Plugin/provider-owned |
| --- | --- | --- |
| Asset protocol | `AssetRef`, JSONL-safe metadata, provider-facing content blocks | None |
| File handling | `FileResolver` interface, resolver ordering, safe text truncation | image/pdf/csv/video/docx resolvers, thumbnails, metadata extraction |
| Storage | `AssetStore` interface, local fallback backend | UCloud/OSS/S3/R2/custom signed URL backends |
| Vision | vision request/result contract | OCR, xbrowser Doubao, MCP vision, local vision models, video frame analyzers |
| UI | asset rendering contract and authenticated preview route | Optional renderer extensions only after core UI has safe defaults |

`@file` is an entry syntax, not a file-type implementation. It should call the same resolver registry as the `read` tool.

Default text handling should cap model input to the shared text budget, currently 2000 lines or 50KB, whichever is hit first. Oversized single-line files should not be injected; return a short continuation instruction instead. If the user needs more content, require explicit `read` offsets, search tools, parsing tools, or a specialized resolver.

Current extension-compatible hook:

```ts
pi.setToolOperationsProvider({
  fileResolvers: [myResolver],
  readAssetStore: myAssetStore,
});
```

Resolvers should return standard `TextContent`, `ImageContent`, `AssetRef`, and optional `fileReferenceText`. They should not invent provider-specific payloads.

## Target Shape

Internally, binary or media reads should resolve to an asset first:

```ts
AssetRef {
  id: string;
  mimeType: string;
  size: number;
  sha256: string;
  storage: "inline" | "local" | "remote";
  visibility: "local" | "signed-url" | "public";
  sourcePath?: string;
  localPath?: string;
  previewUrl?: string;
  remoteUrl?: string;
  expiresAt?: string;
}
```

Provider adapters should be the last mile:

- If a provider supports remote image URLs and the asset has `remoteUrl`, send the URL.
- If a provider only supports inline images, read the asset bytes and send base64.
- If the current model does not support images, return text metadata, OCR output when available, and a clear suggestion to call a vision provider or MCP tool.

The preferred flow is:

```text
read / @file
  -> FileResolver registry
  -> AssetStore backend
  -> AssetRef + standard content blocks
  -> UI preview / JSONL replay
  -> provider adapter or vision provider
```

## Vision Provider Routing

There is not yet a single implemented `vision.mode` switch. Until that exists, agents and UI code must be honest about the current state and route image/video understanding through explicit providers.

Preferred routing order:

1. Native model vision, when the active model and provider adapter support image input.
2. OCR quick pass for text-heavy screenshots or documents, because it can provide useful text without a prompt-specific vision request.
3. MCP vision provider, when a configured MCP server exposes a structured vision tool.
4. xBrowser / Doubao / browser skill provider, when authenticated browser state or an external web vision service is needed.
5. Bash CLI provider or metadata fallback. Bash may call configured CLI tools for OCR, external vision services, metadata extraction, conversion, thumbnails, or video frame extraction. Generic metadata commands such as `file`, `sips`, `identify`, `exiftool`, `ffprobe`, and `ffmpeg` should not pretend to perform semantic image understanding unless the configured CLI is itself a vision service.

xBrowser-style providers should be treated as skill/provider integrations, not hardcoded read branches. Current operational guidance:

- Use the documented xBrowser skill/CLI entrypoint, normally `npx xbrowser`.
- Use CDP `9221` when the provider needs the user's logged-in browser state.
- Use CDP `9222`, headless, or auto sessions for public pages that do not need user login.
- Always create/open an xBrowser session before commands and close it when finished.
- If a local command such as `xbrowser doubao chat --cdp 9221` is available, wrap it as a vision provider or skill path; do not make `read` call it directly.

Bash-backed providers are allowed, but they must be explicit command templates:

```yaml
vision:
  providers:
    bash:
      enabled: false
      timeoutMs: 30000
      maxOutputBytes: 20000
      commands:
        imageMetadata:
          argv: ["sips", "-g", "pixelWidth", "-g", "pixelHeight", "{{localPath}}"]
          output: text
        videoFrames:
          argv: ["ffmpeg", "-i", "{{localPath}}", "-vf", "fps=1", "{{tempDir}}/frame-%03d.png"]
          output: assets
        externalVision:
          argv: ["xbrowser", "doubao", "chat", "--cdp", "9221", "--image", "{{localPath}}", "--prompt", "{{prompt}}"]
          output: json
```

Safety rules for Bash providers:

- Use argv arrays or equivalent structured spawning. Do not concatenate shell strings with untrusted paths or prompts.
- Restrict commands to an allowlist from settings or a trusted plugin.
- Pass local files through `AssetRef.localPath` or a managed temp copy; pass remote URLs only when the provider explicitly supports them.
- Cap stdout/stderr and runtime. Large CLI output should be summarized or attached as an asset.
- Prefer JSON output for semantic vision results. Plain text is acceptable for OCR or metadata.
- Keep credentials in env/private auth storage, not command-line arguments that can leak into process lists or logs.

Target configuration shape:

```yaml
vision:
  mode: auto # auto | native | ocr | mcp | xbrowser | bash
  providers:
    native:
      enabled: true
    ocr:
      enabled: true
    mcp:
      enabled: false
      server: vision
    xbrowser:
      enabled: false
      command: npx xbrowser
      cdp: http://localhost:9221
    bash:
      enabled: false
      timeoutMs: 30000
      maxOutputBytes: 20000
assets:
  store: local # local | oss | s3 | ucloud | r2
  remoteUpload: auto # never | auto | always
```

Config placement:

- Global defaults belong in `<PI_AGENT_DIR>/settings.json`.
- Project overrides belong in `<PROJECT_SHARED_DIR>/settings.json` after project trust.
- Secrets, OSS keys, and browser service tokens belong in env/private auth storage, never in repository files.
- App preview/proxy public URL settings remain app server config, not `AssetStore` secrets.

## Upload / OSS Policy

Remote object storage should be plugged in as an `AssetStore` backend, not hardcoded into `read`.

Use signed URLs by default. Public URLs require explicit product approval.

The default order should be:

1. Keep small images local and inline-compatible.
2. Store all read image assets as project-private `AssetRef` metadata.
3. Use remote upload for large images, repeated use, browser preview, cross-device viewing, or providers that prefer URLs.
4. Keep a local fallback whenever possible so replay still works if a signed URL expires.

## UI Contract

The chat UI should render assets from `AssetRef` when present.

- Image previews may use `previewUrl` or a local `/fs` route guarded by the app auth token.
- Never expose raw local filesystem paths to remote models or remote runtimes.
- Fullscreen preview, diff, text preview, and code preview should use the chat content surface rules in `AGENTS.md`.

## Verification

When changing this pipeline, verify in this order:

1. Core read/asset unit tests.
2. Provider adapter tests for base64/data URL/remote URL conversion.
3. RPC or process-manager smoke test from the consuming app.
4. UI preview and refresh/reconnect recovery.
