# Contributing to NIOM

Thank you for your interest in contributing to NIOM! This guide will help you get started.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Getting Started

### Prerequisites

- **Node.js 22+** — [nodejs.org](https://nodejs.org)
- **Rust 1.75+** — [rustup.rs](https://rustup.rs)
- **pnpm 9+** — `npm install -g pnpm`
- **System dependencies:**
  - **Linux:** `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libssl-dev`
  - **macOS/Windows:** No extra deps needed

### Setup

```bash
# Clone the repo
git clone https://github.com/niomstack/niom.git
cd niom

# Install frontend dependencies
pnpm install

# Install sidecar dependencies
pnpm --filter niom-ai install

# Start development
pnpm tauri dev
```

This launches:
- **Vite dev server** on `localhost:1420` (frontend)
- **Hono sidecar** on `localhost:3001` (AI backend)
- **Tauri window** connecting to both

### Project Structure

| Directory | Language | What it does |
|:----------|:---------|:-------------|
| `src/` | React/TypeScript | Chat UI, settings, task management |
| `src-tauri/` | Rust | Native window, system tray, global shortcuts |
| `niom-ai/` | TypeScript/Node.js | AI agent, tools, memory, MCP client |

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/niomstack/niom/issues) to avoid duplicates
2. Use the **Bug Report** issue template
3. Include: OS, NIOM version, steps to reproduce, expected vs actual behavior

### Suggesting Features

1. Open a [Discussion](https://github.com/niomstack/niom/discussions) first
2. If there's consensus, create an issue with the **Feature Request** template

### Submitting Code

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feat/my-feature`
3. **Make your changes** following the conventions below
4. **Test locally** with `pnpm tauri dev`
5. **Commit** with [conventional commits](#commit-conventions)
6. **Push** and open a Pull Request

### Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated changelog generation:

```
feat: add voice input support
fix: prevent crash when API key is missing
docs: update installation guide for Linux
chore: upgrade Tauri to v2.5
refactor: simplify memory store encryption
```

**Prefixes:**
| Prefix | When to use |
|:-------|:------------|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Build, CI, dependency updates |
| `refactor:` | Code change that's neither a fix nor a feature |
| `test:` | Adding or fixing tests |
| `perf:` | Performance improvement |

### Code Style

- **TypeScript** — Follow existing patterns, use strict mode
- **Rust** — Run `cargo fmt` and `cargo clippy` before committing
- **React** — Functional components, hooks, no class components
- **CSS** — Tailwind CSS 4 utility classes

### What We're Looking For

Check the [Issues](https://github.com/niomstack/niom/issues) page for:
- Issues labeled `good first issue` — great for newcomers
- Issues labeled `help wanted` — we'd especially appreciate help here
- Issues labeled `bug` — fixes are always welcome

## Development Tips

### Running checks locally

```bash
# TypeScript type check (backend)
pnpm --filter niom-ai exec tsc --noEmit

# Frontend build
pnpm build

# Rust check
cd src-tauri && cargo check

# Rust format + lint
cd src-tauri && cargo fmt && cargo clippy
```

### Testing the sidecar independently

```bash
# Run the sidecar standalone (without Tauri)
pnpm --filter niom-ai dev

# Hit the API
curl http://localhost:3001/health
```

### Building release binaries

```bash
# Full production build (downloads Node.js, bundles sidecar)
pnpm tauri build
```

## License

By contributing to NIOM, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
