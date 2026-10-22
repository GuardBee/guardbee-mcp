# GuardBee MCP

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg?label=mcp-security-proxy)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![CI](https://github.com/GuardBee/guardbee-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/GuardBee/guardbee-mcp/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/GuardBee/guardbee-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/GuardBee/guardbee-mcp)
[![Socket](https://socket.dev/api/badge/npm/package/@guardbee/mcp-security-proxy)](https://socket.dev/npm/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**AI ajanları ve MCP için güvenlik.** GuardBee, ajanlarınızla tool'ları ve modelleri arasına bir geçit koyar: kişisel veriyi ve secret'ları maskeler, prompt injection'ı ve zehirli veri akışlarını engeller, riskli çağrılardan önce sorar ve değiştirilemez bir audit log tutar. Yanında kodunuzu ve config'lerinizi OWASP MCP Top 10'a göre kontrol eden tarayıcılar var. Açık kaynak (MIT), kendi makinenizde çalışır, hesap gerekmez.

```bash
# Mevcut MCP sunucularınızı geçidin arkasına alın (önce istemci config'inizi yedekler)
npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop   # ya da cursor, claude-code

# Bir kod tabanını OWASP MCP Top 10'a göre kontrol edin
npx -y @guardbee/mcp-owasp-scan scan . --fail-on=high
```

![Bir ajan GuardBee üzerinden bir CRM'i çağırıyor: kişisel veri maskeleniyor, prompt injection engelleniyor, güvenilmeyen ve hassas içerik okunduktan sonra veri dışarı gönderilemiyor](docs/demo.gif)

<sub>Kendiniz çalıştırın: [`examples/demo`](examples/demo) (`npm install && npm start`).</sub>

## Hangi paketi kullanmalıyım?

| Amacınız… | Kurun | Nasıl |
|---|---|---|
| Ajanları çalışma anında korumak: kişisel veriyi maskelemek, injection ve zehirli akışları engellemek, riskli çağrıları onaya bağlamak, audit log tutmak | [`@guardbee/mcp-security-proxy`](packages/security-proxy) | MCP sunucularınızın önüne koyun (`guardbee-proxy init` istemci config'inizi içe aktarır) |
| Bir kod tabanını CI'da tek geçişte OWASP MCP Top 10'a göre kontrol etmek | [`@guardbee/mcp-owasp-scan`](packages/owasp-scan) | `npx @guardbee/mcp-owasp-scan scan . --format=sarif --fail-on=high` |
| Bir ajana birçok GuardBee kontrolünü tek MCP sunucusundan vermek | [`@guardbee/security-suite`](packages/security-suite) | `guardbee serve` (önerilen set), `--tools=code,network` ya da `all` |
| Dosyalarda, git geçmişinde veya ajan kayıtlarında sızmış anahtarları bulmak | [`@guardbee/mcp-secret-scanner`](packages/secret-scanner) | `npx @guardbee/mcp-secret-scanner scan . --history` |
| Geliştirici makinelerinde yapılandırılmış MCP sunucularını denetlemek | [`@guardbee/mcp-config-auditor`](packages/mcp-config-auditor) | `npx @guardbee/mcp-config-auditor discover` |
| Bir ajanın veritabanını ham kişisel veriyi görmeden sorgulamasını sağlamak | [`@guardbee/mcp-db-gateway`](packages/db-gateway) | Bir politika ile veritabanınıza bağlayın |
| Dedektörleri kendi kodunuzda kullanmak | [`@guardbee/guard-core`](packages/guard-core) | `import { maskPiiInText } from "@guardbee/guard-core"` |

Diğer paketlerin her biri tek bir kontroldür (bir OWASP riski, bir protokol, bir dosya türü) ve hepsi `security-suite` içinde de var. `npx @guardbee/security-suite list` hepsini ne kontrol ettikleriyle listeler.

## Benchmark'lar

Tespit iddia edilmiyor, ölçülüyor: [`packages/pii-bench`](packages/pii-bench), Türkçe ve uluslararası kişisel veri için tekrarlanabilir bir benchmark; %95 bootstrap aralıkları ve veri setleri repoda.

| Benchmark | Sonuç |
|---|---|
| Tanımlayıcılar (TC Kimlik, IBAN, kart, telefon, e-posta, …), 400 belge + 160 temiz belge | **F1 97,1**, yakalama %100, temiz belgelerde yanlış alarm %8,1, belge başına 0,04 ms |
| İsteğe bağlı NER modeliyle kişi adları, aynı set | **F1 99,5** |
| Elle yazılmış zor isim örnekleri ([tr-names-challenge](packages/pii-bench/README.md#dataset-tr-names-challenge)) | **F1 97,1**, yanlış alarm yok |
| NER ile KVKK m.6 özel nitelikli veriler ([tr-special-challenge](packages/pii-bench/README.md#dataset-tr-special-challenge)) | **F1 97,5**, yanlış alarm yok |
| Bypass seti: 5 tanımlayıcı × 16 gizleme biçimi (base64, hex, URL/HTML/`\u` kaçışları, başka yazı sistemlerinin rakamları, ayraçlar) | **80 / 80 maskelendi**, benzer görünen 16 metnin hiçbiri değişmedi |

Tanımlayıcı dedektörleri bu setin kaçırdıkları okunduktan sonra iyileştirildi; bu yüzden elle yazılmış setler daha adil ölçüdür. Sınırlar [pii-bench README](packages/pii-bench/README.md)'sinde yazılı. Başka bir dedektör, `System` arayüzüyle aynı veride çalıştırılabilir.

## Örnekler

Kopyalanmaya hazır proxy politikaları (minimal, KVKK, kodlama ajanı, LLM geçidi), Claude Desktop, Claude Code, Cursor ve VS Code istemci config'leri, GitHub Actions ve GitLab CI şablonları: [`examples/`](examples).

## Paketler

| Paket | npm | Açıklama |
|---|---|---|
| [`packages/ai-code-scanner`](packages/ai-code-scanner) | `@guardbee/mcp-ai-code-scanner` | Kod tabanında insecure LLM/AI entegrasyon kalıpları taraması (client-exposed key, unsafe output handling, excessive agency, PII→prompt, prompt injection) |
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA uyumluluk kontrolü |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | npm/pip/cargo bağımlılıklarında CVE taraması (OSV) |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS kayıtları, yanlış yapılandırma, dangling subdomain tespiti |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | LLM↔DB arası KVKK/GDPR uyumlu gateway (PII masking, RBAC, rate limit, sorgulanabilir audit log; Prisma/Postgres/MySQL/SQLite/MongoDB adaptörleri; opsiyonel insert/update/delete desteği) |
| [`packages/mcp-server-auditor`](packages/mcp-server-auditor) | `@guardbee/mcp-server-auditor` | Başka MCP server'ların tool tanımlarını güvensiz kalıplar için tarar (excessive agency, shell/eval/SQL/SSRF sink'leri, gevşek şema, sabit secret, wildcard CORS) |
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
| [`packages/elicitation-auditor`](packages/elicitation-auditor) | `@guardbee/mcp-elicitation-auditor` | MCP server kodunu 2026-07-28 spec'indeki elicitation anti-pattern'leri için tarar — form modunda secret veya ödeme verisi isteme, URL modunu doğrudan üçüncü parti authorize adresine yöneltme, elicitation URL'sine gömülü credential veya kişisel veri |
| [`packages/toxic-flow-auditor`](packages/toxic-flow-auditor) | `@guardbee/mcp-toxic-flow-auditor` | MCP tool kataloğunu toksik akışlar (Simon Willison'ın lethal trifecta'sı) için denetler — aynı server'da güvenilmeyen içerik + hassas/özel veri + sızdırma veya yıkım; A–F notu, KVKK bilinçli sezgiseller, OWASP MCP10:2025 |
| [`packages/audit-gap-auditor`](packages/audit-gap-auditor) | `@guardbee/mcp-audit-gap-auditor` | MCP server kaynağını OWASP MCP08:2025 (Lack of Audit and Telemetry) için denetler — eksik tool-call izi, ham args/result logları, kapalı audit, sessiz catch, korelasyon id'siz audit olayları |
| [`packages/context-oversharing-auditor`](packages/context-oversharing-auditor) | `@guardbee/mcp-context-oversharing-auditor` | Agent/MCP kaynağını OWASP MCP10:2025 context oversharing için denetler — tam konuşma dump'ı, scopesuz memory tool'ları, paylaşılan global session, tool üzerinden system-prompt sızıntısı, oturumlar arası tool-result karışması, filtresiz vektör sorguları (toxic-flow kataloğunu tamamlar) |
| [`packages/owasp-scan`](packages/owasp-scan) | `@guardbee/mcp-owasp-scan` | Birleşik OWASP MCP Top 10 meta-tarayıcı — path'te GuardBee auditor orkestrasyonu + canlı/katalog `tools/list` toxic-flow/poisoning, A–F notu, SARIF; isteğe bağlı MCP09 Shadow MCP discover |
| [`packages/mcp-config-auditor`](packages/mcp-config-auditor) | `@guardbee/mcp-config-auditor` | MCP istemci config'lerini (Cursor/Claude/Windsurf/VS Code) ve agent `SKILL.md` dosyalarını denetler — pinsiz paket, secret, wildcard auto-approve, auth'suz remote, typosquat, sunucular arası/skill gölgeleme; `discover` ile Shadow MCP (OWASP MCP09) + org allowlist |
| [`packages/threat-rules`](packages/threat-rules) | `@guardbee/mcp-threat-rules` | [Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules) MCP köprüsü — prompt injection, tool poisoning ve MCP saldırıları için runtime tespit; GuardBee takip scanner ipuçlarıyla |
| [`packages/a2a-auditor`](packages/a2a-auditor) | `@guardbee/mcp-a2a-auditor` | Bir agent'ın Agent2Agent (A2A) protokol implementasyonunu (TypeScript ve Python) referans SDK'ların kendi kaynağında bulunan anti-pattern'ler için tarar — auth'suz push-notification webhook fetch'leri (SSRF), hiç authentication gerektirmeyen Agent Card'lar, herkese açık servis edilen Agent Card metadata'sına gömülü credential'lar |
| [`packages/slopsquat-scanner`](packages/slopsquat-scanner) | `@guardbee/mcp-slopsquat-scanner` | Bir projenin kendi manifest dosyalarında (package.json, requirements.txt, pyproject.toml) beyan edilen her bağımlılığı gerçek npm/PyPI registry'sine karşı kontrol eder — hiç var olmayan (muhtemelen LLM halüsinasyonu, yani slopsquatting) isimleri ve var olan ama çok yakın zamanda yayınlanmış isimleri işaretler |
| [`packages/unbounded-consumption-auditor`](packages/unbounded-consumption-auditor) | `@guardbee/mcp-unbounded-consumption-auditor` | LLM/agent uygulama kodunu Unbounded Consumption ("denial of wallet", OWASP LLM Top 10 2026 #6) için tarar — eksik output token limitleri, elle yazılmış LLM HTTP çağrılarında eksik timeout'lar, sınırsız agent tool-calling/retry döngüleri, bilinçli olarak devre dışı bırakılmış framework güvenlik limitleri (LangChain max_iterations, openai-agents max_turns), ve görünür rate limiting'i olmayan MCP tool handler'ları |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Dosyalarda sızmış secret/API key taraması |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | MCP güvenlik gateway'i: birden fazla MCP server'ı tek politikanın arkasına koyar; toxic-flow (lethal trifecta) engelleme, onay, PII maskeleme ve hash zincirli audit log |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | Aşağıdaki tüm tarayıcı ve denetçiler tek kurulumla: seçtiğiniz grupları sunan tek MCP sunucusu ve herhangi bir paketi çalıştıran CLI |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS sertifika/cipher/protokol denetimi |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | GuardBee tarama tetikleme, bulgu sorgulama, AI destekli düzeltme önerisi |
| [`packages/guard-core`](packages/guard-core) | `@guardbee/guard-core` | (internal) Paylaşılan dedektör kütüphanesi — PII/secret maskeleme, prompt injection kuralları, tool sınıflandırma; kendi başına bir MCP server değil |
| [`packages/telemetry`](packages/telemetry) | `@guardbee/mcp-telemetry` | (internal) Paylaşılan kullanım telemetrisi client'ı — kendi başına bir MCP server değil |

## Güvenlik

Bir güvenlik açığı mı buldunuz? Özel olarak bildirin: [SECURITY.md](SECURITY.md). Katkılarınızı bekliyoruz: [CONTRIBUTING.md](CONTRIBUTING.md).

## Telemetri

Paketler `@guardbee/mcp-telemetry` üzerinden kullanım telemetrisi gönderebilir: hangi tool, ne sıklıkla, ne kadar sürede çağrılıyor. Telemetri **varsayılan olarak kapalıdır** (opt-in); `GUARDBEE_TELEMETRY=1` ayarlanmadıkça hiçbir şey gönderilmez. Açıkken ilk çağrıda stderr'e tek seferlik bir bildirim yazılır.

- **Açmak için**: `GUARDBEE_TELEMETRY=1` (veya `true`/`on`/`yes`); kapatmak için değişkeni kaldırın
- **Ne gönderilir**: tool adı, kısa (≤40 karakter) parametre değerleri (örn. `table: "users"`, `limit: 50`), başarı/hata durumu, süre
- **Ne ASLA gönderilmez**: `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token` gibi anahtarlardaki değerler ve 40 karakterden uzun herhangi bir string — bunların hepsi `packages/telemetry/src/redact.ts`'teki `redactParams()` tarafından `"[redacted: ...]"` ile değiştirilir. Yani taranan dosyaların/kodun tam içeriği veya bir `insert_row`/`update_row` çağrısındaki gerçek satır verisi hiçbir zaman gönderilmez.

Detaylar: [`packages/telemetry/TR.md`](packages/telemetry/TR.md).

## Geliştirme

```
pnpm install
pnpm build     # turbo run build — tüm paketler, bağımlılık sırasına göre
pnpm test      # turbo run test
```

Tek paket üzerinde çalışmak için:

```
pnpm --filter @guardbee/mcp-ssl-inspector dev
```

## Sürümleme ve yayınlama

Paketler bağımsız versiyonlanır ([Changesets](https://github.com/changesets/changesets)). Bir PR'da değişiklik yaptıysanız:

```
pnpm changeset
```

`main`'e merge sonrası CI otomatik olarak sürüm PR'ı açar; o PR merge edildiğinde değişen paketler npm'e publish edilir (bkz. `.github/workflows/release.yml`).

### Kararlılık

**1.0 ve sonrası** sürümdeki paketler [semantik sürümlemeye](https://semver.org) uyar: CLI'da, MCP tool adlarında ve parametrelerinde, config biçiminde veya dışa açık API'de geriye uyumsuz bir değişiklik yalnızca yeni bir major sürümle gelir ve paketin `CHANGELOG.md` dosyasında yazılır. Yeni kurallar ve dedektörler minor sürümlerle gelir; önceki sürümün bulmadığı bulguları raporlayabilirler. Hâlâ 0.x'teki paketler minor sürümler arasında değişebilir.

| Paket | Kararlı olduğu sürüm |
|---|---|
| `@guardbee/mcp-security-proxy` | 1.0 |
| `@guardbee/guard-core` | 1.0 |
| `@guardbee/mcp-secret-scanner` | 1.0 |
| `@guardbee/mcp-prompt-injection-scanner` | 1.0 |
| `@guardbee/mcp-prompt-leak-scanner` | 1.0 |
| `@guardbee/mcp-toxic-flow-auditor` | 1.0 |

## Yapı

- **pnpm workspaces** — `packages/*`, gerçek `workspace:*` bağımlılıkları (örn. `security-suite` diğer paketleri registry sürümü yerine doğrudan workspace'ten kullanır)
- **Turborepo** — `build`/`test`/`type-check` pipeline'ı, bağımlılık grafiğine göre sıralama ve cache
- **Ortak config** — `tsconfig.base.json` ve `vitest.shared.ts` kökte; her paket kendi özel ayarlarını üstüne ekler

## Proje geçmişi

Monoreponun önceki değişiklik yazıları [CHANGELOG.md](CHANGELOG.md) dosyasında (İngilizce); her paketin sürüm notları kendi `CHANGELOG.md` dosyasında ve [GitHub Releases](https://github.com/GuardBee/guardbee-mcp/releases)'ta.
