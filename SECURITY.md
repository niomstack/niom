# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in NIOM, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please email **security@niom.dev** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if you have one)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Scope

The following are in scope for security reports:

- **Data encryption** — Issues with AES-256-GCM encryption of conversations, tasks, or brain data
- **Sidecar API** — Unauthorized access to the local HTTP API (port 3001)
- **Tool execution** — Unintended command execution or file access
- **Memory leaks** — Sensitive data exposed in logs, memory, or temp files
- **Dependencies** — Known vulnerabilities in project dependencies

## Out of Scope

- **AI model behavior** — Prompt injection or model hallucination (these are inherent to LLMs)
- **API key handling** — Keys are stored in your local config file; securing your machine is your responsibility
- **Network security** — NIOM communicates with your chosen AI provider over HTTPS; we don't control their security

## Supported Versions

| Version | Supported |
|:--------|:----------|
| 0.x.x   | ✅ Latest release only |

## Security Design

- All persistent data encrypted with AES-256-GCM
- No telemetry, no analytics, no external data collection
- Sidecar API binds to `localhost` only — not accessible from other machines
- No data sent anywhere except your configured AI provider
