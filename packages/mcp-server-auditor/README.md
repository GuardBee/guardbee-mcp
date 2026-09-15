# @guardbee/mcp-server-auditor

MCP (Model Context Protocol) sunucusu — **başka MCP server'ların** tool tanımlarını güvensiz kalıplar için tarar.

`ai-code-scanner` genel LLM/AI entegrasyon koduna bakarken, bu paket özellikle bir MCP server'ın kendisine bakar: `server.tool(...)` ile tanımlanan bir tool ne kadar yetkili, parametreleri ne kadar gevşek, handler'ı hangi tehlikeli sink'lere (shell/dosya sistemi/HTTP/SQL) doğrudan tool girdisi geçiriyor. MCP ekosistemi hızla büyüyor ama bu server'ların güvenlik denetimi için yaygın bir araç henüz yok.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, taranan kod hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

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
- Her bulguda **neden riskli olduğu ve ne yapılması gerektiği** (`recommendation`) — sadece "bulundu" demez
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 32 unit test — her kalıp için hem pozitif hem negatif (yanlış-pozitif) senaryo

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

Bunlar **heuristic** bulgulardır — tam bir AST/tip analizi değil, statik metin kalıbı taraması yapar. Düşük yanlış-pozitif oranı için tasarlandı ama her bulgu yine de manuel gözden geçirilmelidir.

---

## Yapılandırma (`guardbee.yml`)

```yaml
mcp-server-auditor:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - "**/*.test.ts"
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
