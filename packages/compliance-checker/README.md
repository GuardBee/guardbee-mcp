# @guardbee/mcp-compliance-checker

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An MCP server that runs KVKK (Turkish data protection law), GDPR, and CCPA compliance checks via the GuardBee API, analyzes privacy policies, and compares legal requirements. Three of its tools work without an API key.

> This package sends usage telemetry by default (tool name + short parameters — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

> **A GuardBee API key is required** for the `check_compliance` and `get_compliance_findings` tools. Get one at [app.guardbee.ai/developers](https://app.guardbee.ai/developers).

---

## Features

- **KVKK / GDPR / CCPA Scanning** — triggers a compliance-focused scan via the GuardBee API and fetches findings
- **Privacy Policy Analysis** — fetches policy text from a URL; 10 compliance signals, a score (0-100), and a letter grade
- **Cookie Banner Detection** — detects OneTrust, Cookiebot, Axeptio, and 10+ CMP platforms
- **Requirements Catalog** — 21 requirements with legal-article references across KVKK (9), GDPR (8), CCPA (4)
- **Framework Comparison** — common and differing articles across KVKK / GDPR / CCPA
- **Key-Free Tools** — `analyze_privacy_policy`, `list_requirements`, `compare_frameworks` work offline

---

## Quick Start

```bash
npm install -g @guardbee/mcp-compliance-checker
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "guardbee-compliance-checker": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-compliance-checker"],
      "env": {
        "GUARDBEE_API_KEY": "gb_..."
      }
    }
  }
}
```

Get your API key at [app.guardbee.ai/developers](https://app.guardbee.ai/developers).

---

## MCP Tools

| Tool | API Key | Description |
|------|:------------:|----------|
| `check_compliance` | Required | Starts a compliance scan (KVKK/GDPR/CCPA) for a URL or brand ID |
| `get_compliance_findings` | Required | Fetches scan findings, filterable by framework and severity |
| `analyze_privacy_policy` | No | Analyzes a privacy policy URL — score, grade, missing clauses |
| `list_requirements` | No | Lists legal requirements for supported frameworks |
| `compare_frameworks` | No | Compares similarities and differences across KVKK, GDPR, and CCPA |

### Example Usage

You can ask Claude:

> "Check example.com's KVKK compliance"

> "List GDPR requirements"

> "Compare the differences between KVKK and GDPR"

> "Analyze the privacy policy at https://example.com/privacy"

### Example Output

```
Privacy Policy Analysis: https://example.com/privacy
──────────────────────────────────────────────────────
Score : 72/100  Grade: C

✅ Data controller identity disclosed
✅ Purpose of processing stated
✅ Retention periods mentioned
✅ Cookie policy present
❌ Legal basis for processing not stated
❌ Data subject rights not listed (access, erasure, portability)
❌ International transfer safeguards missing
❌ Contact information for DPO missing

Recommendation: Add legal basis statements and data subject rights section.
```

---

## Supported Frameworks

| Framework | Requirement Count | Scan Scenario |
|---------|:-----------------:|-----------------|
| KVKK | 9 | `kvkkFocus` |
| GDPR | 8 | `gdprFocus` |
| CCPA | 4 | `ccpaFocus` |

---

## Privacy Policy Scoring

The `analyze_privacy_policy` tool looks for 10 signals in the policy text:

| Signal | Description |
|--------|----------|
| Data controller identity | Company/organization name is stated |
| Purpose of processing | Why the personal data is being collected |
| Legal basis | Reference to GDPR Art. 6 / KVKK Art. 5 |
| Retention periods | How long the data will be kept |
| Data subject rights | Access, erasure, portability, objection |
| Contact / DPO | How to reach the data controller |
| Cookie policy | Cookies and tracking technologies |
| Third-party sharing | Parties the data is shared with |
| Security measures | Technical/administrative safeguards |
| International transfer | Cross-border transfer safeguards |

**Grades:** A (90-100) · B (75-89) · C (60-74) · D (45-59) · F (0-44)

---

## Environment Variables

| Variable | Description |
|----------|----------|
| `GUARDBEE_API_KEY` | GuardBee API key (required for check_compliance and get_compliance_findings) |
| `GUARDBEE_BASE_URL` | Custom endpoint (default: `https://app.guardbee.ai`) |

---

## Development

```bash
npm install
npm test          # unit tests
npm run build     # TypeScript compile
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
