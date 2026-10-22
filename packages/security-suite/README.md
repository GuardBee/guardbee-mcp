# @guardbee/security-suite

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A meta-package that bundles all GuardBee MCP security tools into one package. Secret scanner, dependency auditor, SSL inspector, and DNS intelligence are all available from a single install.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](../telemetry/README.md).

---

## Quick Start

```bash
npm install -g @guardbee/security-suite
```

### Claude Desktop (MCP — all tools, one server)

```json
{
  "mcpServers": {
    "guardbee": {
      "command": "npx",
      "args": ["-y", "@guardbee/security-suite", "serve"]
    }
  }
}
```

---

## CLI Usage

```bash
guardbee secret-scan <path>           # Secret scanning
guardbee dep-audit <dir>              # CVE audit
guardbee ssl-inspect <domain>...      # TLS inspection
guardbee dns-check <domain>           # DNS/SPF/DMARC check
```

### Common Options

```
--fail-on=<level>     critical | high | medium | low  (default: tool-specific)
--format=text|json|sarif
```

### Examples

```bash
guardbee secret-scan . --fail-on=high
guardbee dep-audit . --fail-on=critical --format=sarif > results.sarif
guardbee ssl-inspect example.com api.example.com shop.example.com
guardbee dns-check example.com --fail-on=medium
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Security Suite
on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci

      - name: Secret scan
        run: npx @guardbee/security-suite secret-scan . --fail-on=high

      - name: Dependency audit
        run: npx @guardbee/security-suite dep-audit . --fail-on=high

      - name: SARIF upload (GitHub Security tab)
        if: always()
        run: |
          npx @guardbee/security-suite secret-scan . --format=sarif > secrets.sarif || true
          npx @guardbee/security-suite dep-audit . --format=sarif > deps.sarif || true

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: secrets.sarif

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: deps.sarif
```

### GitLab CI

```yaml
include:
  - template: Security/Secret-Detection.gitlab-ci.yml

guardbee-security:
  image: node:20
  script:
    - npx @guardbee/security-suite secret-scan . --fail-on=high
    - npx @guardbee/security-suite dep-audit . --fail-on=high
  only:
    - merge_requests
    - main
```

---

## Included Tools

| Command | Package | Description |
|------|-------|----------|
| `secret-scan` | `@guardbee/mcp-secret-scanner` | Secret detection via 40+ patterns |
| `dep-audit` | `@guardbee/mcp-dependency-auditor` | OSV CVE database audit |
| `ssl-inspect` | `@guardbee/mcp-ssl-inspector` | TLS certificate and cipher analysis |
| `dns-check` | `@guardbee/mcp-dns-intelligence` | DNS, SPF, DMARC, dangling subdomain |

---

## License

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
