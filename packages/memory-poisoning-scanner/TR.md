# @guardbee/mcp-memory-poisoning-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — agent kodunu **memory poisoning** için tarar: bir agent'ın *kalıcı, oturumlar-arası* hafızasına yazılan güvenilmeyen girdinin, sonradan geri çağrılıp modele güvenilir context olarak beslenmesi, muhtemelen tamamen ilgisiz bir gelecek oturumda.

`prompt-injection-scanner` modelin bir kez okuduğu içerikte (bir doküman, scrape edilmiş bir sayfa) oturan bir injection payload'ını yakalar. Bu paket yapısal olarak farklı bir şeyi yakalıyor: bir injection payload'ının modelin kendi uzun-vadeli bilgisinin bir parçası haline gelmesine izin veren kod kalıbını — reflected ile stored XSS arasındaki aynı boşluk, bir tarayıcının DOM'u yerine bir agent'ın hafızasına uygulanmış.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, taranan kod hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► memory-poisoning-scanner ──► Agent'ınızın kaynağı
              │
              ├─ memory-write     (güvenilmeyen girdi archival/core memory ya da vektör KB'a kalıcı yazılıyor)
              └─ memory-readback  (geri çağrılan hafıza bir system/assistant-role mesajına ya da prompt'a besleniyor)
```

---

## Sıradan conversation memory neden kapsam dışı

Ham chat turn'lerini tutan bir `ConversationBufferMemory`, ya da düz bir `chatHistory.push({role: "user", content: userInput})`, tamamen normal — bu sadece konuşma geçmişi, bir zafiyet değil. Bu paket bunu bilinçli olarak **yakalamıyor**.

Hedeflediği şey daha dar ve daha yüksek riskli: mevcut konuşmadan daha uzun yaşayan *kalıcı* hafızaya yazmalar — MemGPT-tarzı archival memory (gelecekteki, ilgisiz oturumlarda geri çağrılıyor) ve core memory (tasarım gereği HER turn'de system prompt'a yeniden enjekte ediliyor), ya da konuşma-başına RAG context'i yerine uzun-vadeli bir bilgi tabanı olarak kullanılan bir vektör store. Güvenilmeyen girdi buraya sanitize edilmeden düşerse, sadece mevcut alışverişi etkilemekle kalmıyor — birisi fark edene kadar, herkes için, süresiz olarak, agent'ın doğru olduğuna inandığı şeyin bir parçası haline geliyor.

Riskin ikinci yarısı simetrik: bir hafıza/vektör retrieval sonucunun doğrudan bir `system`/`assistant`-role mesajına ya da bir prompt template'e akması, zehirlenmiş bir hafızanın modelin sadece okuduğu bir veri değil, uyduğu bir talimat olarak "nakde çevrildiği" yer.

---

## Özellikler

- **5 memory-write kalıbı**: ham girdiyle beslenen MemGPT `archival_memory_insert`/`core_memory_append`/`core_memory_replace`, ham girdiyle beslenen vektör store `add_texts`/`add_documents`/`upsert`, ve özel-adlandırılmış uzun-vadeli-hafıza/bilgi-tabanı store'ları için genel bir catch-all
- **3 memory-readback kalıbı**: archival/vektör retrieval sonuçlarının bir system/assistant-role mesajına akması, ya da doğrudan bir prompt template'e interpolate edilmesi
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 17 unit test — her kalıp için hem pozitif hem negatif (yanlış-pozitif) senaryo, sıradan conversation-buffer kullanımının sıfır bulgu ürettiğine dair açık bir kontrol dahil. Gerçekçi, kasıtlı-zafiyetli bir fixture'a karşı (hem write hem read-back'i yakaladı) ve tüm guardbee-mcp monorepo'suna karşı (386 dosya, production kodunda yanlış-pozitif yok) uçtan uca doğrulandı

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-memory-poisoning-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-memory-poisoning-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-memory-poisoning-scanner scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_text` | Bir kod snippet'ini tarar |
| `scan_file` | Tek bir dosyayı tarar |
| `scan_directory` | Bir dizini recursive tarar |
| `list_patterns` | Desteklenen tüm kalıpları kategoriye göre listeler |

---

## Tespit Edilen Kalıplar

| Kategori | Kalıp | Önem |
|---|---|---|
| memory-write | `archival_memory_insert_raw_input` | critical |
| memory-write | `core_memory_write_raw_input` (append/replace) | critical |
| memory-write | `vector_store_add_raw_input` | high |
| memory-write | `generic_named_memory_write_raw_input` | medium |
| memory-readback | `archival_memory_feeds_trusted_role` | critical |
| memory-readback | `vector_retrieval_feeds_trusted_role` | high |
| memory-readback | `memory_retrieval_feeds_prompt_template` | high |

---

## Yapılandırma (`guardbee.yml`)

```yaml
memory-poisoning-scanner:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - "**/*.test.ts"
```

---

## Kısıtlamalar (bilinçli tasarım)

- **Heuristic, taint tracking değil.** Write ve read-back kontrolleri her biri tek bir sınırlı konuma bakıyor, belirli bir yazmadan belirli bir sonraki okumaya kanıtlanmış bir data-flow yolu değil. Bir bulgu, riskin *şeklinin* kodda mevcut olduğu anlamına gelir, matematiksel olarak doğrulanmış bir exploit zinciri değil.
- **Kalıp kapsamı MemGPT terminolojisi ve genel-JS-adlandırma tabanlı.** Tamamen farklı fonksiyon/değişken adları kullanan özel-yapım bir uzun-vadeli hafıza sistemi, genel kalıplarla (`*memory*`/`*knowledge_base*` adlandırması, ya da bir `vectorstore`-tarzı API) tesadüfen eşleşmedikçe tanınmaz.
- Bu, **memory poisoning'i mümkün kılan kod kalıplarını** bulur, runtime'da gerçekten zehirlenmiş bir hafıza store'unu değil — hafıza içeriğini doğrudan inceleyebiliyorsanız `prompt-injection-scanner` ile (gerçekte ne saklandığını taramak için) eşleştirin.

---

## Geliştirme

```bash
npm run build
npm test             # 17 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
