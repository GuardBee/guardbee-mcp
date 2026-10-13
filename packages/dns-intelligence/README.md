# @guardbee/mcp-dns-intelligence

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP server that enumerates DNS records, detects SPF / DMARC / DKIM misconfigurations, and finds dangling subdomains. Uses Node.js's built-in `dns/promises` — no external dependencies.

> This package sends usage telemetry by default (tool name + short parameters — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

---

## Features

- **Full DNS Enumeration** — A, AAAA, MX, NS, TXT, CNAME, SOA records
- **SPF Analysis** — `+all`, `?all`, duplicate records, and the RFC 7208 limits counted the way receivers do: DNS lookups across nested `include`/`redirect` (max 10), void lookups (max 2), include loops and missing includes
- **DMARC Analysis** — policy (`none`/`quarantine`/`reject`), `pct`, missing `rua` address
- **DKIM Check** — probes 9 common selectors (`default`, `google`, `selector1`, `mail`, etc.)
- **Subdomain Enumeration** — 60+ common subdomains; dangling CNAME detection (14 cloud providers)
- **Email Security Summary** — combined SPF + DMARC + DKIM analysis with copy-pasteable fix recommendations
- **23 Unit Tests** — pure logic tests, no network connection required

---

## Quick Start

```bash
npm install -g @guardbee/mcp-dns-intelligence
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "guardbee-dns-intelligence": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-dns-intelligence"]
    }
  }
}
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `enumerate_dns` | Enumerates all DNS records for a domain and runs SPF/DMARC/DKIM analysis |
| `enumerate_subdomains` | Probes common subdomains (wildcard-aware); detects subdomain takeovers |
| `check_takeover` | Checks given hostnames for subdomain takeover |
| `check_email_security` | Combined SPF + DMARC + DKIM audit with fix recommendations |
| `lookup_dns` | Targeted DNS lookup for a specific record type (A/MX/TXT/etc.) |

### Example Usage

You can ask Claude:

> "Is there a problem with example.com's DNS configuration?"

> "Audit example.com's email security — SPF, DMARC, and DKIM"

> "List example.com's subdomains, flag any dangling ones"

> "What are example.com's MX records?"

### Example Output

```
Email Security Check: example.com
──────────────────────────────────────────────────

── SPF ─────────────────────────────────────────
✓ v=spf1 include:_spf.google.com -all

── DMARC ───────────────────────────────────────
✗ No DMARC record found at _dmarc.example.com
  Add:  v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com

── DKIM ────────────────────────────────────────
✓ Found DKIM selectors: google
```

---

## SPF Findings

| Code | Severity | Description |
|-----|----------|----------|
| `SPF_MISSING` | 🟡 Medium | No SPF record found |
| `SPF_PERMISSIVE_ALL` | 🔴 Critical | `+all` — allows any server |
| `SPF_NEUTRAL_ALL` | 🟠 High | `?all` — doesn't reject unauthorized senders |
| `SPF_NO_ALL` | 🟡 Medium | No `all` mechanism |
| `SPF_TOO_MANY_LOOKUPS` | 🟠 High | > 10 DNS lookups — causes SPF to fail |
| `SPF_DUPLICATE` | 🟠 High | Multiple SPF records |
| `SPF_AT_LOOKUP_LIMIT` | 🔵 Low | Exactly 10 lookups — one more include breaks SPF |
| `SPF_TOO_MANY_VOID_LOOKUPS` | 🟠 High | More than 2 includes return no record |
| `SPF_INCLUDE_MISSING` | 🟠 High | An `include`/`redirect` target has no SPF record (permerror) |
| `SPF_INCLUDE_DUPLICATE` | 🟠 High | An included domain publishes several SPF records |
| `SPF_INCLUDE_LOOP` | 🟠 High | Includes loop back to a record being evaluated |
| `SPF_PTR` | 🔵 Low | Uses the deprecated `ptr` mechanism |

## DMARC Findings

| Code | Severity | Description |
|-----|----------|----------|
| `DMARC_MISSING` | 🟠 High | No DMARC record |
| `DMARC_NO_POLICY` | 🟠 High | Missing `p=` policy |
| `DMARC_POLICY_NONE` | 🟡 Medium | `p=none` — monitoring mode, no enforcement |
| `DMARC_PCT_LOW` | 🔵 Low | `pct` < 100 — partial enforcement |
| `DMARC_NO_RUA` | 🔵 Low | No aggregate report address (`rua`) |
| `DMARC_MULTIPLE` | 🟠 High | Several DMARC records — receivers ignore all of them |
| `DMARC_INVALID_POLICY` | 🟠 High | `p=` is not none, quarantine or reject |
| `DMARC_SUBDOMAINS_NONE` | 🟡 Medium | `sp=none` leaves subdomains spoofable |
| `DOMAIN_NOT_FOUND` | 🟠 High | The domain does not exist (NXDOMAIN) |

Subdomains without their own DMARC record inherit the parent domain's (`sp=` policy), as receivers do. Subdomain enumeration detects wildcard DNS and leaves out names answered only by the wildcard.

## Subdomain Takeover Detection

Each live subdomain with a CNAME is checked, following the CNAME chain (up to 5 hops). The wildcard record is checked too: a dangling `*.domain` makes every unlisted name claimable.

| Risk | When | Providers |
|---|---|---|
| ⚠️ **takeover possible** | The provider lets anyone claim the name | AWS S3 (`NoSuchBucket` page), Microsoft Azure and AWS Elastic Beanstalk (CNAME target NXDOMAIN), Surge.sh (`project not found`), and any CNAME into a domain that is **not registered** |
| ⚠️ **verify manually** | The resource is gone, but the provider can require domain verification | GitHub Pages, Heroku, Netlify, Vercel, Ghost, Pantheon, WordPress.com, Help Scout, Tumblr, ngrok |
| 🧹 **stale** | The target is gone but sits under a registered domain only its owner controls — delete the record; not a takeover, does not fail CI | any other provider |

Each page fingerprint was checked against a random unclaimed name on the provider. Providers whose "not found" page no longer carries a stable marker are not listed. HTTP checks send one `GET /` to the subdomain (HTTPS, then HTTP); turn them off with `--no-http` / `httpProbe: false`. Use `check_takeover` / `takeover <host…>` for hostnames you already know.

---

## CLI — CI/CD Integration

In addition to MCP server mode, this can also be used directly as a CLI:

```bash
# Full DNS + email security check
npx @guardbee/mcp-dns-intelligence check example.com

# Fail only on high and above
npx @guardbee/mcp-dns-intelligence check example.com --fail-on=high

# Subdomain scan — exits 1 if a dangling CNAME is found
npx @guardbee/mcp-dns-intelligence subdomains example.com

# Subdomain scan with higher concurrency
npx @guardbee/mcp-dns-intelligence subdomains example.com --concurrency=50

# JSON output
npx @guardbee/mcp-dns-intelligence check example.com --format=json
```

**Exit codes:** `0` = no issues · `1` = findings above threshold / dangling subdomain · `2` = error

### Configuration via guardbee.yml

Create a `guardbee.yml` at your project root to persist CLI flags. CLI flags always override file settings.

```yaml
dns-intelligence:
  fail-on: high          # critical | high | medium | low
  concurrency: 20        # parallel subdomain probes
  domains:               # used when no domain is given on the CLI
    - example.com
    - staging.example.com
```

See [`guardbee.example.yml`](guardbee.example.yml) for a sample file.

### GitHub Actions — DNS Security Audit

```yaml
name: DNS Security Check
on:
  schedule:
    - cron: "0 6 * * *"  # Every day at 06:00
  workflow_dispatch:

jobs:
  dns-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check DNS configuration
        run: npx @guardbee/mcp-dns-intelligence check ${{ vars.DOMAIN }} --fail-on=high

      - name: Scan for dangling subdomains
        run: npx @guardbee/mcp-dns-intelligence subdomains ${{ vars.DOMAIN }}
```

### GitLab CI

```yaml
dns-security:
  image: node:20
  script:
    - npx @guardbee/mcp-dns-intelligence check $DOMAIN --fail-on=high
    - npx @guardbee/mcp-dns-intelligence subdomains $DOMAIN
  only:
    - schedules
```

### Pre-Deployment Email Security Check

```yaml
- name: Verify email security records
  run: |
    npx @guardbee/mcp-dns-intelligence check ${{ vars.DOMAIN }} \
      --fail-on=high \
      --format=json | tee dns-report.json

- name: Upload DNS report
  uses: actions/upload-artifact@v4
  with:
    name: dns-security-report
    path: dns-report.json
```

---

## Development

```bash
npm install
npm test          # 23 unit tests
npm run build     # TypeScript compile
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
