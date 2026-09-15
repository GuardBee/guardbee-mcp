# @guardbee/mcp-ssl-inspector

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP server that inspects TLS certificates, cipher suites, and protocol configuration for any domain. Uses Node.js's built-in `tls` module — no external dependencies.

> This package sends usage telemetry by default (tool name + short parameters — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

---

## Features

- **Certificate Inspection** — validity, days until expiry, SHA-256 fingerprint, SANs, issuer chain
- **Protocol Check** — TLS 1.0/1.1 deprecation warning, SSLv2/v3 critical warning
- **Cipher Analysis** — detects NULL, EXPORT, RC4, DES, 3DES, anonymous ciphers
- **HSTS Check** — `Strict-Transport-Security` header, max-age, includeSubdomains
- **Bulk Scanning** — scans N domains in parallel
- **Certificate Expiry Monitoring** — 🚨 / ⚠️ / ✅ icons for upcoming expirations
- **12 Unit Tests** — pure logic tests, no network connection required

---

## Quick Start

```bash
npm install -g @guardbee/mcp-ssl-inspector
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "guardbee-ssl-inspector": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-ssl-inspector"]
    }
  }
}
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `inspect_ssl` | Full TLS inspection for a single domain (cert + cipher + protocol + HSTS) |
| `inspect_ssl_bulk` | Inspects multiple domains in parallel |
| `check_cert_expiry` | Checks certificate expiry dates for N domains |
| `get_cert_info` | Detailed certificate info for a domain (fingerprint, SAN, chain, serial number) |

### Example Usage

You can ask Claude:

> "Is example.com's SSL certificate valid?"

> "When do these domains' certificates expire: example.com, api.example.com, shop.example.com"

> "Is example.com using a weak cipher suite?"

### Example Output

```
┌─ example.com:443
│  Protocol  : TLSv1.3
│  Cipher    : TLS_AES_256_GCM_SHA384 (256 bit)
│  Chain     : depth=2 valid=yes
│  Cert CN   : example.com
│  Validity  : Mar 15 2024 → Jun 13 2024 (expires in 45 days)
│  SANs      : example.com, www.example.com
│  Issuer    : Let's Encrypt
│  SHA-256   : AA:BB:CC:DD:...
│  HSTS      : enabled (max-age=31536000, includeSubdomains)
│  ✅ No security issues found
```

---

## Security Findings

| Finding | Severity | Description |
|-------|----------|----------|
| `CERT_EXPIRED` | 🔴 Critical | Certificate has expired |
| `CERT_EXPIRY_CRITICAL` | 🔴 Critical | < 7 days remaining |
| `CERT_EXPIRY_SOON` | 🟠 High | < 30 days remaining |
| `CERT_EXPIRY_WARN` | 🟡 Medium | < 90 days remaining |
| `CERT_CHAIN_INVALID` | 🟠 High | Chain validation error |
| `CERT_NO_SAN` | 🟡 Medium | No Subject Alternative Name |
| `DEPRECATED_PROTOCOL` | 🟠 High | TLS 1.0 or 1.1 |
| `OBSOLETE_PROTOCOL` | 🔴 Critical | SSLv2 or SSLv3 |
| `WEAK_CIPHER` | 🔴 Critical | NULL/EXPORT/RC4/anonymous cipher |
| `NO_HSTS` | 🟡 Medium | No HSTS header found |
| `HSTS_SHORT_MAX_AGE` | 🔵 Low | max-age < 15552000s |

---

## CLI — CI/CD Integration

In addition to MCP server mode, this can also be used directly as a CLI:

```bash
# Full TLS inspection for a single domain
npx @guardbee/mcp-ssl-inspector inspect example.com

# Multiple domains
npx @guardbee/mcp-ssl-inspector inspect example.com api.example.com shop.example.com

# Custom port
npx @guardbee/mcp-ssl-inspector inspect example.com:8443

# Certificate expiry check
npx @guardbee/mcp-ssl-inspector expiry example.com api.example.com

# Fail only on critical
npx @guardbee/mcp-ssl-inspector inspect example.com --fail-on=critical

# JSON output
npx @guardbee/mcp-ssl-inspector inspect example.com --format=json
```

**Exit codes:** `0` = no issues · `1` = findings above threshold / expired cert · `2` = error

### Configuration via guardbee.yml

Create a `guardbee.yml` at your project root to persist CLI flags. CLI flags always override file settings.

```yaml
ssl-inspector:
  fail-on: high          # critical | high | medium | low
  port: 443
  hosts:                 # used when no domain is given on the CLI
    - example.com
    - api.example.com
    - shop.example.com
```

See [`guardbee.example.yml`](guardbee.example.yml) for a sample file.

### GitHub Actions — Post-Deployment Check

```yaml
name: SSL Check
on:
  workflow_run:
    workflows: ["Deploy"]
    types: [completed]

jobs:
  ssl-check:
    runs-on: ubuntu-latest
    steps:
      - name: Inspect SSL certificate
        run: npx @guardbee/mcp-ssl-inspector inspect ${{ vars.DOMAIN }} --fail-on=high

      - name: Check cert expiry (warn if < 30 days)
        run: npx @guardbee/mcp-ssl-inspector expiry ${{ vars.DOMAIN }}
```

### Scheduled Expiry Monitor

```yaml
name: Cert Expiry Monitor
on:
  schedule:
    - cron: "0 9 * * 1"  # Every Monday at 09:00

jobs:
  expiry:
    runs-on: ubuntu-latest
    steps:
      - name: Check certificate expiry dates
        run: |
          npx @guardbee/mcp-ssl-inspector expiry \
            example.com \
            api.example.com \
            shop.example.com \
            --format=json
```

### GitLab CI

```yaml
ssl-inspect:
  image: node:20
  script:
    - npx @guardbee/mcp-ssl-inspector inspect $DOMAIN --fail-on=high
  environment:
    name: production
  only:
    - main
```

---

## Development

```bash
npm install
npm test          # 12 unit tests
npm run build     # TypeScript compile
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
