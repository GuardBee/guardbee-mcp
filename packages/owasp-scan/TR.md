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
| `installed` | Girdi yok: bu makinedeki MCP istemci configlerini okur | Kurulu her sunucuya bağlanır; her sunucu için `live` kontrolleri ve sunucular arası kontroller |

### `installed`: bu makinedeki tüm sunucular

`installed`; Claude Desktop, Claude Code (kullanıcı ve proje bazlı), Cursor, VS Code, Windsurf, Cline, Roo Code, Zed, Gemini CLI, Codex (`~/.codex/config.toml`), Kiro, Copilot CLI, Amazon Q, LM Studio ve opencode configlerindeki MCP sunucularını bulur, her birine bir kez bağlanır ve şunları raporlar:

- **Sunucu başına:** `tools/list` içindeki tool poisoning ve zehirli akışlar.
- **Sunucular arası:** Ajan bağlı tüm sunucuların araçlarını aynı anda görür. Üç masum görünen sunucuya bölünmüş lethal trifecta (`cross_server_lethal_trifecta`) ve iki sunucuda aynı ya da benzer araç adı (`cross_server_tool_shadow`, `confusable_tool_name`) raporlanır.
- **Son çalıştırmadan beri değişiklikler (rug pull):** İlk çalıştırmada araç tanımları `~/.guardbee/tool-pins` altına sabitlenir. Değişen açıklama ya da şema, o sunucunun pin dosyasını silip yeniden onaylayana kadar her çalıştırmada `tool_definition_drift` (critical) olarak raporlanır. Pin dosyaları env ya da header değerlerini içermez.
- **Shadow MCP (MCP09):** `--allowlist=<yol>` ile onaylı olmayan sunucular.

Uzak sunuculara her zaman configteki header'larla, önce Streamable HTTP sonra legacy SSE ile bağlanılır. **Yerel (stdio) sunucular yalnızca `--run-stdio` ile başlatılır**, çünkü başlatmak kodlarını configteki env ile makinende çalıştırmak demektir. Devre dışı kayıtlar hiç başlatılmaz.

```bash
npx @guardbee/mcp-owasp-scan installed --run-stdio --allowlist=./mcp-allowlist.json --format=sarif --fail-on=high
```

`scan`, TypeScript/JavaScript, Python (FastMCP, resmi SDK, düşük seviyeli server) ve Go (resmi go-sdk, mark3labs/mcp-go) MCP server'larını tam okur: tool tanımları, handler sink'leri ve OAuth kuralları. Diğer diller (Rust, Java, Kotlin, C#, Ruby, PHP, Swift) yalnızca dilden bağımsız kuralları alır (secret'lar, URL'ler, config). Rapordaki `coverage`, her kaynak dosyayı dili, bu derinlik (`full` ya da `patterns`) ve bulunan tool tanımı sayısıyla, ayrıca dil bazında bir özetle (metin çıktısında `languages:`) listeler; böylece taramanın derin okuyamadığı bir dosya sessizce geçmiş gibi görünmez.

`--discover-shadow`, `scan`'e bir **MCP09** kontrolü ekler: bu makinede yapılandırılmış MCP sunucularını (Cursor, Claude Desktop, Windsurf, VS Code) `mcp-config-auditor` ile listeler; `--allowlist=<path>` onaylı olanları işaretler.

## OWASP MCP Top 10 kapsamı

| ID | Risk | Kapsayan |
|---|---|---|
| MCP01 | Token / kimlik bilgisi sızıntısı | secret-scanner, mcp-server-auditor |
| MCP02 | Yetki / aşırı yetkili ajan | mcp-server-auditor |
| MCP03 | Tool poisoning / rug pull yüzeyi | tool-poisoning-scanner (`scan`, `live`, `catalog`) |
| MCP04 | Tedarik zinciri | İsteğe bağlı: `--with-supply-chain` / `withSupplyChain` ile [`mcp-dependency-auditor`](../dependency-auditor) (OSV) ve [`mcp-slopsquat-scanner`](../slopsquat-scanner) (ağ gerekir). Kapalıyken `notRun` içinde |
| MCP05 | Tool'lar üzerinden komut / kod enjeksiyonu | mcp-server-auditor |
| MCP06 | Prompt / bağlam enjeksiyonu | İsteğe bağlı: `--with-content` / `withContent` ile [`mcp-prompt-injection-scanner`](../prompt-injection-scanner). Kapalıyken `notRun` içinde |
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
