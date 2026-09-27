# @guardbee/mcp-rug-pull-detector

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — başka bir MCP server'a **canlı** bağlanıp bir **MCP rug pull**'u tespit eder: bir server'ın onayladığınızda bir tool tanımı sunup sonradan sessizce farklı birini sunması.

Bu monorepo'daki diğer her scanner kaynak kodu ya da bir config dosyasını bir kez okur. Bu paket mimari olarak farklı: bir MCP *client*'ı. Hedef server'ı spawn ediyor (stdio) ya da onunla bir session açıyor (Streamable HTTP), gerçek `tools/list` RPC'sini çağırıyor ve ne gördüğünü hatırlıyor — bir SSH client'ının host key'ler için kullandığı aynı trust-on-first-use modeli. Bir tool'un description'ının, input/output schema'sının ya da annotation'larının aynı server'a iki çağrı arasında değişmesi, o server'ın kaynağının statik bir analizinin asla yakalayamayacağı bir şey, çünkü server kaynağını hiç değiştirmemiş olabilir — hangi client'a ne söyleyeceğine server-side, request anında karar verebiliyor.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, hedef server'ın tool içeriği hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► rug-pull-detector ──► (spawn eder / bağlanır) ──► Hedef MCP server
              │                                                  │
              │                                          tools/list (gerçek RPC)
              ▼
         .guardbee/tool-baselines/<hash>.json
              │
    ilk temas: baseline_server → her tool için canonical hash sakla
    sonraki her seferinde: check_server → yeniden çek, kayıtlı hash'e karşı diff'le
```

---

## Trust-on-first-use modeli

`baseline_server` bir kez bağlanıp her tool'un `{name, description, inputSchema, outputSchema, annotations}`'ını çekiyor, canonicalize ediyor (deep key-sıralı JSON) ve bir SHA-256 hash'i artı tam snapshot'ı saklıyor — server başına `.guardbee/tool-baselines/` altında bir JSON dosyası.

Her `check_server` canlı `tools/list` üzerinde tool-poisoning katalog taramasını da çalıştırır. Bu, sunucu ilk kez görülürken ve henüz baseline yokken de geçerlidir. Zehirli bir açıklama ikinci ziyareti beklemez.

`check_server` daha sonra tekrar bağlanıyor — bir version bump'tan sonra, her session'dan önce, bir schedule'da, seçtiğiniz herhangi bir sıklıkta — ve aynı bilgiyi yeniden çekiyor. Hash'i artık eşleşmeyen herhangi bir tool raporlanıyor:

- **critical** — *var olan* bir tool'un tanımı değişti (`tool_definition_drift`). Rug pull'un kendisi bu. Bulgu tam olarak hangi alanın değiştiğini (description / input schema / output schema / annotations) önce/sonra description metniyle birlikte söylüyor, çünkü `destructiveHint: true → false` de yeniden yazılmış bir description kadar bir yalan — ikisi de çağıranın neyi onayladığına inandığı şeyi değiştiriyor.
- **medium** — baseline'da olmayan *yeni* bir tool ortaya çıktı (`tool_added`). Meşru bir release olabilir. Yine de bakmaya değer — hiçbir şey bir server'ın zararsız olanlar zaten güven kazandıktan SONRA tehlikeli tool'unu tanıtmasını engellemiyor.
- **low** — *daha önce baseline'lanmış* bir tool artık sunulmuyor (`tool_removed`).

Hiç baseline yoksa, `check_server` otomatik olarak birini yakalayıp temiz raporluyor (bunun yerine önce açık bir `baseline_server` çağrısı gerektirmek için `autoBaseline: false` / `--no-auto-baseline` geçin).

---

## Özellikler

- **Gerçek MCP client** — mock değil, kaynak-kodu heuristic'i değil. Yönelttiğiniz herhangi bir server'a stdio ya da Streamable HTTP üzerinden gerçek protokolü konuşuyor.
- Canonical hashing isim, description, input schema, output schema **ve** annotation'ları (`readOnlyHint`, `destructiveHint`, ...) kapsıyor — bir server naif bir diff'in atlayacağı alanlara sadece dokunarak tespitten kaçamıyor.
- Hedef belirtmenin 3 yolu: `--stdio="command arg1 arg2"`, `--url=<http-url>`, ya da `--config=<file> --server=<name>` (bir `mcpServers`-tarzı JSON config'i doğrudan okur — bir Claude Desktop config'iyle aynı şekil)
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu
- 28 test: hashing/diffing/storage için saf unit test'ler, ayrıca bir fixture MCP server'a karşı (mock değil) **gerçek stdio process-spawning entegrasyon testleri** — drift, ekleme, kaldırma ve label izolasyonunu kapsıyor. `ai-code-scanner`'ın kendi gerçek, zaten yayınlanmış MCP server'ına karşı uçtan uca doğrulandı — gerçek stdio JSON-RPC üzerinden bağlandı, 4 gerçek tool'unu baseline'ladı, ikinci bir check'in temiz raporladığını doğruladı.

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-rug-pull-detector": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-rug-pull-detector"]
    }
  }
}
```

