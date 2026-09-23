# guardbee-mcp

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

GuardBee's family of MCP (Model Context Protocol) servers — a single monorepo, independent npm packages.

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
| [`packages/vector-store-scanner`](packages/vector-store-scanner) | `@guardbee/mcp-vector-store-scanner` | Probes vector-database endpoints (Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, Postgres/pgvector) for unauthenticated exposure of embeddings and RAG data |
| [`packages/prompt-leak-scanner`](packages/prompt-leak-scanner) | `@guardbee/mcp-prompt-leak-scanner` | Catches leaked credentials and PII (API keys, TC Kimlik No, credit cards, IBANs) in outbound LLM prompts — as MCP scan tools, and as a live reverse proxy in front of a real LLM API |
| [`packages/agent-graph-auditor`](packages/agent-graph-auditor) | `@guardbee/mcp-agent-graph-auditor` | Builds a reachability graph across multi-agent orchestration configs (LangGraph, CrewAI, AutoGen/ag2) to find transitive excessive agency — an agent that reaches a dangerous tool only through delegation to another agent |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Scans files for leaked secrets and API keys |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | Security proxy between an MCP client and server |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | Bundle of secret-scanner + dependency-auditor + ssl-inspector + dns-intelligence |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS certificate/cipher/protocol inspection |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | Triggers GuardBee scans, queries findings, AI-assisted remediation guidance |
| [`packages/telemetry`](packages/telemetry) | `@guardbee/mcp-telemetry` | (internal) Shared usage-telemetry client — not an MCP server on its own |

## Recent Changes (2026-09-23, cont'd 3)

Added a 17th package, the last of the four planned AI-security additions: **[`@guardbee/mcp-agent-graph-auditor`](packages/agent-graph-auditor)** — a structurally different kind of scanner from the other 16. Instead of flat pattern matching over one file/config, it builds an actual reachability graph across a multi-agent orchestration (LangGraph, CrewAI, or AutoGen/ag2) and finds **transitive excessive agency**: an agent with no dangerous tool of its own that can still reach one — shell, code-exec, file-write, network, credentials — through another agent it's allowed to delegate to. That's a blind spot for every single-agent scanner in this monorepo (`ai-code-scanner`, `mcp-server-auditor`), which only see one agent's own tool list, not a two-hop delegation chain. LangGraph is the most reliable target since `add_node`/`add_edge` calls *are* the orchestration graph in the source; CrewAI (`allow_delegation` + `Crew` membership) and AutoGen (`GroupChat` co-membership, `code_execution_config`, `register_function`) require inferring delegation from framework semantics, so those are documented as heuristic. 31 tests, plus end-to-end verification against realistic fixtures for all three frameworks — correctly distinguished "direct" (single-agent) from "transitive" (delegation-crossing, always reported critical) in every case, and caught a real regex bug along the way (a constructor-extraction pattern that silently missed any Agent definition not followed by a trailing newline — fixed before release, not shipped broken). New package, so no changeset added.

## Recent Changes (2026-09-23, cont'd 2)

Added a 16th package, third of the four planned AI-security additions: **[`@guardbee/mcp-prompt-leak-scanner`](packages/prompt-leak-scanner)** — catches leaked credentials and PII in *outbound* LLM prompts, the moment before they leave your application, rather than in code at rest (`secret-scanner`'s job). Detection uses real checksum algorithms where one exists — the actual 11-digit Turkish national ID (TC Kimlik No) algorithm, Luhn for credit cards, ISO 7064 MOD97-10 for IBANs — instead of bare digit-count regexes, which would otherwise flag order numbers and timestamps constantly. Findings never echo the real value back (`maskedMatch` shows only `sk-…wx`-style partial reveals). Beyond the usual `scan_text`/`scan_file`/`scan_directory` MCP tools, it also ships a `scan_messages` tool that understands OpenAI/Anthropic-style chat bodies (`messages[].content`, string or content-block array, plus `system`), and a standalone `proxy` CLI command — a real reverse proxy you point your app's `baseURL` at instead of the real LLM API, which inspects only the outbound request body (monitor/redact/block policies) and streams the upstream response back untouched, so SSE/streaming completions pass through unaffected. Audit events are credential-free by design — they record which pattern fired and where, never the matched text. 29 tests, including the proxy tested in all three modes via a real local HTTP client/server round trip (not just in-process mocks), plus a manual end-to-end run as an actual subprocess against a mock upstream confirming the redacted body — not the real key — was what got forwarded. New package, so no changeset added.

## Recent Changes (2026-09-23, cont'd)

Added a 15th package, second of the four planned AI-security additions: **[`@guardbee/mcp-vector-store-scanner`](packages/vector-store-scanner)** — probes a vector-database endpoint for unauthenticated exposure, the same misconfiguration class behind repeated open-Elasticsearch/MongoDB/Redis incidents, now aimed at the RAG-era stack. Fingerprints Weaviate/Qdrant/Chroma/Elasticsearch via HTTP and escalates through three levels (instance info → schema/collection listing → actual stored data), so a "critical" finding always means real data was actually read back without credentials, not just that a port responded. Redis and Postgres/pgvector get from-scratch raw-protocol implementations instead of HTTP: a RESP `PING` for Redis, and a wire-protocol `SSLRequest`+`StartupMessage` handshake for Postgres that reads whether `AuthenticationOk` comes back with no password challenge — no client library, no real credentials ever sent. 22 tests against local mock HTTP/TCP servers, covering every probe's matched/unmatched fingerprint and each escalation level. New package, so no changeset added.

## Recent Changes (2026-09-23)

Added a 14th package, the first of four planned additions to the AI-security family: **[`@guardbee/mcp-model-scanner`](packages/model-scanner)** — unlike the other scanners, which look at your integration code or content flowing through a model, this one looks at the **model file itself** as a supply-chain artifact. A `.pt`/`.pth`/`.pkl` checkpoint is a pickle stream, and unpickling can execute arbitrary Python the instant it's loaded (`torch.load()`), not just deserialize data. The package implements a from-scratch pickle opcode disassembler (protocols 0–5, including protocol 4+'s `STACK_GLOBAL` encoding) that walks the byte stream to find every `GLOBAL`/`STACK_GLOBAL`/`INST` reference, then checks it against a 31-rule denylist (`os`, `subprocess`, `socket`, `builtins.eval`, `ctypes`, …) and an allowlist of legitimate ML-framework globals (`numpy`, `torch`, `sklearn`, …). For PyTorch's default zip-based checkpoint format, it reads the ZIP central directory directly off disk (with Zip64 support) to extract just the small `data.pkl` entry without loading a multi-gigabyte file into memory. Also validates `.safetensors` header structure (including detecting a pickle/zip disguised with a safe-looking extension), flags Keras `.h5`/`.keras` Lambda-layer RCE patterns, and flags ONNX `external_data` path-traversal references. 45 tests, end-to-end verified against fixtures produced by real CPython `pickle`/`zipfile` (not just hand-built byte buffers) — correctly caught `os.system` in both protocol-2 (`GLOBAL`) and protocol-4 (`STACK_GLOBAL`) pickle encodings, resolved to `posix.system` exactly as CPython's own pickler records it. New package, so no changeset added (existing project convention).

