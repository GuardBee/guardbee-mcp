# guardbee-mcp

**🇹🇷 Türkçe** | [🇬🇧 English](README.en.md)

GuardBee'nin MCP (Model Context Protocol) server ailesi — tek monorepo, bağımsız npm paketleri.

## Paketler

| Paket | npm | Açıklama |
|---|---|---|
| [`packages/ai-code-scanner`](packages/ai-code-scanner) | `@guardbee/mcp-ai-code-scanner` | Kod tabanında insecure LLM/AI entegrasyon kalıpları taraması (client-exposed key, unsafe output handling, excessive agency, PII→prompt, prompt injection) |
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA uyumluluk kontrolü |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | npm/pip/cargo bağımlılıklarında CVE taraması (OSV) |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS kayıtları, yanlış yapılandırma, dangling subdomain tespiti |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | LLM↔DB arası KVKK/GDPR uyumlu gateway (PII masking, RBAC, rate limit, sorgulanabilir audit log; Prisma/Postgres/MySQL/SQLite/MongoDB adaptörleri; opsiyonel insert/update/delete desteği) |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Dosyalarda sızmış secret/API key taraması |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | MCP client↔server arası güvenlik proxy'si |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | secret-scanner + dependency-auditor + ssl-inspector + dns-intelligence bundle'ı |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS sertifika/cipher/protokol denetimi |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | GuardBee tarama tetikleme, bulgu sorgulama, AI destekli düzeltme önerisi |
| [`packages/telemetry`](packages/telemetry) | `@guardbee/mcp-telemetry` | (internal) Paylaşılan kullanım telemetrisi client'ı — kendi başına bir MCP server değil |

## Son Değişiklikler (2026-09-15)

`db-gateway` paketinde AI Gateway büyütme çalışmasına devam edildi:

- **`query_audit_log` tool'u** — Gateway'in kendi audit geçmişi artık `table`/`tool`/`operation`/`deniedOnly`/`since` filtreleriyle sorgulanabiliyor. Sink'ten (console/file/http) bağımsız, her zaman açık bir bellek-içi ring buffer'dan (`audit.bufferSize`, default 200) okuyor. Bu sırada read ve write tool'larının ayrı `AuditLogger` örneği kullanması yüzünden write olaylarının audit sorgusunda hiç görünmeyeceği bir hata da düzeltildi.
- **SQLite adaptörü** — `createSqliteAdapter`, `better-sqlite3` Database instance'ı kabul eder; pg/mysql adaptörleriyle aynı desende (`PRAGMA table_info` ile canlı şema doğrulaması) çalışır.
- **MongoDB adaptörü** — `createMongoAdapter`, bir MongoDB `Db` örneği kabul eder. Farklı bir risk sınıfına (SQL injection değil, "operator injection" — `$` ile başlayan key'ler, noktalı path'ler, operatör-objesi filter değerleri) karşı korunur.

Detaylı anlatım: [`packages/db-gateway/README.md#son-değişiklikler-2026-09-15`](packages/db-gateway/README.md#son-değişiklikler-2026-09-15).

## Telemetri

Her paket, `@guardbee/mcp-telemetry` üzerinden **varsayılan açık** kullanım telemetrisi gönderir: hangi tool, ne sıklıkla, ne kadar sürede çağrılıyor. İlk çağrıda stderr'e tek seferlik bir bildirim yazılır.

- **Kapatmak için**: `GUARDBEE_TELEMETRY=0` (veya `false`/`off`)
- **Ne gönderilir**: tool adı, kısa (≤40 karakter) parametre değerleri (örn. `table: "users"`, `limit: 50`), başarı/hata durumu, süre
- **Ne ASLA gönderilmez**: `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token` gibi anahtarlardaki değerler ve 40 karakterden uzun herhangi bir string — bunların hepsi `packages/telemetry/src/redact.ts`'teki `redactParams()` tarafından `"[redacted: ...]"` ile değiştirilir. Yani taranan dosyaların/kodun tam içeriği veya bir `insert_row`/`update_row` çağrısındaki gerçek satır verisi hiçbir zaman gönderilmez.

Detaylar: [`packages/telemetry/README.md`](packages/telemetry/README.md).

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

## Yapı

- **pnpm workspaces** — `packages/*`, gerçek `workspace:*` bağımlılıkları (örn. `security-suite` diğer 4 paketi registry sürümü yerine doğrudan workspace'ten kullanır)
- **Turborepo** — `build`/`test`/`type-check` pipeline'ı, bağımlılık grafiğine göre sıralama ve cache
- **Ortak config** — `tsconfig.base.json` ve `vitest.shared.ts` kökte; her paket kendi özel ayarlarını üstüne ekler
