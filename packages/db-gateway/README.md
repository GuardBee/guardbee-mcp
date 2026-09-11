# @guardbee/mcp-db-gateway

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Smithery](https://smithery.ai/badge/guardbee/mcp-db-gateway)](https://smithery.ai/servers/guardbee/mcp-db-gateway)

KVKK / GDPR uyumlu MCP (Model Context Protocol) sunucusu — LLM ile veritabanı arasına güvenlik katmanı ekler.

Claude veya başka bir LLM, veritabanınızı doğrudan sorgulamak yerine bu gateway üzerinden geçer. Hassas alanlar otomatik olarak maskelenir, tablo erişimleri rol bazlı kontrol edilir, her sorgu audit log'a yazılır.

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
- **Prisma Adaptörü** — Mevcut PrismaClient'ı doğrudan bağlayın
- **61 unit test** — Masker, pipeline, RBAC, rate limiter ve Prisma adaptörü kapsanmış

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

---

## MCP Tools

Gateway aşağıdaki 4 tool'u Claude'a sunar:

| Tool | Açıklama |
|------|----------|
| `query_table` | Tablodan satır sorgula (PII otomatik maskelenir) |
| `list_tables` | Erişilebilir tabloları listele (rol kısıtlamaları uygulanır) |
| `describe_table` | Tablo şeması ve maskeleme politikasını göster |
| `gateway_status` | Aktif config, roller ve rate limit durumunu göster |

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
  ],

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
  },

  // Roller
  roles: [
    {
      name: "ai-agent",
      allowTables: ["products", "orders"],  // sadece bu tablolar
      maxRows: 10,
    },
    {
      name: "analyst",
      denyTables: ["audit_logs"],           // bu tablo engellenir
      fieldRules: [
        { field: "email", strategy: "allow" }, // e-posta maskesiz
      ],
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
npm test             # 61 unit test
npm run test:watch   # İzleme modu
npm run type-check   # Sadece tip kontrolü
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
