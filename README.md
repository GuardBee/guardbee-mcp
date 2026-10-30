# GuardBee MCP

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg?label=mcp-security-proxy)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![CI](https://github.com/GuardBee/guardbee-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/GuardBee/guardbee-mcp/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/GuardBee/guardbee-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/GuardBee/guardbee-mcp)
[![Socket](https://socket.dev/api/badge/npm/package/@guardbee/mcp-security-proxy)](https://socket.dev/npm/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Security for AI agents and MCP.** GuardBee puts a gateway between your agents and their tools and models that masks personal data and secrets, blocks prompt injection and toxic data flows, asks before risky calls and keeps a tamper-evident audit log, plus scanners that check your code and configs against the OWASP MCP Top 10. Open source (MIT), runs on your machine, no account needed.

The gateway and every server speak MCP **2026-07-28** and **2025-11-25** (MCP TypeScript SDK v2), so they work with clients and servers on either revision.

```bash
# Put your existing MCP servers behind the gateway (backs up your client config first)
npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop   # or cursor, claude-code

# Check a codebase against the OWASP MCP Top 10
npx -y @guardbee/mcp-owasp-scan scan . --fail-on=high
```

![An agent calls a CRM through GuardBee: personal data is masked, a prompt injection is blocked, and sending data out after reading untrusted and sensitive content is refused](docs/demo.gif)

<sub>Run it yourself: [`examples/demo`](examples/demo) (`npm install && npm start`).</sub>

## Which package should I use?

| You want to… | Install | How |
|---|---|---|
| Protect agents at runtime: mask personal data, block injection and toxic flows, approve risky calls, keep an audit log | [`@guardbee/mcp-security-proxy`](packages/security-proxy) | Put it in front of your MCP servers (`guardbee-proxy init` imports your client config) |
| Check a codebase against the OWASP MCP Top 10 in one pass, in CI | [`@guardbee/mcp-owasp-scan`](packages/owasp-scan) | `npx @guardbee/mcp-owasp-scan scan . --format=sarif --fail-on=high` |
| Give an agent many GuardBee checks from one MCP server | [`@guardbee/security-suite`](packages/security-suite) | `guardbee serve` (recommended set), `--tools=code,network` or `all` |
| Find leaked keys in files, git history or agent transcripts | [`@guardbee/mcp-secret-scanner`](packages/secret-scanner) | `npx @guardbee/mcp-secret-scanner scan . --history` |
| Audit the MCP servers configured on developer machines | [`@guardbee/mcp-config-auditor`](packages/mcp-config-auditor) | `npx @guardbee/mcp-config-auditor discover` |
| Let an agent query a database without seeing raw personal data | [`@guardbee/mcp-db-gateway`](packages/db-gateway) | Point it at your database with a policy |
| Use the detectors in your own code | [`@guardbee/guard-core`](packages/guard-core) | `import { maskPiiInText } from "@guardbee/guard-core"` |

Every other package is a single check (one OWASP risk, one protocol, one file type); each is in `security-suite` too. `npx @guardbee/security-suite list` shows them with what they check.

## Benchmarks

Detection is measured, not claimed: [`packages/pii-bench`](packages/pii-bench) is a reproducible benchmark for Turkish and international personal data, with bootstrap 95% intervals and the datasets in the repo.

| Benchmark | Result |
|---|---|
| Identifiers (TC Kimlik, IBAN, card, phone, e-mail, …), 400 documents + 160 clean | **F1 97.1**, recall 100%, false alarms on clean documents 8.1%, 0.04 ms per document |
| Person names with the optional NER model, same set | **F1 99.5** |
| Hand-written hard cases for names ([tr-names-challenge](packages/pii-bench/README.md#dataset-tr-names-challenge)) | **F1 97.1**, 0 false alarms |
| KVKK Art. 6 special categories with NER ([tr-special-challenge](packages/pii-bench/README.md#dataset-tr-special-challenge)) | **F1 97.5**, 0 false alarms |
| Bypass suite: 5 identifiers × 16 disguises (base64, hex, URL/HTML/`\u` escapes, other scripts' digits, separators) | **80 / 80 masked**, 0 of 16 look-alike strings changed |

The identifier detectors were tuned after reading this set's misses, so the challenge sets are the fairer measure; the [pii-bench README](packages/pii-bench/README.md) lists the limits. Any other detector can be run on the same data through its `System` interface.

## Examples

Ready-to-copy proxy policies (minimal, KVKK, coding agent, LLM gateway), client configs for Claude Desktop, Claude Code, Cursor and VS Code, and CI templates for GitHub Actions and GitLab: [`examples/`](examples).

## Packages

| Package | npm | Description |
|---|---|---|
| [`packages/ai-code-scanner`](packages/ai-code-scanner) | `@guardbee/mcp-ai-code-scanner` | Scans a codebase for insecure LLM/AI integration patterns (client-exposed keys, unsafe output handling, excessive agency, PII→prompt, prompt injection) |
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA compliance checks |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | CVE scanning for npm/pip/cargo dependencies (OSV) |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS record enumeration, misconfiguration and dangling-subdomain detection |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | KVKK/GDPR-compliant gateway between an LLM and a database (PII masking, RBAC, rate limiting, queryable audit log; Prisma/Postgres/MySQL/SQLite/MongoDB adapters; optional insert/update/delete support) |
| [`packages/mcp-server-auditor`](packages/mcp-server-auditor) | `@guardbee/mcp-server-auditor` | Scans other MCP servers' tool definitions for insecure patterns (excessive agency, shell/eval/SQL/SSRF sinks, loose schemas, hardcoded secrets, wildcard CORS) |
| [`packages/prompt-injection-scanner`](packages/prompt-injection-scanner) | `@guardbee/mcp-prompt-injection-scanner` | Scans RAG content/scraped pages for indirect prompt injection (instruction override, spoofed role/chat-template tokens, hidden text, "Dear AI" direct address, data-exfiltration instructions) |
| [`packages/llm-redteam`](packages/llm-redteam) | `@guardbee/mcp-llm-redteam` | Actively red-teams a live LLM endpoint/chatbot with canary-based jailbreak/extraction/obfuscation probes (OpenAI/Anthropic/webhook targets) |
| [`packages/model-scanner`](packages/model-scanner) | `@guardbee/mcp-model-scanner` | Scans ML model files (PyTorch, pickle, safetensors, Keras/H5, ONNX) for supply-chain risks — dangerous pickle deserialization globals, disguised/malformed safetensors headers, Keras Lambda-layer RCE, ONNX external-data path traversal |
| [`packages/reverse-shield`](packages/reverse-shield) | `@guardbee/mcp-reverse-shield` | The defensive side of reverse-engineering MCPs: audits a shipped web build or live site, Electron app, Android APK/AAB, iOS IPA, Unity/PyInstaller/Java build or native/.NET binary for what an analyst gets for free — exposed source maps, missing minification/R8/.NET obfuscation, debug info and symbols, debuggable flags, Electron fuses, missing code signing, embedded keys; A–F grade, build-config fix diffs and CI baselines |
| [`packages/vector-store-scanner`](packages/vector-store-scanner) | `@guardbee/mcp-vector-store-scanner` | Probes vector-database endpoints (Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, Postgres/pgvector) for unauthenticated exposure of embeddings and RAG data |
| [`packages/prompt-leak-scanner`](packages/prompt-leak-scanner) | `@guardbee/mcp-prompt-leak-scanner` | Catches leaked credentials and PII (API keys, TC Kimlik No, credit cards, IBANs) in outbound LLM prompts — as MCP scan tools, and as a live reverse proxy in front of a real LLM API |
| [`packages/document-scanner`](packages/document-scanner) | `@guardbee/mcp-document-scanner` | Finds PII and credentials inside PDFs, screenshots and scanned documents — PDF text layer plus optional OCR (Turkish and English) — before they reach an LLM |
| [`packages/agent-graph-auditor`](packages/agent-graph-auditor) | `@guardbee/mcp-agent-graph-auditor` | Builds a reachability graph across multi-agent orchestration configs (LangGraph, CrewAI, AutoGen/ag2) to find transitive excessive agency — an agent that reaches a dangerous tool only through delegation to another agent |
| [`packages/tool-poisoning-scanner`](packages/tool-poisoning-scanner) | `@guardbee/mcp-tool-poisoning-scanner` | Scans MCP server tool definitions for tool poisoning (hidden instructions embedded in a tool's description) and confused-deputy mismatches (a read-only-sounding tool whose handler has a shell/eval/file-write/env-dump sink) |
| [`packages/rug-pull-detector`](packages/rug-pull-detector) | `@guardbee/mcp-rug-pull-detector` | Connects live to another MCP server (stdio/HTTP), baselines its tools/list response, and detects an "MCP rug pull" — a tool's description/schema/annotations silently changing after it was already approved |
| [`packages/memory-poisoning-scanner`](packages/memory-poisoning-scanner) | `@guardbee/mcp-memory-poisoning-scanner` | Scans agent code for memory poisoning — untrusted input written into persistent, cross-session memory (MemGPT-style archival/core memory, or a long-term vector store) that later gets recalled and trusted as context |
| [`packages/oauth-auditor`](packages/oauth-auditor) | `@guardbee/mcp-oauth-auditor` | Scans an MCP server's own authorization code for OAuth 2.1 anti-patterns named in the MCP spec's Security Considerations — token passthrough, missing audience validation, OAuth/OIDC discovery SSRF, missing PKCE, loose redirect_uri validation, hardcoded client secrets |
| [`packages/elicitation-auditor`](packages/elicitation-auditor) | `@guardbee/mcp-elicitation-auditor` | Scans MCP server code for elicitation anti-patterns in the 2026-07-28 spec — form mode asking for secrets or payment data, URL mode pointed straight at a third-party authorize endpoint, credentials or PII embedded in the elicitation URL |
| [`packages/toxic-flow-auditor`](packages/toxic-flow-auditor) | `@guardbee/mcp-toxic-flow-auditor` | Audits an MCP tool catalog for toxic flows (Simon Willison's lethal trifecta) — untrusted content + sensitive/private data + exfiltration or destruction on the same server; A–F grade, KVKK-aware heuristics, OWASP MCP10:2025 |
| [`packages/audit-gap-auditor`](packages/audit-gap-auditor) | `@guardbee/mcp-audit-gap-auditor` | Audits MCP server source for OWASP MCP08:2025 (Lack of Audit and Telemetry) — missing tool-call trails, raw args/results in logs, hard-disabled audit, silent catches, audit events without correlation ids |
| [`packages/context-oversharing-auditor`](packages/context-oversharing-auditor) | `@guardbee/mcp-context-oversharing-auditor` | Audits agent/MCP source for OWASP MCP10:2025 context oversharing — full conversation dumps, unscoped memory tools, shared global session stores, system-prompt leaks via tools, cross-session tool-result bleed, unfiltered vector queries (complements toxic-flow’s catalog trifecta) |
| [`packages/owasp-scan`](packages/owasp-scan) | `@guardbee/mcp-owasp-scan` | Unified OWASP MCP Top 10 meta-scanner — path orchestration of GuardBee auditors + live/catalog `tools/list` toxic-flow/poisoning, A–F grade, SARIF; optional MCP09 Shadow MCP discover |
| [`packages/mcp-config-auditor`](packages/mcp-config-auditor) | `@guardbee/mcp-config-auditor` | Audits MCP client configs (Cursor/Claude/Windsurf/VS Code) and agent `SKILL.md` for unpinned packages, secrets, wildcard auto-approve, unauthenticated remotes, typosquats, cross-server/skill shadowing; `discover` finds Shadow MCP (OWASP MCP09) vs an org allowlist |
| [`packages/threat-rules`](packages/threat-rules) | `@guardbee/mcp-threat-rules` | MCP bridge to [Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules) — runtime detection for prompt injection, tool poisoning, and MCP attacks, with GuardBee follow-up scanner hints |
| [`packages/a2a-auditor`](packages/a2a-auditor) | `@guardbee/mcp-a2a-auditor` | Scans an agent's Agent2Agent (A2A) protocol implementation (TypeScript and Python) for anti-patterns found in the reference SDKs' own source — unauthenticated push-notification webhook fetches (SSRF), Agent Cards with no authentication requirement, credentials embedded in publicly-served Agent Card metadata |
| [`packages/slopsquat-scanner`](packages/slopsquat-scanner) | `@guardbee/mcp-slopsquat-scanner` | Checks every dependency declared in a project's own manifest (package.json, requirements.txt, pyproject.toml) against the real npm/PyPI registry — flags names that don't exist at all (likely LLM-hallucinated, i.e. slopsquatting) and names that exist but were only very recently published |
| [`packages/unbounded-consumption-auditor`](packages/unbounded-consumption-auditor) | `@guardbee/mcp-unbounded-consumption-auditor` | Scans LLM/agent application code for Unbounded Consumption ("denial of wallet", OWASP LLM Top 10 2026 #6) — missing output token limits, missing timeouts on hand-rolled LLM HTTP calls, unbounded agent tool-calling/retry loops, explicitly disabled framework safety limits (LangChain max_iterations, openai-agents max_turns), and MCP tool handlers with no visible rate limiting |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Scans files for leaked secrets and API keys |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | MCP security gateway: several MCP servers behind one policy, with toxic-flow (lethal trifecta) blocking, approvals, PII masking and a hash-chained audit log |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | Every scanner and auditor below from one install: one MCP server with the groups you pick, and a CLI that runs any package |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS certificate/cipher/protocol inspection |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | Triggers GuardBee scans, queries findings, AI-assisted remediation guidance |
| [`packages/guard-core`](packages/guard-core) | `@guardbee/guard-core` | (internal) Shared detector library — PII/secret masking, prompt injection rules, tool classification; not an MCP server on its own |
| [`packages/telemetry`](packages/telemetry) | `@guardbee/mcp-telemetry` | (internal) Shared usage-telemetry client — not an MCP server on its own |

## Security

Found a vulnerability? Report it privately: see [SECURITY.md](SECURITY.md). Contributions are welcome: [CONTRIBUTING.md](CONTRIBUTING.md).

## Telemetry

Packages can send usage telemetry to GuardBee via `@guardbee/mcp-telemetry`: which tool is called, how often, and how long it takes. It is **off by default** (opt-in); nothing is sent unless you set `GUARDBEE_TELEMETRY=1`. When it is on, a one-time notice is printed to stderr on first use.

- **To enable**: `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`); unset it to turn telemetry off again
- **What's sent**: tool name, short (≤40 character) parameter values (e.g. `table: "users"`, `limit: 50`), success/failure, duration
- **What's NEVER sent**: values under keys like `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`, and any string longer than 40 characters — all replaced with `"[redacted: ...]"` by `redactParams()` in `packages/telemetry/src/redact.ts`. So the full content of scanned files/code, or the real row data from an `insert_row`/`update_row` call, is never sent.

Details: [`packages/telemetry/README.md`](packages/telemetry/README.md).

## Development

```
pnpm install
pnpm build     # turbo run build — all packages, in dependency order
pnpm test      # turbo run test
```

To work on a single package:

```
pnpm --filter @guardbee/mcp-ssl-inspector dev
```

## Versioning and publishing

Packages are versioned independently ([Changesets](https://github.com/changesets/changesets)). If you changed something in a PR:

```
pnpm changeset
```

After merging to `main`, CI automatically opens a version PR; merging that PR publishes the changed packages to npm (see `.github/workflows/release.yml`).

### Stability

Packages at **1.0 or later** follow [semantic versioning](https://semver.org): a breaking change to the CLI, the MCP tool names and parameters, the config format or the exported API comes only with a new major version, and is listed in the package's `CHANGELOG.md`. New rules and detectors arrive in minor versions; they can report findings an earlier version did not. Packages still at 0.x may change between minor versions.

| Package | Stable since |
|---|---|
| `@guardbee/mcp-security-proxy` | 1.0 |
| `@guardbee/guard-core` | 1.0 |
| `@guardbee/mcp-secret-scanner` | 1.0 |
| `@guardbee/mcp-prompt-injection-scanner` | 1.0 |
| `@guardbee/mcp-prompt-leak-scanner` | 1.0 |
| `@guardbee/mcp-toxic-flow-auditor` | 1.0 |

## Structure

- **pnpm workspaces** — `packages/*`, real `workspace:*` dependencies (e.g. `security-suite` depends on the other packages directly from the workspace, not a registry version)
- **Turborepo** — `build`/`test`/`type-check` pipeline, dependency-graph-aware ordering and caching
- **Shared config** — `tsconfig.base.json` and `vitest.shared.ts` at the root; each package layers its own settings on top

## Project history

The monorepo's earlier write-ups are in [CHANGELOG.md](CHANGELOG.md); each package's release notes are in its own `CHANGELOG.md` and on [GitHub Releases](https://github.com/GuardBee/guardbee-mcp/releases).
