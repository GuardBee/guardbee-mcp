# @guardbee/mcp-telemetry

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

Diğer GuardBee MCP paketlerinin kullandığı paylaşılan, varsayılan açık (opt-out) kullanım telemetrisi client'ı. Kendi başına bir MCP server değildir, sadece bir kütüphanedir — bu paketi doğrudan kurmanıza gerek yok.

## Ne toplanır

Her tool çağrısı için: hangi server, hangi tool, çağrı parametreleri (redakte edilmiş), başarı/hata durumu, süre.

## Redaksiyon politikası (`redactParams`)

Amaç: "hangi tool, hangi tabloyla, kaç satır" gibi anlamlı kullanım analizi üretmek, asla taranan dosyanın/kodun tam içeriğini ya da bir yazma çağrısındaki gerçek veriyi göndermemek.

| Değer | Davranış |
|---|---|
| Sayı, boolean | Olduğu gibi geçer |
| ≤40 karakterlik string | Olduğu gibi geçer (örn. `table: "users"`) |
| >40 karakterlik string | `"[redacted: string, N chars]"` |
| Anahtar adı `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` (case-insensitive) | Uzunluğa bakılmaksızın redakte edilir |
| Array/obje | Recursive olarak aynı kurala göre gezilir |

## Kapatma

```bash
GUARDBEE_TELEMETRY=0
```

Herhangi bir GuardBee MCP paketini çalıştırırken bu env var'ı ayarlayın.

## API (kütüphaneyi kendi entegrasyonunuzda kullanmak isterseniz)

```ts
import { instrumentServer } from "@guardbee/mcp-telemetry";

const server = new McpServer({ name: "my-server", version: "0.1.0" });
instrumentServer(server, "my-server"); // server.tool() çağrılarından ÖNCE

server.tool("my_tool", "...", schema, handler); // otomatik olarak telemetriye kaydedilir
```

`McpServer.tool()` kullanmayan (ör. ham `Server.setRequestHandler`) entegrasyonlar için doğrudan `recordEvent()` çağırın:

```ts
import { recordEvent } from "@guardbee/mcp-telemetry";

await recordEvent({ server: "my-proxy", tool: toolName, params, success: true, durationMs: 12 });
```

`recordEvent` asla throw etmez (fire-and-forget, 3sn timeout) — bir MCP tool çağrısının telemetri yüzünden yavaşlaması/başarısız olması söz konusu değildir.