## Recent Changes (2026-09-15)

Continued growing the AI Gateway (`db-gateway`) work:

- **`query_audit_log` tool** — the gateway's own audit history is now queryable, filterable by `table`/`tool`/`operation`/`deniedOnly`/`since`. It reads from an always-on in-memory ring buffer (`audit.bufferSize`, default 200) that is independent of the configured sink (console/file/http). This also fixed a bug where read and write tools each built their own `AuditLogger`, so write events would never have shown up in query results.
- **SQLite adapter** — `createSqliteAdapter` accepts a `better-sqlite3` `Database` instance, following the same pattern as the `pg`/`mysql2` adapters (identifiers validated against the live schema via `PRAGMA table_info` before being embedded in SQL).
- **MongoDB adapter** — `createMongoAdapter` accepts a MongoDB `Db` instance. Guards against a different risk class (not SQL injection, but "operator injection" — `$`-prefixed keys, dotted paths, operator-object filter values).

Full write-up: [`packages/db-gateway/README.md#recent-changes-2026-09-15`](packages/db-gateway/README.md#recent-changes-2026-09-15).

Also added a new package: **[`@guardbee/mcp-server-auditor`](packages/mcp-server-auditor)** — follows `ai-code-scanner`'s architecture (a regex pattern list, scanText/scanFile/scanDirectory, SARIF, guardbee.yml) but points it at a different target: not general LLM integration code, but **an MCP server's own tool definitions**. Does a tool name registered via `server.tool(...)` imply shell/SQL execution, does its handler pass raw tool input straight into an `exec`/`eval`/`fetch`/SQL sink, is a parameter typed `z.any()`, does it leak the entire `process.env` — 10 patterns, 5 categories, 32 tests.

And a third: **[`@guardbee/mcp-prompt-injection-scanner`](packages/prompt-injection-scanner)** — reuses the same engine (scanText/scanFile/scanDirectory/SARIF) but scans **data**, not code: a RAG chunk, a scraped web page, a document. Unlike classic prompt injection, indirect prompt injection never talks to the model directly — it embeds instructions in content the model will later read (via RAG retrieval or a web fetch). Detects override phrases ("ignore previous instructions"), spoofed `System:`/`<|im_start|>` role tokens, text hidden from a human reviewer via zero-width characters or `display:none` while a scraper still extracts it, phrasing that addresses "the AI" directly, and instructions to leak the system prompt or send data to an external URL. 10 patterns, 5 categories, 30 tests — with explicit negative tests against known false-positive sources like emoji ZWJ sequences and ordinary `display:none` modals.

And a fourth, a different kind of tool entirely: **[`@guardbee/mcp-llm-redteam`](packages/llm-redteam)** — while the other three scan code or content at rest, this one **actively** probes a live LLM endpoint or chatbot you control (OpenAI-compatible, Anthropic, or your own webhook) with known jailbreak/extraction/obfuscation/refusal-suppression techniques. Every probe is canary-based, not harm-based: it never asks the target to produce genuinely harmful content — success is a deterministic check for whether the target reproduced a random, single-use token, proving an override instruction was obeyed. 12 probes, 5 categories, 29 tests (target adapters tested against a mocked `fetch`), verified end-to-end via the CLI against local fake chatbot servers (a naive one that leaked 5/6 canaries, a safe one that leaked none).

## Telemetry

Every package sends usage telemetry to GuardBee via `@guardbee/mcp-telemetry`, **enabled by default**: which tool is called, how often, and how long it takes. A one-time notice is printed to stderr on first use.

- **To disable**: `GUARDBEE_TELEMETRY=0` (or `false`/`off`)
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

## Structure

- **pnpm workspaces** — `packages/*`, real `workspace:*` dependencies (e.g. `security-suite` depends on the other 4 packages directly from the workspace, not a registry version)
- **Turborepo** — `build`/`test`/`type-check` pipeline, dependency-graph-aware ordering and caching
- **Shared config** — `tsconfig.base.json` and `vitest.shared.ts` at the root; each package layers its own settings on top
