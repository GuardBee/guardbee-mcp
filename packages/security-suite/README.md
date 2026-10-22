# @guardbee/security-suite

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-suite/LICENSE)

Every GuardBee MCP security tool from one install. `guardbee serve` is one MCP server with the tools of the packages you pick; `guardbee <package> …` runs any package's CLI. 29 packages, 124 MCP tools.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

## Quick start

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

That serves the **recommended** set (31 tools): a one-pass OWASP MCP Top 10 scan, secrets, prompt injection, toxic flows, MCP client configs and dependency CVEs. Pick others with `--tools`:

```json
"args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended,network"]
```

`--tools` takes group names and package ids, comma-separated, or `all` (124 tools; some clients cap the number of tools, Cursor among them). `GUARDBEE_SUITE_TOOLS` does the same as an environment variable. Each tool's name starts with its package's prefix, so two packages' `scan_text` tools do not collide: `secrets_scan_text`, `injection_scan_text`. Names that already say it stay as they are (`owasp_scan_path`, `inspect_ssl`).

## Groups

| Group | What it covers |
|---|---|
| `recommended` (default) | owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor |
| `code` | Static checks of source code, configs and content on disk |
| `supply-chain` | Dependencies, hallucinated packages, model files, MCP client configs, tool-definition drift |
| `network` | Checks that reach out to a host: TLS, DNS, vector stores, a live LLM |
| `platform` | Tools that call the GuardBee platform (need `GUARDBEE_API_KEY`) |
| `all` | Every package |

## Packages

| Id | Tool prefix | Checks | Groups |
|---|---|---|---|
| `owasp-scan` | `owasp_` | OWASP MCP Top 10 in one pass over a codebase or a live server, A–F grade | recommended, code |
| `secret-scanner` | `secrets_` | API keys, tokens and passwords in files, git history and agent transcripts | recommended, code |
| `prompt-injection-scanner` | `injection_` | Prompt injection in documents, web pages and RAG content | recommended, code |
| `toxic-flow-auditor` | `toxic_flow_` | Lethal trifecta: untrusted input, sensitive data and egress in one agent | recommended, code |
| `mcp-config-auditor` | `mcp_config_` | MCP client configs (Cursor, Claude, Windsurf, VS Code) and shadow servers | recommended, supply-chain |
| `dependency-auditor` | `deps_` | Known CVEs in npm and PyPI dependencies (OSV) | recommended, supply-chain |
| `prompt-leak-scanner` | `leak_` | Credentials and PII in outbound LLM prompts, before they leave your app | code |
| `tool-poisoning-scanner` | `poisoning_` | Hidden instructions in MCP tool descriptions and schemas | code |
| `mcp-server-auditor` | `server_audit_` | Shell, eval, SSRF and secrets in an MCP server's source | code |
| `oauth-auditor` | `oauth_` | OAuth 2.1 mistakes in an MCP server's auth code: token passthrough, audience, PKCE | code |
| `audit-gap-auditor` | `audit_gap_` | Tool calls without an audit trail (OWASP MCP08) | code |
| `context-oversharing-auditor` | `oversharing_` | Context oversharing (MCP10): session dumps, cross-user context, unscoped recalls | code |
| `ai-code-scanner` | `ai_code_` | Insecure LLM integrations: exposed keys, unsafe model output, PII to third-party LLMs | code |
| `agent-graph-auditor` | `agent_graph_` | Transitive excessive agency across LangGraph, CrewAI and AutoGen agents | code |
| `a2a-auditor` | `a2a_` | Agent2Agent (A2A) implementation code: webhook SSRF, unauthenticated Agent Cards | code |
| `elicitation-auditor` | `elicitation_` | MCP elicitation that asks users for secrets or sends them to third parties | code |
| `memory-poisoning-scanner` | `memory_` | Untrusted input written into persistent agent memory | code |
| `unbounded-consumption-auditor` | `consumption_` | Denial of wallet: missing token limits, timeouts and loop bounds | code |
| `threat-rules` | `threat_rules_` | Agent Threat Rules (ATR) on text, files and agent events | code |
| `document-scanner` | `document_` | PII and credentials in PDFs and images (OCR) before they reach an LLM | code |
| `slopsquat-scanner` | `slopsquat_` | Hallucinated or brand-new package names (slopsquatting) | supply-chain |
| `model-scanner` | `model_` | Malicious pickle, safetensors, Keras and ONNX model files | supply-chain |
| `rug-pull-detector` | `rug_pull_` | MCP tool definitions that change after you approved them | supply-chain |
| `ssl-inspector` | `ssl_` | TLS certificates, ciphers and HSTS | network |
| `dns-intelligence` | `dns_` | DNS records, SPF/DMARC/DKIM, subdomain takeover | network |
| `vector-store-scanner` | `vector_store_` | Unauthenticated vector databases (Weaviate, Qdrant, Chroma, pgvector…) | network |
| `llm-redteam` | `redteam_` | Jailbreak and extraction probes against an LLM endpoint you control | network |
| `vulnerability-scanner` | `vuln_` | GuardBee platform security scans and their findings | platform |
| `compliance-checker` | `compliance_` | KVKK, GDPR and CCPA compliance of a website via the GuardBee API | platform |

`guardbee list` prints this table. The proxy ([`mcp-security-proxy`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy)) and the database gateway ([`mcp-db-gateway`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/db-gateway)) are not in the suite: they sit in front of other servers rather than answering tool calls.

## CLI

```bash
npm install -g @guardbee/security-suite

guardbee list                                         # packages and groups
guardbee owasp-scan scan . --fail-on=high --format=sarif > owasp.sarif
guardbee secret-scanner scan . --history              # any package's CLI, same arguments
guardbee mcp-config-auditor discover
```

The shortcuts from earlier versions still work:

| Shortcut | Runs |
|---|---|
| `guardbee secret-scan <path>` | `secret-scanner scan` |
| `guardbee dep-audit <dir>` | `dependency-auditor audit` |
| `guardbee ssl-inspect <domain>…` | `ssl-inspector inspect` |
| `guardbee dns-check <domain>` | `dns-intelligence check` |

## GitHub Actions

```yaml
- run: npx -y @guardbee/security-suite owasp-scan scan . --format=sarif --fail-on=high > owasp.sarif
- run: npx -y @guardbee/security-suite dep-audit . --fail-on=high
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: owasp.sarif
```

## Upgrading from 0.2

`guardbee serve` used to expose five tools from four packages with plain names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`). It now serves the recommended group with prefixed names: the same checks are `secrets_scan_directory`, `secrets_scan_file`, `deps_audit_directory`, and, with `--tools=recommended,network`, `inspect_ssl` and `enumerate_dns` / `dns_check_email_security`. Agents that call tools by name need the new names.

## License

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
