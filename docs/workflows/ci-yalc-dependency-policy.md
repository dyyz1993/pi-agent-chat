# CI yalc Dependency Policy

`pi-agent-chat` intentionally develops against a local yalc copy of the forked
runtime packages:

```json
"@dyyz1993/pi-coding-agent": "file:.yalc/@dyyz1993/pi-coding-agent",
"@dyyz1993/pi-tui": "file:.yalc/@dyyz1993/pi-tui"
```

The `.yalc/` directory is local build output and is not committed. GitHub
Actions runners therefore cannot install the project from the checked-in
`package.json` without a dependency preparation step.

## Current CI Behavior

All GitHub workflows run:

```bash
bun run ci:prepare-deps
rm -f bun.lockb bun.lock
bun install
```

`scripts/ci-prepare-yalc-deps.mjs` does three things:

1. Keeps local development unchanged when `.yalc` packages exist.
2. Replaces missing yalc `file:` dependencies with `package.json`
   `piAgentChat.ciYalcFallbacks` when running in CI.
3. Applies `piAgentChat.ciDependencyOverrides` in CI for known broken registry
   packages.

The current override pins `@dyyz1993/pi-tui` to `0.74.56` because
`@dyyz1993/pi-tui@0.78.1` is published without `dist/index.js`.

## Important Limitation

Registry fallback is not a full substitute for the local fork.

If app code depends on APIs that exist only in the local yalc fork, such as a
new `@dyyz1993/pi-coding-agent` RPC method/type, the fallback can install and
start CI but type checks or tests may still fail. That failure is useful: it
proves the app and the CI dependency source are out of sync rather than hiding
the problem as a generic `bun install` failure.

## Full Validation Strategy

Use one of these paths for production-grade CI:

1. **Published runtime path**
   - Publish compatible `@dyyz1993/pi-coding-agent`, `@dyyz1993/pi-tui`,
     `@dyyz1993/pi-ai`, and `@dyyz1993/pi-agent-core` versions.
   - Update `piAgentChat.ciYalcFallbacks` to those versions.
   - CI becomes registry-only and reproducible.

2. **Fork build path**
   - Checkout the matching `pi-mono` fork/ref in CI.
   - Build the required packages.
   - Install or pack those build outputs before running app lint/type/test/e2e.
   - This path is required while app PRs depend on unpublished fork APIs.

Do not commit the entire `.yalc/@dyyz1993/pi-coding-agent` directory as a CI
shortcut. The local package includes large binary artifacts, so committing it
would make the app repository heavy and blur the source-of-truth boundary.

## Related Local Workflow

For local development after changing the fork:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm run build
yalc push
```

Then restart existing app/agent processes when the changed runtime code must be
loaded by already-running sessions.
