# Pi Agent Chat

A full-stack AI coding assistant with desktop (Electrobun) and web support, built with React, TypeScript, and Tailwind CSS.

## Features

- **AI Chat Interface** - Real-time streaming conversations with AI coding agents
- **Desktop + Web** - Runs as a native desktop app via Electrobun or in the browser
- **Message Queue** - Steer and follow-up on agent messages mid-stream
- **Activity Timeline** - Visual timeline of agent activities (tool calls, state changes)
- **Markdown Rendering** - Full GFM support with syntax highlighting, Mermaid diagrams, and diffs
- **i18n** - Multi-language support via i18next
- **Virtual Scrolling** - High-performance message list with TanStack Virtual

## Tech Stack

| Layer           | Technology                           |
| --------------- | ------------------------------------ |
| Desktop Runtime | Electrobun (Bun)                     |
| Frontend        | React 18 + TypeScript                |
| Styling         | Tailwind CSS                         |
| Build           | Vite 6                               |
| State           | Zustand                              |
| RPC             | @dyyz1993/rpc-core (WebSocket / IPC) |
| Testing         | Vitest + Playwright                  |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- Node.js >= 18 (for Playwright E2E tests)

### Install

```bash
bun install
```

### Development

```bash
# Desktop app with HMR (recommended)
bun run dev:hmr

# Web-only mode
bun run dev:web

# Desktop without HMR
bun run dev
```

### Build

```bash
bun run build          # Vite build
bun run build:canary   # Build + Electrobun canary package
```

### Lint & Format

```bash
bun run lint           # ESLint
bun run format         # Prettier (write)
bun run lint:full      # ESLint + Prettier check
```

### Test

```bash
bun run test           # Vitest unit tests
bun run test:watch     # Vitest in watch mode
```

## Project Structure

```
├── src/
│   ├── bun/               # Main process (Electrobun/Bun server)
│   ├── mainview/          # React frontend
│   │   ├── components/    # UI components (chat, activity, message blocks)
│   │   ├── stores/        # Zustand state stores
│   │   ├── lib/           # Utilities (api-client, i18n, clipboard)
│   │   └── types/         # TypeScript type definitions
│   └── shared/            # Shared types and RPC schema
├── scripts/               # Build and utility scripts
├── e2e/                   # Playwright E2E tests
├── test/                  # Vitest unit tests
├── docs/                  # Design documents
├── electrobun.config.ts   # Electrobun configuration
├── vite.config.ts         # Vite configuration
└── vitest.config.ts       # Vitest configuration
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit` follows [Conventional Commits](https://www.conventionalcommits.org/))
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

Please run `bun run lint:full` before submitting.

## License

[MIT](./LICENSE)
