# @guardbee/mcp-prompt-injection-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — **içeriği** (RAG chunk'ı, scrape edilmiş bir web sayfası, bir doküman) dolaylı (indirect) prompt injection payload'ları için tarar.

`ai-code-scanner` ve `mcp-server-auditor` kod tarıyor; bu paket **veri** tarıyor. Klasik prompt injection kullanıcının kendisi kötü niyetli bir prompt yazar; dolaylı (indirect) prompt injection'da saldırgan modele hiç konuşmaz — bunun yerine modelin okuyacağı bir belgeye, web sayfasına ya da tool sonucuna talimat gömer. Model bu içeriği bir RAG retrieval'ı ya da bir web fetch sonucunda context'ine aldığı anda, gömülü talimat kullanıcının kendi talimatlarıyla aynı yetkiye sahip görünür.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, taranan içerik hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Web sayfası/RAG dokümanı ──► prompt-injection-scanner ──► LLM context'i
              │
              ├─ Instruction override   ("ignore all previous instructions")
              ├─ Role spoofing          ("System:", <|im_start|>, [INST])
              ├─ Hidden text            (zero-width karakter, display:none + talimat, HTML yorumu)
              ├─ Direct address         ("Dear AI, ...")
              └─ Exfiltration           (system prompt sızdırma isteği, data → URL talimatı, template'li img beacon)
```

---

## Özellikler

- **10 kalıp, 5 kategori** — instruction-override, role-spoofing, hidden-text, direct-address, exfiltration
- Her bulguda **neden riskli olduğu ve ne yapılması gerektiği** (`recommendation`) — sadece "bulundu" demez
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (bir knowledge-base repo'sunu PR'da otomatik tarama gibi)
- `guardbee.yml` ile config dosyası desteği
- 30 unit test — her kalıp için hem pozitif hem negatif (yanlış-pozitif) senaryo; özellikle emoji ZWJ dizileri ve normal `display:none` modal'ları gibi bilinen yanlış-pozitif kaynakları ayrıca test edilir

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-prompt-injection-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-prompt-injection-scanner"]
    }
  }
}
```

### CLI (CI/CD — örn. bir RAG knowledge-base reposunu her PR'da tara)

```bash
npx @guardbee/mcp-prompt-injection-scanner scan ./knowledge-base --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_text` | Verilen bir metin/doküman parçasını tarar |
| `scan_file` | Tek bir dosyayı tarar |
| `scan_directory` | Bir dizini (örn. RAG knowledge base) recursive tarar (`node_modules`, `.git`, `dist` otomatik atlanır) |
| `list_patterns` | Desteklenen tüm kalıpları kategoriye göre listeler |

---

## Tespit Edilen Kalıplar

| Kategori | Kalıp | Önem | Ne demek |
|---|---|---|---|
| instruction-override | `instruction_override_phrase` | high | "ignore/disregard/forget previous instructions" gibi klasik bir override cümlesi |
| role-spoofing | `system_role_spoof` | medium | İçerikte satır başında sahte bir "System:" rol etiketi |
| role-spoofing | `chat_template_marker_injection` | high | Ham chat-template kontrol token'ları (`<\|im_start\|>`, `[INST]`) içerikte |
| hidden-text | `hidden_zero_width_chars` | medium | Zero-width space/word-joiner (U+200B/U+2060) — insan gözünden gizli metin |
| hidden-text | `css_hidden_text_with_instruction` | high | `display:none`/beyaz-üzerine-beyaz bir element, içinde talimat-benzeri dil |
| hidden-text | `html_comment_instruction` | high | HTML yorumu içinde talimat-benzeri dil |
| direct-address | `direct_address_to_ai` | medium | İçerik doğrudan "the AI"/"the assistant"a hitap ediyor |
| exfiltration | `exfiltration_url_template_in_image` | high | Markdown görsel URL'inde `{{...}}`/`${...}` template — data-exfil beacon |
| exfiltration | `reveal_system_prompt_request` | high | Modele system prompt'unu ifşa etmesini isteyen bir cümle |
| exfiltration | `send_data_to_url_instruction` | critical | Modele veriyi bir dış URL'e göndermesini emreden açık bir talimat |

Bunlar **heuristic** bulgulardır — anlam/niyet analizi değil, statik metin kalıbı taraması yapar. Düşük yanlış-pozitif oranı için tasarlandı (örn. emoji ZWJ dizileri ve normal `display:none` modal'ları özellikle hariç tutuldu) ama her bulgu yine de manuel gözden geçirilmelidir.

---

## Yapılandırma (`guardbee.yml`)

```yaml
prompt-injection-scanner:
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
npm test             # 30 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
