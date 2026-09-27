# guardbee-mcp

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

[guardbee.ai](https://guardbee.ai) — Web siteleri için AI Security Copilot.

GuardBee'nin MCP (Model Context Protocol) server ailesi; her biri bağımsız bir npm paketi olarak yayınlanır.

Geliştirme notları: [DEVELOPER-TR.md](DEVELOPER-TR.md).

## Paketler

| Paket | npm | Açıklama |
|---|---|---|
| [`packages/ai-code-scanner`](packages/ai-code-scanner) | `@guardbee/mcp-ai-code-scanner` | Kod tabanında insecure LLM/AI entegrasyon kalıpları taraması (client-exposed key, unsafe output handling, excessive agency, PII→prompt, prompt injection) |
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA uyumluluk kontrolü |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | OSV ile npm ve pip manifestlerinde CVE taraması (tek paket sorguları ayrıca PyPI, crates.io, Maven, Go ve RubyGems kapsar) |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS kayıtları, yanlış yapılandırma, dangling subdomain tespiti |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | LLM↔DB arası KVKK/GDPR uyumlu gateway (PII masking, RBAC, rate limit, sorgulanabilir audit log; Prisma/Postgres/MySQL/SQLite/MongoDB adaptörleri; opsiyonel insert/update/delete desteği) |
| [`packages/mcp-server-auditor`](packages/mcp-server-auditor) | `@guardbee/mcp-server-auditor` | Başka MCP server'ların tool tanımlarını güvensiz kalıplar için tarar (excessive agency, shell/eval/SQL/SSRF sink'leri, gevşek şema, sabit secret, wildcard CORS) |
| [`packages/mcp-config-auditor`](packages/mcp-config-auditor) | `@guardbee/mcp-config-auditor` | Kurulu MCP istemci config'lerini sabitlenmemiş paket, secret, wildcard auto-approve, kimlik doğrulamasız uzak uç, typosquat ve sunucular arası tool gölgelemesi için tarar |
| [`packages/prompt-injection-scanner`](packages/prompt-injection-scanner) | `@guardbee/mcp-prompt-injection-scanner` | RAG içeriğini/scrape edilmiş sayfaları dolaylı (indirect) prompt injection için tarar (instruction override, sahte rol/chat-template token'ı, gizli metin, "Dear AI" hitabı, data-exfiltration talimatı) |
| [`packages/llm-redteam`](packages/llm-redteam) | `@guardbee/mcp-llm-redteam` | Canlı bir LLM endpoint'ini/chatbot'u canary-tabanlı jailbreak/extraction/obfuscation probe'larıyla aktif olarak red-team'ler (OpenAI/Anthropic/webhook hedefleri) |
| [`packages/model-scanner`](packages/model-scanner) | `@guardbee/mcp-model-scanner` | ML model dosyalarını (PyTorch, pickle, safetensors, Keras/H5, ONNX) tedarik zinciri riskleri için tarar — tehlikeli pickle deserialization global'leri, gizlenmiş/bozuk safetensors header'ları, Keras Lambda-layer RCE, ONNX external-data path traversal |
| [`packages/vector-store-scanner`](packages/vector-store-scanner) | `@guardbee/mcp-vector-store-scanner` | Vektör veritabanı endpoint'lerini (Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, Postgres/pgvector) embedding ve RAG verisinin auth'suz erişilebilirliği için prob'lar |
| [`packages/prompt-leak-scanner`](packages/prompt-leak-scanner) | `@guardbee/mcp-prompt-leak-scanner` | Outbound LLM prompt'larındaki sızmış credential ve PII'yi (API key, TC Kimlik No, kredi kartı, IBAN) yakalar — MCP tarama tool'ları olarak, ve gerçek bir LLM API'nin önünde canlı bir reverse proxy olarak |
| [`packages/agent-graph-auditor`](packages/agent-graph-auditor) | `@guardbee/mcp-agent-graph-auditor` | Multi-agent orkestrasyon config'leri (LangGraph, CrewAI, AutoGen/ag2) üzerinde bir ulaşılabilirlik grafiği kurup transitive excessive agency bulur — bir agent'ın tehlikeli bir tool'a sadece başka bir agent'a delegation ile ulaşması |
| [`packages/tool-poisoning-scanner`](packages/tool-poisoning-scanner) | `@guardbee/mcp-tool-poisoning-scanner` | MCP server tool tanımlarını tool poisoning (bir tool'un description'ına gömülü gizli talimatlar) ve confused-deputy uyumsuzlukları (read-only görünümlü ama handler'ında shell/eval/file-write/env-dump sink'i olan bir tool) için tarar |
| [`packages/rug-pull-detector`](packages/rug-pull-detector) | `@guardbee/mcp-rug-pull-detector` | Başka bir MCP server'a canlı bağlanıp (stdio/HTTP) tools/list yanıtını baseline'lar ve bir "MCP rug pull" tespit eder — bir tool'un description/schema/annotation'larının onaylandıktan sonra sessizce değişmesi |
| [`packages/memory-poisoning-scanner`](packages/memory-poisoning-scanner) | `@guardbee/mcp-memory-poisoning-scanner` | Agent kodunu memory poisoning için tarar — güvenilmeyen girdinin kalıcı, oturumlar-arası hafızaya (MemGPT-tarzı archival/core memory, ya da uzun-vadeli bir vektör store) yazılıp sonra geri çağrılarak context olarak güvenilmesi |
| [`packages/oauth-auditor`](packages/oauth-auditor) | `@guardbee/mcp-oauth-auditor` | Bir MCP server'ın kendi authorization kodunu MCP spec'inin Security Considerations'ında adlandırılan OAuth 2.1 anti-pattern'leri için tarar — token passthrough, eksik audience doğrulaması, OAuth/OIDC discovery SSRF, eksik PKCE, gevşek redirect_uri doğrulaması, sabit client secret'lar |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Dosyalarda sızmış secret/API key taraması |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | MCP client↔server arası güvenlik proxy'si |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | secret-scanner + dependency-auditor + ssl-inspector + dns-intelligence bundle'ı |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS sertifika/cipher/protokol denetimi |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | GuardBee tarama tetikleme, bulgu sorgulama, AI destekli düzeltme önerisi |
