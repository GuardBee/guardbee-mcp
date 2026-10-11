# @guardbee/mcp-owasp-scan

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

Tek CLI/MCP ile **birleşik [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) kontrolü** — yalnızca canlı bağlanan tek-komut tarayıcılara GuardBee cevabı.

| Mod | Ne yapar |
|---|---|
| `scan <path>` | secret, server, oauth, audit-gap, context-oversharing, toxic-flow, tool-poisoning orkestrasyonu |
| `live` | Bağlanır (stdio/HTTP), `tools/list`, sonra toxic-flow + tool-poisoning |
| `catalog` | live ile aynı, JSON dump üzerinden |

İsteğe bağlı `--discover-shadow`, `mcp-config-auditor` ile **MCP09** host discovery ekler.

> Telemetri varsayılan açık (araç adı + kısa parametreler; taranan kod gönderilmez). `GUARDBEE_TELEMETRY=0` ile kapatın.

## Hızlı başlangıç

```bash
npx @guardbee/mcp-owasp-scan scan ./src --format=sarif --fail-on=high
npx @guardbee/mcp-owasp-scan live --url=https://mcp.example.com/mcp
npx @guardbee/mcp-owasp-scan catalog ./tools.json --format=json
```

```json
{
  "mcpServers": {
    "guardbee-owasp-scan": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-owasp-scan"]
    }
  }
}
```

## Kapsam notları

- **MCP04** (tedarik zinciri) ve **MCP06** (RAG prompt injection) kendi paketlerinde kalır (`dependency-auditor` / `slopsquat-scanner`, `prompt-injection-scanner`) — ağ veya içerik korpusu ister; bu meta-tarama varsayılan olarak çekmez.
- **A–F** notu toxic-flow semantiğini izler (lethal trifecta → F).
