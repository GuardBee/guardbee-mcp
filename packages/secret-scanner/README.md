# @guardbee/mcp-secret-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP server that scans your source files, directories, and environment configs for exposed API keys, passwords, tokens, and other secrets. Ask Claude directly whether your project is leaking secrets.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](../telemetry/README.md).

---

## Features

- **76 Secret Patterns** — AWS, Azure, GCP, GitHub, GitLab, Stripe, OpenAI, Anthropic, OpenRouter, Groq, Hugging Face, Slack, Twilio, SendGrid, DigitalOcean, Cloudflare, Supabase, Vault, PyPI, Shopify, Linear, Notion, Atlassian and more — plus the Turkish providers iyzico, PayTR, Netgsm and İleti Merkezi, matched on their variable names since their keys have no prefix. The rules live in [`@guardbee/guard-core`](../guard-core/README.md), so `@guardbee/mcp-security-proxy` masks the same formats in tool results at runtime
- **File & Directory Scanning** — a single file or an entire project tree
- **Git History & Staged Scanning** — `--history` scans every line any commit added, so a key deleted from the files but still in the repository is found, reported once at the commit that added it (with author and date); `--staged` scans only what you are about to commit
- **Baseline** — `--write-baseline` records today's findings as hashes (never the secrets, safe to commit); `--baseline` then reports only new ones, so an existing repo can adopt the scanner in CI without fixing everything first. SARIF results carry a stable `partialFingerprints` value
- **High-Entropy Values** — a random-looking value assigned to a secret-like name (`WEBHOOK_SIGNING_SECRET=…` in `.env`, `client_secret:` in YAML, `"internalApiKey"` in JSON) is reported even when no provider rule knows its format. Randomness is measured as Shannon entropy (hex values need 32+ characters; values without digits need more bits, so a camel-case passphrase does not count); `public`/`publishable`, `*_hash`, `*_id` and `*_url` names, placeholders and `${VAR}` references are left alone, and a value a provider rule already reported is not reported twice. Medium severity, low in test files; `--no-entropy` (or `entropy: false` in the MCP tools) turns it off
- **Agent Transcripts** — `scan --agent-history` (MCP: `scan_agent_history`) scans what coding agents keep on your machine: Claude Code (`~/.claude/projects`, `~/.claude.json`), Codex (`~/.codex`), Gemini CLI (`~/.gemini/tmp`) and Continue (`~/.continue/sessions`). A key pasted into a chat or printed by a command the agent ran stays there — and was already sent to the model provider, so rotate it. Each secret is reported once per agent with how often it appears; the entropy check is off here unless `--entropy`, since transcripts are full of code the agent read
- **Large Line Files** — `.jsonl`, `.ndjson`, `.ipynb` and `.log` files over 1 MB (transcripts, notebooks with outputs, logs) are read line by line instead of being skipped
- **Live Verification (CLI only)** — `--verify` asks each provider whether a found key still works, through a read-only identity endpoint (GitHub `/user`, OpenAI `/models`, Slack `auth.test`, …): GitHub, GitLab, OpenAI, Anthropic, Slack, Stripe, Hugging Face, npm, SendGrid, Groq, OpenRouter and DigitalOcean. Each key goes only to its own provider, once, and never appears in the output; findings are marked `live` / `invalid` / `unknown` and live ones are listed first. `--fail-on=live` fails CI only for keys that still work. The MCP tools never verify, so an agent cannot send your secrets anywhere on its own
- **Smart Skipping** — directories like `node_modules`, `.git`, `dist`, `build`, `.next` are skipped automatically
- **Safe Redaction** — matches are shown as first 4 + stars + last 4 characters
- **Allowlist Support** — allowlist known test/fake values
- **71 Unit Tests** — 100% passing test suite

---

## Quick Start

