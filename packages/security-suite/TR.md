# @guardbee/security-suite

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Tüm GuardBee MCP güvenlik araçları tek kurulumla. `guardbee serve`, seçtiğiniz paketlerin tool'larını sunan tek bir MCP sunucusudur; `guardbee <paket> …` herhangi bir paketin CLI'ını çalıştırır. 30 paket, 127 MCP tool'u.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

## Hızlı başlangıç

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

Bu, **önerilen** seti (31 tool) sunar: tek geçişte OWASP MCP Top 10 taraması, secret'lar, prompt injection, zehirli akışlar, MCP istemci config'leri ve bağımlılık CVE'leri. Başkalarını `--tools` ile seçin:

```json
"args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended,network"]
```

`--tools` virgülle ayrılmış grup adları ve paket kimlikleri ya da `all` alır (127 tool; Cursor dahil bazı istemciler tool sayısını sınırlar). `GUARDBEE_SUITE_TOOLS` ortam değişkeni de aynı işi yapar. Her tool'un adı paketinin önekiyle başlar, böylece iki paketin `scan_text` tool'u çakışmaz: `secrets_scan_text`, `injection_scan_text`. Bunu zaten söyleyen adlar olduğu gibi kalır (`owasp_scan_path`, `inspect_ssl`).

## Gruplar

| Grup | Kapsamı |
|---|---|
| `recommended` (varsayılan) | owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor |
| `code` | Kaynak kod, config ve diskteki içerik üzerinde statik kontroller |
| `supply-chain` | Bağımlılıklar, halüsinasyon paket adları, model dosyaları, MCP istemci config'leri, tool tanımı değişiklikleri |
| `network` | Bir sunucuya bağlanan kontroller: TLS, DNS, vektör veritabanları, canlı bir LLM |
| `platform` | GuardBee platformunu çağıran tool'lar (`GUARDBEE_API_KEY` gerekir) |
| `all` | Tüm paketler |

## Paketler

| Kimlik | Tool öneki | Kontrol ettiği | Gruplar |
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
| `reverse-shield` | `reverse_` | How easily a shipped app can be reverse engineered: source maps, obfuscation, debug info, Electron fuses, APK flags | code |
| `slopsquat-scanner` | `slopsquat_` | Hallucinated or brand-new package names (slopsquatting) | supply-chain |
| `model-scanner` | `model_` | Malicious pickle, safetensors, Keras and ONNX model files | supply-chain |
| `rug-pull-detector` | `rug_pull_` | MCP tool definitions that change after you approved them | supply-chain |
| `ssl-inspector` | `ssl_` | TLS certificates, ciphers and HSTS | network |
| `dns-intelligence` | `dns_` | DNS records, SPF/DMARC/DKIM, subdomain takeover | network |
| `vector-store-scanner` | `vector_store_` | Unauthenticated vector databases (Weaviate, Qdrant, Chroma, pgvector…) | network |
| `llm-redteam` | `redteam_` | Jailbreak and extraction probes against an LLM endpoint you control | network |
| `vulnerability-scanner` | `vuln_` | GuardBee platform security scans and their findings | platform |
| `compliance-checker` | `compliance_` | KVKK, GDPR and CCPA compliance of a website via the GuardBee API | platform |

`guardbee list` bu tabloyu yazdırır. Proxy ([`mcp-security-proxy`](../security-proxy)) ve veritabanı geçidi ([`mcp-db-gateway`](../db-gateway)) suite'te yok: tool çağrısı yanıtlamak yerine başka sunucuların önünde dururlar.

## CLI

```bash
npm install -g @guardbee/security-suite

guardbee list                                         # paketler ve gruplar
guardbee owasp-scan scan . --fail-on=high --format=sarif > owasp.sarif
guardbee secret-scanner scan . --history              # herhangi bir paketin CLI'ı, aynı argümanlarla
guardbee mcp-config-auditor discover
```

Önceki sürümlerdeki kısayollar çalışmaya devam eder:

| Kısayol | Çalıştırdığı |
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

## 0.2'den yükseltme

`guardbee serve` eskiden dört paketten beş tool'u düz adlarla sunuyordu (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`). Artık önerilen grubu önekli adlarla sunar: aynı kontroller `secrets_scan_directory`, `secrets_scan_file`, `deps_audit_directory` ve `--tools=recommended,network` ile `inspect_ssl` ve `enumerate_dns` / `dns_check_email_security` oldu. Tool'ları adıyla çağıran ajanların yeni adları kullanması gerekir.

## Lisans

MIT — [GuardBee](https://guardbee.ai)

## Geri bildirim

Sorunuz, öneriniz ya da yanlış bir alarm mı var? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)'ta bir konu açın veya [issue oluşturun](https://github.com/GuardBee/guardbee-mcp/issues). GuardBee işinize yaradıysa [repoya](https://github.com/GuardBee/guardbee-mcp) bir ⭐ başkalarının da bulmasına yardım eder.
