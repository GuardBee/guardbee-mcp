# guardbee-mcp

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

[guardbee.ai](https://guardbee.ai) — AI Security Copilot for websites.

GuardBee's family of MCP (Model Context Protocol) servers, published as independent npm packages.

Development notes: [DEVELOPER.md](DEVELOPER.md).

## Packages

| Package | npm | Description |
|---|---|---|
| [`packages/ai-code-scanner`](packages/ai-code-scanner) | `@guardbee/mcp-ai-code-scanner` | Scans a codebase for insecure LLM/AI integration patterns (client-exposed keys, unsafe output handling, excessive agency, PII→prompt, prompt injection) |
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA compliance checks |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | OSV CVE scanning for npm and pip manifests (single-package queries also cover PyPI, crates.io, Maven, Go, and RubyGems) |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS record enumeration, misconfiguration and dangling-subdomain detection |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | KVKK/GDPR-compliant gateway between an LLM and a database (PII masking, RBAC, rate limiting, queryable audit log; Prisma/Postgres/MySQL/SQLite/MongoDB adapters; optional insert/update/delete support) |
| [`packages/mcp-server-auditor`](packages/mcp-server-auditor) | `@guardbee/mcp-server-auditor` | Scans other MCP servers' tool definitions for insecure patterns (excessive agency, shell/eval/SQL/SSRF sinks, loose schemas, hardcoded secrets, wildcard CORS) |
| [`packages/mcp-config-auditor`](packages/mcp-config-auditor) | `@guardbee/mcp-config-auditor` | Audits installed MCP client configs for unpinned packages, secrets, wildcard auto-approve, unauthenticated remote endpoints, typosquats, and cross-server tool shadowing |
| [`packages/prompt-injection-scanner`](packages/prompt-injection-scanner) | `@guardbee/mcp-prompt-injection-scanner` | Scans RAG content/scraped pages for indirect prompt injection (instruction override, spoofed role/chat-template tokens, hidden text, "Dear AI" direct address, data-exfiltration instructions) |
| [`packages/llm-redteam`](packages/llm-redteam) | `@guardbee/mcp-llm-redteam` | Actively red-teams a live LLM endpoint/chatbot with canary-based jailbreak/extraction/obfuscation probes (OpenAI/Anthropic/webhook targets) |
| [`packages/model-scanner`](packages/model-scanner) | `@guardbee/mcp-model-scanner` | Scans ML model files (PyTorch, pickle, safetensors, Keras/H5, ONNX) for supply-chain risks — dangerous pickle deserialization globals, disguised/malformed safetensors headers, Keras Lambda-layer RCE, ONNX external-data path traversal |
| [`packages/vector-store-scanner`](packages/vector-store-scanner) | `@guardbee/mcp-vector-store-scanner` | Probes vector-database endpoints (Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, Postgres/pgvector) for unauthenticated exposure of embeddings and RAG data |
| [`packages/prompt-leak-scanner`](packages/prompt-leak-scanner) | `@guardbee/mcp-prompt-leak-scanner` | Catches leaked credentials and PII (API keys, TC Kimlik No, credit cards, IBANs) in outbound LLM prompts — as MCP scan tools, and as a live reverse proxy in front of a real LLM API |
| [`packages/agent-graph-auditor`](packages/agent-graph-auditor) | `@guardbee/mcp-agent-graph-auditor` | Builds a reachability graph across multi-agent orchestration configs (LangGraph, CrewAI, AutoGen/ag2) to find transitive excessive agency — an agent that reaches a dangerous tool only through delegation to another agent |
| [`packages/tool-poisoning-scanner`](packages/tool-poisoning-scanner) | `@guardbee/mcp-tool-poisoning-scanner` | Scans MCP server tool definitions for tool poisoning (hidden instructions embedded in a tool's description) and confused-deputy mismatches (a read-only-sounding tool whose handler has a shell/eval/file-write/env-dump sink) |
| [`packages/rug-pull-detector`](packages/rug-pull-detector) | `@guardbee/mcp-rug-pull-detector` | Connects live to another MCP server (stdio/HTTP), baselines its tools/list response, and detects an "MCP rug pull" — a tool's description/schema/annotations silently changing after it was already approved |
| [`packages/memory-poisoning-scanner`](packages/memory-poisoning-scanner) | `@guardbee/mcp-memory-poisoning-scanner` | Scans agent code for memory poisoning — untrusted input written into persistent, cross-session memory (MemGPT-style archival/core memory, or a long-term vector store) that later gets recalled and trusted as context |
| [`packages/oauth-auditor`](packages/oauth-auditor) | `@guardbee/mcp-oauth-auditor` | Scans an MCP server's own authorization code for OAuth 2.1 anti-patterns named in the MCP spec's Security Considerations — token passthrough, missing audience validation, OAuth/OIDC discovery SSRF, missing PKCE, loose redirect_uri validation, hardcoded client secrets |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Scans files for leaked secrets and API keys |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | Security proxy between an MCP client and server |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | Bundle of secret-scanner + dependency-auditor + ssl-inspector + dns-intelligence |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS certificate/cipher/protocol inspection |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | Triggers GuardBee scans, queries findings, AI-assisted remediation guidance |