```bash
npm install -g @guardbee/mcp-secret-scanner
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "guardbee-secret-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-secret-scanner"]
    }
  }
}
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans the given text for secrets |
| `scan_file` | Scans a single file |
| `scan_directory` | Recursively scans a directory and its subdirectories |
| `scan_git` | Scans a git repository's staged changes or every commit's added lines (history) |
| `scan_agent_history` | Scans coding agents' transcripts on this machine (Claude Code, Codex, Gemini CLI, Continue) |
| `list_patterns` | Lists all active secret patterns |

### Example Usage

You can ask Claude:

> "Scan my project for secrets: `/Users/me/my-app`"

> "Are there any secrets in this `.env` file?"

> "Is this text safe: `export API_KEY=sk-abc123...`"

---

## Detected Secret Types

| Category | Examples |
|----------|---------|
| Cloud | AWS Access Key, AWS Secret, GCP API Key |
| Source Control | GitHub PAT, GitLab Token |
| Payments | Stripe Secret/Publishable Key |
| AI | OpenAI API Key, Anthropic API Key, HuggingFace Token |
| Communication | Slack Bot Token, Twilio Auth Token, SendGrid Key |
| Database | PostgreSQL URL, MySQL URL, MongoDB URI, Redis URL |
| Cryptography | RSA Private Key, EC Private Key, OpenSSH Key, PGP Key |
| Web | JWT Token, Bearer Token |
| Package/Platform | npm Token, Docker Hub Token, Vercel Token |
| Generic | `SECRET=`, `PASSWORD=`, `API_KEY=` patterns |

---

## Security Note

This tool **partially redacts** matched values in scan results (e.g. `sk_live_abc1...xyz9`). Full values are never logged or exported.

---

## CLI — CI/CD Integration

In addition to MCP server mode, this can also be used directly as a CLI:

```bash
# Scan a project directory
npx @guardbee/mcp-secret-scanner scan ./my-project

# Scan a single file
npx @guardbee/mcp-secret-scanner scan .env

# Fail only on critical/high
npx @guardbee/mcp-secret-scanner scan . --fail-on=high

# JSON output (for CI reporting)
npx @guardbee/mcp-secret-scanner scan . --format=json
# Secrets pasted into Claude Code / Codex / Gemini CLI / Continue sessions on this machine
npx @guardbee/mcp-secret-scanner scan --agent-history
# Which of the found keys still work? (sends each key to its own provider)
npx @guardbee/mcp-secret-scanner scan . --history --verify --fail-on=live
# Pre-commit: only the lines you are about to commit
npx @guardbee/mcp-secret-scanner scan --staged

# Every commit on every branch (finds keys deleted from the files)
npx @guardbee/mcp-secret-scanner scan . --history
npx @guardbee/mcp-secret-scanner scan . --history=main..HEAD   # just this branch

# Adopt an existing repo: record known findings once, then fail only on new ones
npx @guardbee/mcp-secret-scanner scan . --history --write-baseline=.guardbee-secrets-baseline.json
npx @guardbee/mcp-secret-scanner scan . --history --baseline=.guardbee-secrets-baseline.json
```

**Exit codes:** `0` = no secrets found · `1` = secrets found · `2` = error

### GitHub Actions

```yaml
name: Secret Scan
on: [push, pull_request]

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # full history for --history
      - name: Scan for exposed secrets
        run: npx @guardbee/mcp-secret-scanner scan . --history --baseline=.guardbee-secrets-baseline.json --fail-on=high
```

### GitLab CI

```yaml
secret-scan:
  image: node:20
  script:
    - npx @guardbee/mcp-secret-scanner scan . --fail-on=high
  only:
    - merge_requests
    - main
```

### Pre-commit Hook

```bash
# .git/hooks/pre-commit
npx @guardbee/mcp-secret-scanner scan --staged --fail-on=high || exit 1
```

---

## Development

```bash
npm install
npm test          # 71 unit tests
npm run build     # TypeScript compile
```

---

## License

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
