# @guardbee/mcp-ssl-inspector

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP server that inspects TLS certificates, cipher suites, and protocol configuration for any domain. Uses Node.js's built-in `tls` module — no external dependencies.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](../telemetry/README.md).

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
| `CERT_EXPIRY_SOON` | 🟠 High | < 21 days remaining (ACME clients renew at 30: renewal is failing) |
| `CERT_EXPIRY_WARN` | 🟡 Medium | < 30 days remaining |
| `HOSTNAME_MISMATCH` | 🔴 Critical | The certificate is not valid for the host |
| `CERT_REVOKED` | 🔴 Critical | The certificate has been revoked |
| `CERT_SELF_SIGNED` | 🟠 High | Self-signed certificate |
| `CERT_CHAIN_INCOMPLETE` | 🟠 High | The server does not send its intermediate certificate |
| `CERT_CHAIN_INVALID` | 🟠 High | Other chain validation error |
| `WEAK_KEY` | 🟠 High / 🔴 Critical | RSA key under 2048 bits (critical under 1024), EC key under 256 bits |
| `WEAK_SIGNATURE` | 🟠 High | Leaf or intermediate signed with SHA-1 or MD5 |
| `CERT_NO_SAN` | 🟡 Medium | No Subject Alternative Name |
| `DEPRECATED_PROTOCOL` | 🟠 High | The server still accepts TLS 1.0 or 1.1 (probe) |
| `OBSOLETE_PROTOCOL` | 🔴 Critical | SSLv2 or SSLv3 |
| `WEAK_CIPHER` | 🔴 Critical / 🟠 High | Accepts NULL/EXPORT/RC4 (critical) or 3DES (high) suites (probe) |
| `WEAK_DH` | 🟠 High / 🔴 Critical | Diffie-Hellman group under 2048 bits (critical under 1024) (probe) |
| `NO_FORWARD_SECRECY` | 🟡 Medium | Accepts RSA key exchange ciphers (probe) |
| `NO_HSTS` | 🟡 Medium | No HSTS header found |
| `HSTS_SHORT_MAX_AGE` | 🔵 Low | max-age < 15552000s |
| `NO_TLS13` | 🔵 Low | TLS 1.3 not supported (probe) |
| `NO_OCSP_STAPLING` | 🔵 Low | No stapled OCSP response |
| `NO_CAA` | 🔵 Low | No CAA DNS record for the domain or a parent |

**Probes.** One default handshake lands on the best protocol and cipher both sides share, so a server that *also* accepts TLS 1.0 or RSA key exchange looks fine. `inspect_ssl` and the CLI therefore make a few extra handshakes, each offering only the thing under test (TLS 1.0, TLS 1.1, TLS 1.3, RSA key exchange, DHE, weak cipher families). Weak families the runtime's own OpenSSL cannot offer (Node 22 builds have no 3DES/RC4/EXPORT) are listed as *not tested* rather than passed. `--no-probes` / `probes: false` skips them; `inspect_ssl_bulk` leaves them off unless asked.

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

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
