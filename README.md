# guardbee-mcp

GuardBee'nin MCP (Model Context Protocol) server ailesi — tek monorepo, bağımsız npm paketleri.

## Paketler

| Paket | npm | Açıklama |
|---|---|---|
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA uyumluluk kontrolü |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | npm/pip/cargo bağımlılıklarında CVE taraması (OSV) |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS kayıtları, yanlış yapılandırma, dangling subdomain tespiti |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | LLM↔DB arası KVKK/GDPR uyumlu gateway (PII masking, RBAC, rate limit, audit log; Prisma/Postgres/MySQL adaptörleri; opsiyonel insert/update/delete desteği) |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Dosyalarda sızmış secret/API key taraması |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | MCP client↔server arası güvenlik proxy'si |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | secret-scanner + dependency-auditor + ssl-inspector + dns-intelligence bundle'ı |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS sertifika/cipher/protokol denetimi |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | GuardBee tarama tetikleme, bulgu sorgulama, AI destekli düzeltme önerisi |

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
