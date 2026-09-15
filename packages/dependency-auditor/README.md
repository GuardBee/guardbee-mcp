# @guardbee/mcp-dependency-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP server that audits npm, pip, and other package managers' dependencies against the [OSV](https://osv.dev) database for known CVEs. Ask Claude directly about your project's security posture.

> This package sends usage telemetry by default (tool name + short parameters — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

---

## Features

- **OSV API Integration** — Google's open-source vulnerability database (free, no authentication required)
- **npm Support** — reads `package.json` and `package-lock.json` (v1/v2/v3); locked versions preferred
- **pip Support** — `requirements.txt`, `requirements/base.txt`, `requirements/prod.txt`, and `pyproject.toml`
- **Severity Scoring** — Critical / High / Medium / Low based on CVSS score or a text heuristic
- **Fix Version** — an `upgrade to X@Y.Z.Z` recommendation when available
- **CVE Links** — direct links to NVD or osv.dev
- **20 Unit Tests** — 100% passing test suite

---

## Quick Start

```bash
npm install -g @guardbee/mcp-dependency-auditor
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "guardbee-dependency-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-dependency-auditor"]
    }
  }
}
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `audit_npm` | Audits npm dependencies in `package.json` / `package-lock.json` |
| `audit_pip` | Audits Python dependencies in `requirements.txt` / `pyproject.toml` |
| `audit_package` | Audits a single package by name, version, and ecosystem |
| `audit_directory` | Auto-detects and audits all supported manifest files |

### Example Usage

You can ask Claude:

> "Audit my project's npm dependencies: `/Users/me/my-app`"

> "Is there a CVE for lodash 4.17.20?"

> "Scan my Python project: `/Users/me/django-app`"

### Example Output

```
⚠️  Found 3 vulnerabilities in 2/142 npm packages (1243ms)
   Critical: 1  High: 1  Medium: 1  Low: 0  Unknown: 0

[CRITICAL] lodash@4.17.20
  ID      : GHSA-35jh-r3h4-6jhm (CVE-2021-23337)
  Summary : Command injection via template
  Fix     : upgrade to lodash@4.17.21
  Details : https://nvd.nist.gov/vuln/detail/CVE-2021-23337
```

---

## Supported Ecosystems

The `audit_package` tool can query these ecosystems directly:

| Ecosystem | Parameter |
|-----------|-----------|
| npm | `npm` |
| Python | `PyPI` |
| Rust | `crates.io` |
| Java | `Maven` |
| Go | `Go` |
| Ruby | `RubyGems` |

---

## CLI — CI/CD Integration

In addition to MCP server mode, this can also be used directly as a CLI:

```bash
# Audit all dependencies in a directory (npm + pip auto-detected)
npx @guardbee/mcp-dependency-auditor audit ./my-project

# npm only
npx @guardbee/mcp-dependency-auditor audit-npm . --fail-on=critical

# pip only
npx @guardbee/mcp-dependency-auditor audit-pip . --fail-on=high

# Single package
npx @guardbee/mcp-dependency-auditor audit-pkg lodash 4.17.20 npm

# JSON output
npx @guardbee/mcp-dependency-auditor audit . --format=json
```

**Exit codes:** `0` = clean · `1` = findings above threshold · `2` = error

### GitHub Actions

```yaml
name: Dependency Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Audit dependencies
        run: npx @guardbee/mcp-dependency-auditor audit . --fail-on=high
```

### GitLab CI

```yaml
dependency-audit:
  image: node:20
  script:
    - npx @guardbee/mcp-dependency-auditor audit . --fail-on=high
  only:
    - merge_requests
    - main
```

### Pre-commit Hook

```bash
# .git/hooks/pre-push
npx @guardbee/mcp-dependency-auditor audit . --fail-on=critical || exit 1
```

---

## Development

```bash
npm install
npm test          # 20 unit tests
npm run build     # TypeScript compile
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
