# @guardbee/mcp-server-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

MCP (Model Context Protocol) sunucusu — **başka MCP server'ların** tool tanımlarını güvensiz kalıplar için tarar.

`ai-code-scanner` genel LLM/AI entegrasyon koduna bakarken, bu paket özellikle bir MCP server'ın kendisine bakar: `server.tool(...)` ile tanımlanan bir tool ne kadar yetkili, parametreleri ne kadar gevşek, handler'ı hangi tehlikeli sink'lere (shell/dosya sistemi/HTTP/SQL) doğrudan tool girdisi geçiriyor. MCP ekosistemi hızla büyüyor ama bu server'ların güvenlik denetimi için yaygın bir araç henüz yok.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

```
Claude ──► mcp-server-auditor ──► Bir MCP server'ın kaynak kodu
              │
              ├─ Excessive agency    (execSync(input.command), "run_shell" adlı bir tool)
              ├─ Unsafe input        (fetch(input.url) → SSRF, SQL string interpolation)
              ├─ Loose schema        (bir parametre z.any()/z.unknown() tipinde)
              ├─ Secrets exposure    (şema default'unda sabit API key, process.env'in tamamı)
              └─ Network exposure    (wildcard CORS)
```

---

## Özellikler

- **10 kalıp, 5 kategori** — excessive-agency, unsafe-input, loose-schema, secrets-exposure, network-exposure
- **Python ve Go server'ları**: tool girdisi, tool tanımından (FastMCP parametreleri, düşük seviyeli `arguments`, go-sdk tipli argümanları, mcp-go `request.RequireString(...)`) düz atamalar üzerinden shell, dosya yazma/silme, HTTP ve SQL çağrılarına kadar izlenir
- Her bulguda **neden riskli olduğu ve ne yapılması gerektiği** (`recommendation`) — sadece "bulundu" demez
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- Her kalıp için hem pozitif hem negatif (yanlış-pozitif) test; açık ve temiz Python ve Go fixture'ları

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-mcp-server-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-server-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-server-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_text` | Verilen bir metin/kod parçasını tarar |
| `scan_file` | Tek bir dosyayı tarar |
| `scan_directory` | Bir dizini recursive tarar (`node_modules`, `.git`, `dist` otomatik atlanır) |
| `list_patterns` | Desteklenen tüm kalıpları kategoriye göre listeler |

---

## Tespit Edilen Kalıplar

| Kategori | Kalıp | Önem | Ne demek |
|---|---|---|---|
| excessive-agency | `shell_exec_from_tool_input` | critical | Tool handler'ı, tool girdisini doğrudan `execSync`/`spawn` gibi bir shell çağrısına geçiriyor |
| excessive-agency | `eval_of_tool_input` | critical | Tool girdisi `eval()`/`new Function()` ile kod olarak çalıştırılıyor |
| excessive-agency | `unrestricted_shell_tool_name` | high | Tool adı (`run_shell`, `execute_sql` vb.) doğrudan shell/SQL çalıştırma yetkisi ima ediyor |
| unsafe-input | `fs_write_from_raw_tool_input` | high | Tool girdisindeki bir path, doğrulama olmadan dosya yazma/silme çağrısına geçiyor (path traversal) |
| unsafe-input | `ssrf_fetch_from_tool_input` | high | Tool girdisindeki bir URL, allowlist olmadan doğrudan `fetch`/`axios`'a geçiyor (SSRF) |
| unsafe-input | `sql_injection_via_tool_input` | critical | Tool girdisi bir SQL string'ine template-literal ile enjekte ediliyor |
| loose-schema | `overly_permissive_tool_schema` | medium | Bir tool parametresi `z.any()`/`z.unknown()` tipinde — her şeyi kabul ediyor |
| secrets-exposure | `hardcoded_secret_in_tool_schema` | critical | Credential-benzeri bir şema alanının default değeri sabit bir literal |
| secrets-exposure | `full_env_exposed_to_tool_caller` | critical | `process.env`'in tamamı spread/stringify/return ediliyor (tek bir named değişken değil) |
| network-exposure | `permissive_cors_on_server` | medium | Wildcard CORS (`Access-Control-Allow-Origin: *`) ya da opsiyonsuz `cors()` |

### Python ve Go

Python (`.py`) ve Go (`.go`) dosyalarına ayrıca tool-girdisi akış kontrolü uygulanır. Tool'un girdi adları tanımından okunur, handler içindeki düz atamalar üzerinden izlenir (`command = f"du {directory}"`) ve bir sink çağrısına ulaştığında bulgu verilir:

| Kalıp | Önem | Sink'ler |
|---|---|---|
| `python_shell_from_tool_input` | critical | `subprocess.*`, `os.system`, `os.popen`, `asyncio.create_subprocess_*` |
| `python_eval_of_tool_input` | critical | `eval`, `exec` |
| `python_fs_write_from_tool_input` | high | `open(..., "w"/"a"/"x")`, `os.remove`/`rename`/…, `shutil.rmtree`/`move`, `Path(...).write_text`/`unlink` |
| `python_ssrf_from_tool_input` | high | `requests.*`, `httpx.*`, `client.get(...)`, `urlopen` (URL argümanı) |
| `python_sql_injection_via_tool_input` | critical | `cursor.execute(f"...{x}...")`, `%` / `.format` / `+` |
| `go_shell_from_tool_input` | critical (`sh -c`), high (argüman listesi) | `exec.Command`, `exec.CommandContext` |
| `go_fs_write_from_tool_input` | high | `os.WriteFile`, `os.Remove`, `os.RemoveAll`, `os.Rename`, `os.Create`, yazma için `os.OpenFile` |
| `go_ssrf_from_tool_input` | high | `http.Get`/`Post`/`NewRequest…`, `client.Get` |
| `go_sql_injection_via_tool_input` | critical | `fmt.Sprintf` ya da `+` ile `db.Query…`/`Exec…` |

Handler path'i bir temel dizine göre kontrol ediyorsa (`is_relative_to`, `commonpath`, `.parents`, `filepath.IsLocal`, `filepath.Rel`, `strings.HasPrefix`) dosya bulguları, bir host allowlist'i kontrol ediyorsa HTTP bulguları verilmez. `run_shell`, `execute_sql` gibi adlı tool'lar iki dilde de raporlanır. Rust, Java, Kotlin, C# ve diğer diller yalnızca dilden bağımsız kalıpları alır.

Bunlar **heuristic** bulgulardır — tam bir AST/tip analizi değil, statik metin kalıbı taraması yapar. Düşük yanlış-pozitif oranı için tasarlandı ama her bulgu yine de manuel gözden geçirilmelidir.

---

## Yapılandırma (`guardbee.yml`)

```yaml
mcp-server-auditor:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - ".test.ts"
    - "fixtures/"
```

---

## Geliştirme

```bash
npm run build
npm test             # 32 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)

## Geri bildirim

Sorunuz, öneriniz ya da yanlış bir alarm mı var? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)'ta bir konu açın veya [issue oluşturun](https://github.com/GuardBee/guardbee-mcp/issues). GuardBee işinize yaradıysa [repoya](https://github.com/GuardBee/guardbee-mcp) bir ⭐ başkalarının da bulmasına yardım eder.
