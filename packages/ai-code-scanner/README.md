# @guardbee/mcp-ai-code-scanner

MCP (Model Context Protocol) sunucusu — kod tabanınızı, LLM/AI entegrasyonlarında sık görülen güvenlik kalıpları için tarar.

`secret-scanner` sırlar/API key'ler ararken, bu paket **kalıp** arar: modelin çıktısına ne kadar güvenildiği, modelin çağırabildiği tool'ların ne kadar yetkili olduğu, hangi verinin üçüncü taraf bir LLM'e gönderildiği gibi, statik bir credential taramasıyla yakalanamayan riskler.

```
Claude ──► ai-code-scanner ──► Kod tabanınız
              │
              ├─ Client-exposure    (dangerouslyAllowBrowser: true)
              ├─ Output handling    (eval(llmOutput), JSON.parse doğrulamasız)
              ├─ Excessive agency   (execute_command adlı bir agent tool'u)
              ├─ Data privacy       (email/tcKimlik doğrudan prompt'a)
              └─ Prompt injection   (system prompt'a ham request verisi)
```

---

## Özellikler

- **10 kalıp, 5 kategori** — client-exposure, output-handling, excessive-agency, data-privacy, prompt-injection
- Her bulguda **neden riskli olduğu ve ne yapılması gerektiği** (`recommendation`) — sadece "bulundu" demez
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 28 unit test — her kalıp için hem pozitif hem negatif (yanlış-pozitif) senaryo

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-ai-code-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-ai-code-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-ai-code-scanner scan ./src --fail-on=high --format=sarif > results.sarif
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
| client-exposure | `openai_dangerously_allow_browser` | critical | OpenAI key'i tarayıcıya sızıyor |
| client-exposure | `client_bundled_ai_api_key` | critical | `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` ile AI key bundle'a giriyor |
| output-handling | `eval_llm_output` | critical | Model çıktısı `eval()`/`Function()` ile kod olarak çalıştırılıyor |
| output-handling | `exec_llm_output` | critical | Model çıktısı shell komutuna geçiriliyor (command injection) |
| output-handling | `llm_output_dangerously_set_inner_html` | high | Model çıktısı ham HTML olarak render ediliyor (XSS) |
| output-handling | `llm_json_no_validation` | medium | Model çıktısı şema doğrulaması olmadan `JSON.parse` ediliyor |
| excessive-agency | `excessive_agency_tool_name` | high | Agent'a shell/kod çalıştırma yetkisi veren bir tool |
| excessive-agency | `unbounded_agent_loop` | medium | Iterasyon sınırı olmayan agent döngüsü (maliyet/DoS) |
| data-privacy | `pii_field_in_llm_prompt` | high | E-posta/TC kimlik/kart no gibi veri doğrudan prompt'a giriyor |
| prompt-injection | `unsanitized_input_in_system_prompt` | medium | Ham request/kullanıcı verisi system prompt'a karışıyor |

Bunlar **heuristic** bulgulardır — tam bir AST analizi değil, statik metin kalıbı taraması yapar. Düşük yanlış-pozitif oranı için tasarlandı ama her bulgu yine de manuel gözden geçirilmelidir.

---

## Yapılandırma (`guardbee.yml`)

```yaml
ai-code-scanner:
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
npm test             # 28 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
