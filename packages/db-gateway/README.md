# @guardbee/mcp-db-gateway

**🇹🇷 Türkçe** | [🇬🇧 English](README.en.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Smithery](https://smithery.ai/badge/guardbee/mcp-db-gateway)](https://smithery.ai/servers/guardbee/mcp-db-gateway)

KVKK / GDPR uyumlu MCP (Model Context Protocol) sunucusu — LLM ile veritabanı arasına güvenlik katmanı ekler.

Claude veya başka bir LLM, veritabanınızı doğrudan sorgulamak yerine bu gateway üzerinden geçer. Hassas alanlar otomatik olarak maskelenir, tablo erişimleri rol bazlı kontrol edilir, her sorgu audit log'a yazılır.

> Bu paket varsayılan olarak GuardBee'ye kullanım telemetrisi gönderir (tool adı + kısa parametreler, örn. tablo adı — gerçek satır verisi/filtre değerleri hiçbir zaman dahil değil, bkz. [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Bu, gateway'in kendi local audit log'undan (`audit.filePath`) ayrı ve bağımsızdır. Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► MCP Gateway ──► Veritabanı
              │
              ├─ PII maskeleme   (tcKimlik → [REDACTED])
              ├─ Rol kontrolü    (ai-agent sadece products tablosuna erişir)
              ├─ Rate limiting   (dakikada max 100 sorgu)
              └─ Audit log       (her sorgu kayıt altına alınır)
```

---

## Özellikler

- **PII Maskeleme** — TC kimlik no, IBAN, e-posta, telefon, şifre hash vb. otomatik maskelenir
- **Rol Bazlı Erişim (RBAC)** — Her rol için tablo beyaz/kara listesi ve alan kuralları
- **Rate Limiting** — Global ve tablo bazlı istek penceresi
- **Audit Log** — Console, dosya veya HTTP webhook'a yazılabilir
- **Prisma / Postgres / MySQL / SQLite Adaptörleri** — Mevcut PrismaClient'ı, `pg` Pool'unu, `mysql2` Pool'unu veya `better-sqlite3` Database'ini doğrudan bağlayın
- **Yazma Desteği (opsiyonel)** — insert/update/delete, varsayılan kapalı; tablo+rol bazlı izin, korumalı alan koruması ve "tüm tabloyu etkileme" güvenlik ağı ile
- **174 unit test** — Masker, pipeline, RBAC, rate limiter, audit log ve tüm adaptörler (okuma + yazma) kapsanmış

---

## Son Değişiklikler (2026-09-15)

AI Gateway büyütme çalışmasının bu paketteki 2 yeni adımı:

### 1. `query_audit_log` tool'u

Daha önce gateway'in audit log'u yalnızca **yazılabilir**di — `console`/`file`/`http` sink'lerinden birine düşer, ama Claude'un kendisi "az önce ne oldu, hangi çağrılar reddedildi" diye geriye dönüp sorgulayamazdı. Artık sorgulanabilir:

```typescript
// Claude tarafında çağrılan tool:
query_audit_log({ table: "orders", deniedOnly: true, limit: 20 })
```

- **Nasıl çalışıyor:** `AuditLogger` sınıfına sink'ten tamamen bağımsız, her zaman açık bir bellek-içi ring buffer eklendi (`audit.bufferSize`, varsayılan 200). Sink `"http"` (fire-and-forget bir webhook) olsa bile geçmiş bu buffer üzerinden sorgulanabiliyor. Buffer süreç yeniden başladığında sıfırlanır; `audit.enabled: false` iken hiç doldurulmaz.
- **Filtreler:** `table`, `tool` (MCP tool adı, örn. `"delete_row"`), `operation` (`read`/`insert`/`update`/`delete`), `deniedOnly` (sadece reddedilenler), `since` (ISO 8601 zaman damgası), `limit` (varsayılan 50, max 200). Sonuçlar en yeniden en eskiye sıralı döner.
- **Yan yana düzeltilen gerçek hata:** `registerDbTools` (okuma tool'ları) ve `registerWriteTools` (yazma tool'ları) önceden **her biri kendi** `GatewayPipeline`/`AuditLogger` örneğini oluşturuyordu. Bu, `insert_row`/`update_row`/`delete_row` çağrılarının audit event'lerinin, `query_audit_log`'un okuduğu buffer'da **hiçbir zaman görünmeyeceği** anlamına geliyordu — iki ayrı, birbirinden habersiz buffer vardı. `server.ts` artık tek bir `GatewayPipeline` örneği oluşturup her iki tool grubuna da paylaştırıyor.
- **Test:** `src/__tests__/audit-logger.test.ts` (10 test — buffer capping, tüm filtreler, ring buffer davranışı) ve `pipeline.test.ts`'e eklenen 3 test (read+write'ın aynı buffer'a düştüğünü, deniedOnly+table filtresinin birlikte çalıştığını, `audit.enabled: false` iken buffer'ın boş kaldığını doğruluyor).

### 2. SQLite adaptörü

Gateway artık Prisma/Postgres/MySQL'in yanında `better-sqlite3` ile de çalışıyor:

```typescript
import Database from "better-sqlite3";
import { createServer, createSqliteAdapter } from "@guardbee/mcp-db-gateway";

const db = new Database("./app.db");
const server = createServer({}, createSqliteAdapter(db));
```

- **Güvenlik deseni pg/mysql ile aynı:** Tablo/kolon adları parametrize edilemediği için SQL'e gömülmeden önce doğrulanıyor — sadece burada `information_schema` yerine SQLite'a özgü `PRAGMA table_info(tablo)` kullanılıyor. Format kontrolünden geçmeyen (örn. `users"; DROP TABLE users;--`) veya şemada olmayan bir isim, hiçbir sorgu SQLite'a gitmeden reddediliyor.
- **`better-sqlite3` sadece opsiyonel bir `peerDependency`** — paketin kendi `devDependencies`'ine eklenmedi, çünkü native binding gerektiriyor ve testler (pg/mysql testlerindeki gibi) gerçek paketi import etmeden, `SqliteQueryable` arayüzüne uyan basit bir mock nesneyle yazıldı.
- **insert için `RETURNING` yerine `lastInsertRowid`:** SQLite'ın RETURNING desteği sürüme bağlı olduğundan, mysql adaptöründeki `insertId` yaklaşımı izlendi — tabloda `id` kolonu varsa ve `data` içinde zaten yoksa, eklenen satıra `lastInsertRowid` eklenir.
- **Bonus düzeltme:** `AuditEvent`/`AuditQueryFilter` tipleri paket kökünden (`index.ts`) hiç export edilmiyordu — `GatewayPipeline.queryAuditLog()`'u kendi kodunda tipli çağırmak isteyen tüketiciler için eklendi.
- **Test:** `src/__tests__/sqlite-adapter.test.ts` (21 test) — pg-adapter.test.ts ile aynı senaryo seti: tablo listesi, filtreli/filtresiz sorgu, limit, bilinmeyen tablo/kolon reddi, injection denemesi reddi, insert (id atama dahil), update, delete.

---

## Hızlı Başlangıç

### 1. Smithery ile Tek Tıkla Bağla

[Smithery](https://smithery.ai/servers/guardbee/mcp-db-gateway) üzerinden Claude Desktop'a tek tıkla ekleyebilirsiniz.

### 2. Global Kurulum ile Claude Desktop'a Bağla

```bash
npm install -g @guardbee/mcp-db-gateway
```

`~/Library/Application Support/Claude/claude_desktop_config.json` dosyasına ekleyin (macOS):

```json
{
  "mcpServers": {
    "guardbee-db-gateway": {
      "command": "guardbee-gateway",
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb"
      }
    }
  }
}
```

> **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
> **Linux:** `~/.config/Claude/claude_desktop_config.json`

Claude Desktop'ı yeniden başlatın. Demo veritabanı otomatik yüklenir, PII maskeleme aktif olur.

### 3. Projede Kullan (Prisma)

```bash
npm install @guardbee/mcp-db-gateway
```

```typescript
import { PrismaClient } from "@prisma/client";
import { createServer, createPrismaAdapter } from "@guardbee/mcp-db-gateway";

const prisma = new PrismaClient();

const server = createServer(
  {
    audit: { enabled: true, sink: "file", filePath: "./audit.jsonl" },
  },
  createPrismaAdapter(prisma)
);
```

Prisma kullanmıyorsanız, ham `pg` veya `mysql2` bağlantısını da doğrudan geçirebilirsiniz:

```typescript
// Postgres
import { Pool } from "pg";
import { createServer, createPgAdapter } from "@guardbee/mcp-db-gateway";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const server = createServer({}, createPgAdapter(pool /*, { schema: "public" } */));
```

```typescript
// MySQL
import mysql from "mysql2/promise";
import { createServer, createMysqlAdapter } from "@guardbee/mcp-db-gateway";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const server = createServer({}, createMysqlAdapter(pool /*, { database: "shop" } */));
```

```typescript
// SQLite
import Database from "better-sqlite3";
import { createServer, createSqliteAdapter } from "@guardbee/mcp-db-gateway";

const db = new Database("./app.db");
const server = createServer({}, createSqliteAdapter(db));
```

> **Güvenlik notu:** Prisma adaptörünün aksine `pg`/`mysql2`/`better-sqlite3` adaptörleri ham SQL üretir. Tablo ve kolon adları parametrize edilemediği için her sorguda canlı şemayla doğrulanır (`information_schema` ya da SQLite için `PRAGMA table_info`) — şemada olmayan bir tablo/kolon adı (örn. bir injection denemesi) SQL'e hiç ulaşmadan reddedilir.

---

## MCP Tools

Gateway her zaman şu 5 okuma tool'unu Claude'a sunar:

| Tool | Açıklama |
|------|----------|
| `query_table` | Tablodan satır sorgula (PII otomatik maskelenir) |
| `list_tables` | Erişilebilir tabloları listele (rol kısıtlamaları uygulanır) |
| `describe_table` | Tablo şeması ve maskeleme politikasını göster |
| `query_audit_log` | Gateway'in kendi audit geçmişini sorgula (tablo/tool/operation/deniedOnly/since filtreleriyle) — bellek-içi, `audit.bufferSize` ile sınırlı, süreç yeniden başlarsa sıfırlanır |
| `gateway_status` | Aktif config, roller ve rate limit durumunu göster |

`writesEnabled: true` ayarlandığında (bkz. [Yazma Desteği](#yazma-desteği-writeinsertupdatedelete)) 3 yazma tool'u daha eklenir:

| Tool | Açıklama |
|------|----------|
| `insert_row` | Yeni satır ekler |
| `update_row` | Filtreye uyan satırları günceller (boş filtre kabul edilmez) |
| `delete_row` | Filtreye uyan satırları siler (boş filtre kabul edilmez) |

---

## Yapılandırma

```typescript
createServer({
  // PII alan kuralları (ilk eşleşen uygulanır)
  fieldRules: [
    { field: "tcKimlik",     strategy: "redact" }, // [REDACTED]
    { field: "iban",         strategy: "mask"   }, // TR32***890
    { field: "email",        strategy: "mask"   }, // ah***@example.com
    { field: "passwordHash", strategy: "redact" },
    { field: "*Token*",      strategy: "redact" }, // glob pattern
  ],

  // Tablo erişim kuralları
  tableRules: [
    { table: "audit_logs", access: "deny"  },
    { table: "users",      access: "allow", maxRows: 25 },
    // write: tanımlanmazsa o tablo için hiçbir write izni yoktur (varsayılan kapalı)
    { table: "orders",     access: "allow", write: { insert: true, update: true, delete: false } },
  ],

  // Yazma tool'larını (insert_row/update_row/delete_row) aç — varsayılan false.
  // false iken bu tool'lar Claude'a hiç görünmez.
  writesEnabled: true,

  // update_row/delete_row bir filtreyle en fazla kaç satırı etkileyebilir.
  // Aşılırsa işlem hiç yapılmadan reddedilir ("filtreyi daraltın").
  maxAffectedRowsPerWrite: 10,

  // Varsayılan maksimum satır
  defaultMaxRows: 50,

  // Rate limiting
  rateLimit: {
    enabled: true,
    windowMs: 60_000,          // 1 dakika
    maxRequests: 100,           // global limit
    maxRequestsPerTable: 20,    // tablo başına
  },

  // Audit log
  audit: {
    enabled: true,
    sink: "file",              // "console" | "file" | "http"
    filePath: "./audit.jsonl",
    // webhookUrl: "https://..."  (sink: "http" için)
    bufferSize: 200,           // `query_audit_log` tool'unun okuduğu bellek-içi geçmiş boyutu
  },

  // Roller
  roles: [
    {
      name: "ai-agent",
      allowTables: ["products", "orders"],  // sadece bu tablolar
      maxRows: 10,
      // Rol write tanımlamazsa (undefined) o rol için write TAMAMEN kapalıdır,
      // tablo write'a açık olsa bile. Write istiyorsanız rolde de açıkça belirtin:
      write: { insert: true, update: true, delete: false },
    },
    {
      name: "analyst",
      denyTables: ["audit_logs"],           // bu tablo engellenir
      fieldRules: [
        { field: "email", strategy: "allow" }, // e-posta maskesiz
      ],
      // write tanımlanmadı → analyst hiçbir şey yazamaz
    },
  ],

  // Aktif rol (GATEWAY_ROLE env var ile de ayarlanabilir)
  activeRole: "ai-agent",
});
```

---

## Maskeleme Stratejileri

| Strateji | Açıklama | Örnek |
|----------|----------|-------|
| `redact` | Alan tamamen silinir | `[REDACTED]` |
| `mask` | Değerin ortası yıldızlanır | `ah***@example.com` / `530***67` |
| `hash` | SHA-256 (ilk 16 karakter) | `a665a45920422f9d` |
| `allow` | Olduğu gibi geçer | `ahmet@example.com` |

Glob pattern desteği: `*Password*`, `*Token*`, `*Secret*`

---

## Rol Bazlı Erişim (RBAC)

Rol, sunucu başlatılırken `GATEWAY_ROLE` env var'ı veya `config.activeRole` ile belirlenir.
Her Claude Desktop profili veya deployment farklı rol ile çalışabilir.

```bash
GATEWAY_ROLE=analyst node dist/cli.js
```

**Kural önceliği (yüksekten düşüğe):**
1. Global `tableRules` deny
2. Rol `denyTables`
3. Rol `allowTables` (whitelist — ayarlanmışsa tablo bu listede olmalı)
4. Rol `fieldRules` → global `fieldRules`

---

## Yazma Desteği (write/insert/update/delete)

Gateway varsayılan olarak **tamamen salt-okunurdur**. LLM'in veri değiştirebilmesi için bilinçli olarak birkaç kilidi açmanız gerekir:

1. **`writesEnabled: true`** — global kill-switch. `false` (default) iken `insert_row`/`update_row`/`delete_row` Claude'a hiç görünmez.
2. **Tablo izni** — `tableRules[].write.{insert,update,delete}` — her tablo için ayrı ayrı, varsayılan hepsi kapalı.
3. **Rol izni** (rol aktifse) — `roles[].write.{insert,update,delete}`. Rol write'ı hiç tanımlamamışsa (undefined) o rol için write tamamen kapalıdır — tablo izin verse bile. Write'a izin vermek için **hem tablo hem rol** açıkça `true` demelidir (AND mantığı; masking kurallarındaki "rol override eder" mantığından farklı, kasıtlı olarak daha katı).

Bu üç kilidin ötesinde iki ek koruma daha var, kapatılamaz:

- **Korumalı alan koruması** — `fieldRules`'da `redact`/`mask`/`hash` olarak işaretli bir alana (örn. `tcKimlik`, `passwordHash`) LLM asla değer yazamaz; `insert_row`/`update_row` böyle bir alanı `data` içinde görürse tüm isteği reddeder.
- **`maxAffectedRowsPerWrite`** — `update_row`/`delete_row` çağrılmadan önce filtre önce bir read ile denenir; eşleşen satır sayısı bu limiti (default 10) aşarsa işlem hiç yapılmadan reddedilir. `update_row`/`delete_row` ayrıca **boş filtreyi de her zaman reddeder** — "tüm tabloyu güncelle/sil" bu gateway üzerinden asla mümkün değildir.

Her write denemesi (kabul veya red) audit log'a yazılır; `data`'nın kendisi değil sadece hangi alanların yazıldığı loglanır (audit log'un kendisi bir PII sızıntı noktası olmasın diye).

```typescript
createServer({
  writesEnabled: true,
  maxAffectedRowsPerWrite: 10,
  tableRules: [
    { table: "orders", access: "allow", write: { insert: true, update: true, delete: false } },
  ],
  roles: [
    { name: "ai-agent", allowTables: ["orders"], write: { insert: true, update: true, delete: false } },
  ],
  activeRole: "ai-agent",
});
```

---

## Prisma Adaptörü

PrismaClient'ı doğrudan geçirin — tablo adı → model eşleştirmesi otomatik yapılır:

| Sorgu tablosu | Prisma modeli |
|---------------|---------------|
| `"users"` | `prisma.user` |
| `"audit_logs"` | `prisma.auditLog` |
| `"orders"` | `prisma.order` |
| `"orderItems"` | `prisma.orderItem` |

---

## Geliştirme

```bash
npm run dev          # tsx ile geliştirme modu
npm run build        # TypeScript derleme
npm test             # 174 unit test
npm run test:watch   # İzleme modu
npm run type-check   # Sadece tip kontrolü
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
