# Capability matrix

What GuardBee covers and what it does not, in one place. It describes `@guardbee/mcp-security-proxy` 1.39 and the package versions in this repository's `main`; when a package README and this page disagree, open an issue. "Not supported" means the feature is absent, not that it is planned; open issues are linked where one exists.

Risk ids follow the official lists: [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) (`LLM01`–`LLM10`) and [OWASP MCP Top 10](https://owasp.org/projects/mcp-top-10) (`MCP01`–`MCP10`).

## Runtime protection by transport

The proxy is the runtime control point. A server it does not sit in front of is not protected.

| | stdio upstream | Streamable HTTP upstream | Legacy SSE upstream |
|---|---|---|---|
| Moved behind the proxy by `guardbee-proxy init` | Yes | Yes (`url` + `headers`) | **No.** Left in the client config and reported |
| Injection, PII, secrets, tool poisoning, toxic flows, approvals, quotas, audit | Yes | Yes | **No** (the proxy does not speak SSE) |
| Session and persistent tool pins (rug pull) | Yes | Yes | No |
| Build provenance (npm, PyPI, OCI) | Yes (`npx`, `pnpm dlx`, `bunx`, `uvx`, `docker run`, `podman run`) | No (nothing is installed) | No |
| Sandbox | Yes | No (the server runs elsewhere) | No |
| Network egress rules (host allowlist, private ranges, cloud metadata) | Through the sandbox's `network: allowlist` | Yes (`upstreams.<name>.network`) | No |
| Per-user upstream credentials (token exchange, OAuth per user) | No | Yes | No |

| How the agent reaches the proxy | stdio (default) | Streamable HTTP (`listen.transport: http`) |
|---|---|---|
| Users and groups (API keys, OIDC/JWT, LDAP/AD groups) | One local user | Yes |
| MCP 2025-11-25 and 2026-07-28 | Yes | Yes (2025 clients get a session, 2026-07-28 requests are stateless) |
| Sampling requested by a server mid-call | Yes | Refused for 2026-07-28 clients (`sampling:unavailable`) |
| Shared quotas and budgets across replicas (Redis) | n/a | Yes |
| LLM API gateway (OpenAI, Anthropic) and A2A gateway | No | Yes |

**Outside the proxy.** A coding agent's own tools (shell, file reads and writes, web fetch) are not MCP calls: `guardbee-hook` covers them for Claude Code, Cursor, Codex, Gemini CLI and Windsurf. An agent or user that connects to an upstream directly, without the proxy, is not seen by it: `@guardbee/mcp-config-auditor discover` finds MCP servers configured on a machine and compares them with an allowlist (OWASP MCP09, Shadow MCP), one machine at a time.

## Detection by mode

Prompt-injection numbers are F1 on the held-out split of [`injection-bench`](../packages/injection-bench) (Turkish / English). They measure direct injections and jailbreaks, not every attack class.

| Mode | Turned on by | Turkish F1 (recall / FP) | English F1 (recall / FP) | Added latency | Runs where |
|---|---|---|---|---|---|
| Rules only (default) | nothing | 28.6 (16.7% / 0.0%) | 20.4 (11.3% / 0.0%) | ~0.03 ms | in the proxy |
| Rules + local classifier | `classifier:` (`@guardbee/injection-model`) | 93.7 (90.6% / 2.8%) | 91.6 (85.6% / 1.3%) | ~8 ms on CPU | in the proxy or a sidecar |
| Rules + LLM judge | `judge:` (published numbers: `qwen2.5:7b`) | 89.6 (85.4% / 5.3%) | 90.8 (87.7% / 6.0%) | ~1 s mean, ~2 s p95 | a model endpoint you run |

Tool poisoning, PII and secrets are rule- and checksum-based in every mode; their numbers are in [`mcp-bench`](../packages/mcp-bench) and [`pii-bench`](../packages/pii-bench).

## Languages

| | Turkish | English | Other |
|---|---|---|---|
| Injection rules | Yes | Yes | Partial (English phrasing only) |
| Injection classifier | Yes | Yes | Not measured |
| PII formats | TC Kimlik No and VKN (check digits), TR phones, plates (opt-in) | Email, cards (Luhn), IBAN (any country, MOD97) | The same language-neutral formats: email, cards, IBAN, keys and tokens |
| Person names (NER) | Yes (`@guardbee/ner`, BERTurk) | No | No |
| OCR for images and scanned PDFs | Yes | Yes | Tesseract languages you install |
| Reports (`guardbee-proxy report`) | Yes | Yes | No |

## Operating systems

| | macOS | Linux | Windows |
|---|---|---|---|
| Proxy, scanners, `guardbee-hook` | Yes | Yes | Yes |
| `init` client paths (Claude Desktop, Cursor, Claude Code) | Yes | Yes | Yes |
| Sandbox | `sandbox-exec`, `docker`, `podman` | `bwrap`, `docker`, `podman` | `docker`, `podman` only |
| Shadow MCP discovery (`mcp-config-auditor discover`) | Yes | Yes | Yes |
| Fleet-wide discovery through MDM | No ([#311](https://github.com/GuardBee/guardbee-mcp/issues/311)) | No | No |

## Languages and runtimes for integrators

| | Status |
|---|---|
| Node.js | The proxy needs Node 22.9 or later, `document-scanner` and `security-suite` Node 22, every other package Node 18 |
| Container and Kubernetes | Signed multi-arch image `ghcr.io/guardbee/mcp-security-proxy` (cosign), Helm chart in [`charts/guardbee-gateway`](../charts/guardbee-gateway); see [INSTALL.md](../INSTALL.md) |
| Detectors as a library | `@guardbee/guard-core` (Node). Browser, Web Worker and edge runtimes: not supported ([#255](https://github.com/GuardBee/guardbee-mcp/issues/255)) |
| Python SDK and Python agent frameworks | Not supported ([#234](https://github.com/GuardBee/guardbee-mcp/issues/234)). Python MCP servers can still sit behind the proxy |
| JS agent frameworks (Vercel AI SDK, LangChain.js, Mastra) | No adapters ([#254](https://github.com/GuardBee/guardbee-mcp/issues/254)). Use the LLM gateway or the proxy |

## Packages

The OWASP MCP Top 10 column is the mapping [`mcp-owasp-scan`](../packages/owasp-scan) uses when it runs the package; a dash means the package is not part of that scan.

| Package | Checks | Transport | OWASP MCP Top 10 |
|---|---|---|---|
| `mcp-security-proxy` | Runtime gateway (MCP, LLM API, A2A) and coding-agent hooks | stdio, Streamable HTTP | Runtime controls; report categories map to LLM01, LLM02, LLM03, LLM05, LLM06, LLM07, LLM10 |
| `mcp-db-gateway` | Runtime gateway between an LLM and a database | stdio | – |
| `mcp-owasp-scan` | Static and live scan of an MCP codebase or server, SARIF | stdio, CLI | MCP01–MCP10 (MCP04, MCP06, MCP09 opt-in) |
| `security-suite` | Every scanner from one install | stdio, CLI | as the packages it runs |
| `mcp-secret-scanner` | Secrets in files, git history, agent transcripts | stdio, CLI | MCP01 |
| `mcp-server-auditor` | Tool definitions: excessive agency, shell/eval/SQL/SSRF sinks | stdio, CLI | MCP01, MCP02, MCP05 |
| `mcp-tool-poisoning-scanner` | Hidden instructions in tool definitions | stdio, CLI | MCP03 |
| `mcp-rug-pull-detector` | Tool definitions changing after approval | stdio, CLI | – |
| `mcp-dependency-auditor`, `mcp-slopsquat-scanner` | Known CVEs, hallucinated or brand-new dependencies | stdio, CLI | MCP04 |
| `mcp-prompt-injection-scanner` | Injection in documents and RAG content | stdio, CLI | MCP06 |
| `mcp-oauth-auditor` | OAuth 2.1 anti-patterns in a server's own code | stdio, CLI | MCP07 |
| `mcp-audit-gap-auditor` | Missing or leaky audit trails | stdio, CLI | MCP08 |
| `mcp-config-auditor` | Client configs, skills, Shadow MCP discovery | stdio, CLI | MCP09 |
| `mcp-toxic-flow-auditor`, `mcp-context-oversharing-auditor` | Lethal trifecta in a catalog, context oversharing in code | stdio, CLI | MCP10 |
| `mcp-prompt-leak-scanner`, `mcp-document-scanner` | PII and credentials in prompts, PDFs and images | stdio, CLI | – |
| `mcp-ai-code-scanner`, `mcp-unbounded-consumption-auditor` (LLM10), `mcp-memory-poisoning-scanner`, `mcp-agent-graph-auditor` | LLM and agent application code | stdio, CLI | – |
| `mcp-elicitation-auditor`, `mcp-a2a-auditor` | Elicitation and A2A implementations | stdio, CLI | – |
| `mcp-model-scanner` | Unsafe ML model files | stdio, CLI | – |
| `mcp-llm-redteam` | Live probes against an LLM endpoint | stdio, CLI | – |
| `mcp-vector-store-scanner` | Unauthenticated vector databases | stdio, CLI | – |
| `mcp-threat-rules` | Agent Threat Rules (ATR) evaluation | stdio | – |
| `mcp-reverse-shield` | How easily a shipped app can be reverse engineered | stdio, CLI | – |
| `mcp-ssl-inspector`, `mcp-dns-intelligence`, `mcp-compliance-checker`, `mcp-vulnerability-scanner` | TLS, DNS, KVKK/GDPR/CCPA and GuardBee scans of websites | stdio | – |

`mcp-ssl-inspector` and `mcp-slopsquat-scanner` also run as public Streamable HTTP servers on Hugging Face Spaces.

## Not covered

- Legacy SSE servers (see above), and any server or agent that connects without the proxy.
- Content safety and harm categories ([#232](https://github.com/GuardBee/guardbee-mcp/issues/232)) and grounding / hallucination checks ([#233](https://github.com/GuardBee/guardbee-mcp/issues/233)).
- An immutable audit store: the hash chain makes tampering visible; storage that cannot be rewritten is yours to provide (see the proxy README, [Default security profile](../packages/security-proxy/README.md#default-security-profile)).
- The LLM gateway does not cover the Realtime WebSocket API; images, PDFs and audio are inspected only with `llm.documents` turned on.
