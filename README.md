<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="NIOM" width="80" height="80" />
</p>

<h1 align="center">NIOM</h1>

<p align="center">
  <strong>Neural Interface Operating Model</strong><br/>
  An ambient AI desktop assistant that lives in your system tray.
</p>

<p align="center">
  <a href="https://github.com/niomstack/niom/releases"><img src="https://img.shields.io/github/v/release/niomstack/niom?style=flat-square&color=blue" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License" /></a>
  <a href="https://github.com/niomstack/niom/actions"><img src="https://img.shields.io/github/actions/workflow/status/niomstack/niom/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://niom.dev"><img src="https://img.shields.io/badge/docs-niom.dev-purple?style=flat-square" alt="Docs" /></a>
</p>

---

NIOM is a **local-first, privacy-respecting AI assistant** that runs on your desktop. It connects to any AI provider (OpenAI, Anthropic, Google, Groq, local models via Ollama), executes tools on your machine, and learns your preferences over time — all while keeping your data encrypted and never leaving your machine.

## ✨ Features

- **Multi-provider AI** — Use OpenAI, Anthropic, Google, Groq, or any OpenAI-compatible provider
- **Tool execution** — File operations, shell commands, web search, computer vision
- **Background tasks** — Delegate work to run autonomously with approval gates
- **Long-term memory** — NIOM learns facts, preferences, and patterns across sessions
- **MCP support** — Extend capabilities via Model Context Protocol servers
- **Privacy-first** — All data encrypted with AES-256-GCM, stored locally in `~/.niom/`
- **System tray** — Always available via `Ctrl+Space`, minimizes to tray

## 📦 Install

### macOS (Homebrew)

```bash
brew tap niomstack/niom https://github.com/niomstack/niom
brew install --cask niom
```

### Windows (Scoop)

```powershell
scoop bucket add niom https://github.com/niomstack/niom
scoop install niom
```

### Linux

Download the `.deb` or `.AppImage` from [GitHub Releases](https://github.com/niomstack/niom/releases).

```bash
# Debian/Ubuntu
sudo dpkg -i niom_*.deb

# Any distro (AppImage)
chmod +x niom_*.AppImage
./niom_*.AppImage
```

### Build from source

```bash
git clone https://github.com/niomstack/niom.git
cd niom
pnpm install
pnpm --filter niom-ai install
pnpm tauri dev
```

**Requirements:** Node.js 22+, Rust 1.75+, pnpm 9+

## 🚀 Quick Start

1. **Launch NIOM** — it runs in your system tray
2. **Press `Ctrl+Space`** to summon the interface
3. **Add an API key** — Settings → API keys (any provider works)
4. **Start chatting** — ask questions, run commands, create files

## 🏗️ Architecture

NIOM is a [Tauri v2](https://v2.tauri.app) desktop app with three layers:

```
┌─────────────────────────────────────┐
│         React Frontend (Vite)       │  ← UI, chat interface
├─────────────────────────────────────┤
│         Tauri Shell (Rust)          │  ← Window, tray, hotkeys
├─────────────────────────────────────┤
│      Node.js Sidecar (Hono)        │  ← AI, tools, memory, MCP
└─────────────────────────────────────┘
```

- **Frontend** — React 19, Tailwind CSS 4, Radix UI, Motion
- **Shell** — Rust/Tauri for native window management, global shortcuts, notifications
- **Sidecar** — Node.js + Hono HTTP server for AI orchestration, tool execution, and data persistence

The sidecar is bundled with a portable Node.js runtime — users don't need Node.js installed.

## 📁 Project Structure

```
niom/
├── src/                  # React frontend
├── src-tauri/            # Rust shell (Tauri)
│   └── src/lib.rs        # Window, tray, sidecar lifecycle
├── niom-ai/              # Node.js sidecar
│   └── src/
│       ├── ai/           # Agent pipeline, providers, memory extraction
│       ├── tools/        # File, shell, web, computer use
│       ├── tasks/        # Background task runner
│       ├── memory/       # Encrypted persistence (MemoryStore)
│       ├── mcp/          # MCP client
│       └── routes/       # HTTP API endpoints
├── scripts/              # Build helpers
├── Casks/                # Homebrew formula
├── bucket/               # Scoop manifest
└── .github/workflows/    # CI/CD pipeline
```

## 🔒 Privacy & Security

- **Local-first** — Your data never leaves your machine (except API calls to your chosen provider)
- **AES-256-GCM encryption** — Conversations, tasks, and brain data encrypted at rest
- **No telemetry** — Zero tracking, zero analytics, zero phone-home
- **Open source** — Inspect every line of code

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Quick start for contributors:**

```bash
git clone https://github.com/niomstack/niom.git
cd niom
pnpm install
pnpm --filter niom-ai install
pnpm tauri dev
```

Use [conventional commits](https://www.conventionalcommits.org/) for all changes:
- `feat:` — New features
- `fix:` — Bug fixes  
- `docs:` — Documentation
- `chore:` — Build, CI, deps

## 📝 License

NIOM is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

This means:
- ✅ You can use, modify, and distribute NIOM freely
- ✅ You can use NIOM for commercial purposes
- ⚠️ If you modify NIOM and offer it as a service, you **must** release your source code
- ⚠️ Derivative works must also be licensed under AGPL-3.0

This protects against SaaS companies taking the code without contributing back.

## 🔗 Links

- **Website:** [niom.dev](https://niom.dev)
- **Docs:** [docs.niom.dev](https://docs.niom.dev)  
- **Issues:** [GitHub Issues](https://github.com/niomstack/niom/issues)
- **Discussions:** [GitHub Discussions](https://github.com/niomstack/niom/discussions)
