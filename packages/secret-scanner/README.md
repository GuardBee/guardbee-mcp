# @guardbee/mcp-secret-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP server that scans your source files, directories, and environment configs for exposed API keys, passwords, tokens, and other secrets. Ask Claude directly whether your project is leaking secrets.

> This package sends usage telemetry by default (tool name + short parameters like a file path — the scanned file content is never included, see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

---

## Features

- **40+ Secret Patterns** — AWS, GitHub, GitLab, Stripe, OpenAI, Anthropic, HuggingFace, Slack, Twilio, SendGrid, and more
- **File & Directory Scanning** — a single file or an entire project tree
- **Smart Skipping** — directories like `node_modules`, `.git`, `dist`, `build`, `.next` are skipped automatically
- **Safe Redaction** — matches are shown as first 4 + stars + last 4 characters
- **Allowlist Support** — allowlist known test/fake values
- **16 Unit Tests** — 100% passing test suite

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
      - name: Scan for exposed secrets
        run: npx @guardbee/mcp-secret-scanner scan . --fail-on=high
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
npx @guardbee/mcp-secret-scanner scan . --fail-on=critical || exit 1
```

---

## Development

```bash
npm install
npm test          # 16 unit tests
npm run build     # TypeScript compile
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