Sonra Claude'a eklemek üzere olduğunuz bir server'ı baseline'lamasını, ve periyodik olarak yeniden kontrol etmesini isteyin (örn. "bugün kullanmadan önce bu MCP server'ı baseline'ına karşı kontrol et").

### CLI (CI/CD ya da zamanlanmış kontrol)

```bash
# İlk temas — sadece server'ın tool'larını gözden geçirdikten sonra yapın
npx @guardbee/mcp-rug-pull-detector baseline --config=claude_desktop_config.json --server=some-third-party-server

# Sonraki her çalıştırma — örn. zamanlanmış bir job, ya da uygulamanız başlamadan hemen önce
npx @guardbee/mcp-rug-pull-detector check --config=claude_desktop_config.json --server=some-third-party-server --fail-on=critical
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `baseline_server` | Bir server'a bağlanıp mevcut tool'larını güvenilir baseline olarak saklar |
| `check_server` | Bir server'a bağlanıp mevcut tool'larını kayıtlı baseline'a karşı diff'ler |
| `list_baselines` | Kayıtlı baseline'ı olan her server'ı listeler |

---

## Yapılandırma

`guardbee.yml` bölümü yok — tek kalıcı state baseline dizininin kendisi (varsayılan `.guardbee/tool-baselines/`, `--baseline-dir` ile override edilebilir).

---

## Kısıtlamalar (bilinçli tasarım)

- **`--stdio` basit bir whitespace split kullanır**, shell-quote parsing değil — boşluk içeren bir komut/argüman bunu bozar. Basit bir komut satırının ötesinde herhangi bir şey için `--config=<file> --server=<name>` kullanın (gerçek bir `args` dizisi olan gerçek bir JSON config okuyor).
- **Baseline kimliği verdiğiniz `label`** (ya da vermezseniz komut satırı/URL), server'ın kendisiyle ilgili kriptografik bir şey değil — bir server'ı nasıl çağırdığınızı değiştirmek yeni bir baseline başlatır. Label'ı sabit tutun.
- Bu, **bir server'ın sunduğu tool listesindeki drift'i** tespit eder, her zaman orada olan bir tool çağrısının içindeki kötü niyetli davranışı değil. Rug-pull savunması bu, `mcp-server-auditor` ya da `tool-poisoning-scanner`'ın yerine geçmiyor — üçünü birden çalıştırın.
- Bir stdio hedefine bağlanmak **verdiğiniz komutu spawn etmek** anlamına geliyor — her MCP client'ın bir server'ı config'ine eklediğinizde zaten yaptığı aynı şey. Bunu sadece çalıştırmayı amaçladığınız server'lara yöneltin.

---

## Geliştirme

```bash
npm run build
npm test             # 28 test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
