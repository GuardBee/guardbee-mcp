# @guardbee/mcp-owasp-scan

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

Birleşik bir **[OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) kontrolü** için tek CLI ve MCP sunucusu. Bir kod tabanında yedi GuardBee denetçisini tek seferde çalıştırır ya da canlı bir MCP sunucusunun tool listesini notlar; her bulguyu OWASP kimliğiyle ve A–F notuyla raporlar. Çıktı metin, JSON veya GitHub code scanning için SARIF olabilir.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

## Hızlı başlangıç

```bash
# Bir reponun statik taraması; high veya critical bulguda CI başarısız olsun
npx @guardbee/mcp-owasp-scan scan ./src --format=sarif --fail-on=high > owasp.sarif

# Çalışan bir MCP sunucusuna bağlan ve tool'larını notla
npx @guardbee/mcp-owasp-scan live --url=https://mcp.example.com/mcp
npx @guardbee/mcp-owasp-scan live --stdio=npx --arg=-y --arg=@modelcontextprotocol/server-filesystem --arg=.

# Kaydedilmiş bir tools/list yanıtını notla
npx @guardbee/mcp-owasp-scan catalog ./tools.json --format=json
```

MCP sunucusu olarak (Claude Desktop, Cursor, VS Code):

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

## Modlar

| Mod | Girdi | Ne çalışır |
|---|---|---|
| `scan <path>` | Dosya veya klasör | secret-scanner, mcp-server-auditor, oauth-auditor, audit-gap-auditor, context-oversharing-auditor, toxic-flow-auditor, tool-poisoning-scanner |
| `live` | `--url=<streamable HTTP URL>` ya da `--arg=…` ile `--stdio=<komut>` | Bağlanır, `tools/list` çağırır, ardından toxic-flow-auditor ve tool-poisoning-scanner |
| `catalog <tools.json>` | Bir `tools/list` dökümü (`{ "tools": [...] }` ya da düz dizi) | `live` ile aynı kontroller, çevrimdışı |

`--discover-shadow`, `scan`'e bir **MCP09** kontrolü ekler: bu makinede yapılandırılmış MCP sunucularını (Cursor, Claude Desktop, Windsurf, VS Code) `mcp-config-auditor` ile listeler; `--allowlist=<path>` onaylı olanları işaretler.

## OWASP MCP Top 10 kapsamı

| ID | Risk | Kapsayan |
|---|---|---|
| MCP01 | Token / kimlik bilgisi sızıntısı | secret-scanner, mcp-server-auditor |
| MCP02 | Yetki / aşırı yetkili ajan | mcp-server-auditor |
| MCP03 | Tool poisoning / rug pull yüzeyi | tool-poisoning-scanner (`scan`, `live`, `catalog`) |
| MCP04 | Tedarik zinciri | Bu taramada yok: ağ gerektiren [`mcp-dependency-auditor`](../dependency-auditor) ve [`mcp-slopsquat-scanner`](../slopsquat-scanner) kullanın |
| MCP05 | Tool'lar üzerinden komut / kod enjeksiyonu | mcp-server-auditor |
| MCP06 | Prompt / bağlam enjeksiyonu | Bu taramada yok: ajanın okuduğu içerik için [`mcp-prompt-injection-scanner`](../prompt-injection-scanner) kullanın |
| MCP07 | Auth / OAuth yanlış yapılandırması | oauth-auditor |
| MCP08 | Denetim ve telemetri eksikliği | audit-gap-auditor |
| MCP09 | Gölge MCP sunucuları | mcp-config-auditor (`--discover-shadow`) |
| MCP10 | Zehirli akışlar / bağlam aşırı paylaşımı | toxic-flow-auditor, context-oversharing-auditor (`scan`, `live`, `catalog`) |

## Not

| Not | Ne zaman |
|---|---|
| **F** | Lethal trifecta: tek bir ajan güvenilmeyen içeriği okuyabiliyor, hassas veriye erişebiliyor ve veriyi dışarı gönderebiliyor |
| **D** | Herhangi bir critical bulgu |
| **C** | Herhangi bir high bulgu |
| **B** | Yalnızca medium veya low bulgular |
| **A** | Bulgu yok |

## CLI seçenekleri

| Seçenek | Varsayılan | Anlamı |
|---|---|---|
| `--format=text\|json\|sarif` | `text` | Rapor biçimi. SARIF, GitHub code scanning'e yüklenir |
| `--fail-on=any\|critical\|high\|medium\|none` | `any` | Bu şiddette veya üstünde bulgu varsa 1 ile çıkar |
| `--max-files=<n>` | `5000` | Klasör taramasını bu kadar dosyadan sonra durdurur |
| `--discover-shadow` | kapalı | `scan`'e MCP09 makine envanterini ekler |
| `--allowlist=<path>` | – | `--discover-shadow` için onaylı sunucular |

Çıkış kodları: `0` temiz (ya da `--fail-on` altında), `1` `--fail-on` ve üstünde bulgu, `2` kullanım hatası.

## MCP tool'ları

| Tool | Ne yapar |
|---|---|
| `owasp_scan_path` | Bir yol üzerinde `scan` modu (`path`, `maxFiles`, `discoverShadow`, `allowlistPath`) |
| `owasp_scan_live` | `live` modu (`url` ya da `args` ile `command`) |
| `owasp_scan_catalog` | Bir JSON metni üzerinde `catalog` modu |
| `list_owasp_coverage` | Yukarıdaki kapsam tablosu |

## GitHub Actions

```yaml
- run: npx -y @guardbee/mcp-owasp-scan scan . --format=sarif --fail-on=high > owasp.sarif
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: owasp.sarif
```

## İlgili paketler

Her denetçi daha fazla seçenekle ayrı bir paket olarak da var: [`mcp-secret-scanner`](../secret-scanner), [`mcp-server-auditor`](../mcp-server-auditor), [`mcp-oauth-auditor`](../oauth-auditor), [`mcp-audit-gap-auditor`](../audit-gap-auditor), [`mcp-context-oversharing-auditor`](../context-oversharing-auditor), [`mcp-toxic-flow-auditor`](../toxic-flow-auditor), [`mcp-tool-poisoning-scanner`](../tool-poisoning-scanner), [`mcp-config-auditor`](../mcp-config-auditor). Bu kuralları kodda bulmak yerine çalışma anında uygulamak için MCP sunucularınızın önüne [`mcp-security-proxy`](../security-proxy) koyun.

## Geri bildirim

Sorunuz, öneriniz ya da yanlış bir alarm mı var? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)'ta bir konu açın veya [issue oluşturun](https://github.com/GuardBee/guardbee-mcp/issues). GuardBee işinize yaradıysa [repoya](https://github.com/GuardBee/guardbee-mcp) bir ⭐ başkalarının da bulmasına yardım eder.
