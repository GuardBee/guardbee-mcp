# @guardbee/mcp-unbounded-consumption-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

LLM/agent uygulama kodunu **Unbounded Consumption** ("sınırsız tüketim") için tarayan bir MCP (Model Context Protocol) sunucusu — OWASP LLM Top 10 2026'nın #6 kategorisi, "denial of wallet" (cüzdan hizmet reddi) olarak da bilinir: uygulamanın sınırsız sayıda faturalanabilir çağrı yapmasını hiçbir şey durdurmuyor.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (araç adı + kısa parametreler, taranan kod asla dahil edilmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). `GUARDBEE_TELEMETRY=0` ile kapatabilirsiniz.

```
Claude ──► unbounded-consumption-auditor ──► LLM/agent kaynağınız
              │
              ├─ missing-token-limit    (modelin ne kadar üretebileceğine sınır yok)
              ├─ missing-timeout        (sonsuza kadar asılı kalabilen, elle yazılmış bir LLM çağrısı)
              ├─ unbounded-loop         (iterasyon sınırı olmayan bir agent/retry döngüsü)
              ├─ disabled-safety-limit  (bir framework'ün kendi döngü sınırının bilinçli olarak kapatılması)
              └─ missing-rate-limit     (throttling'i olmayan, faturalanabilir çağrı yapan bir MCP tool'u)
```

OWASP'ın bu kategoriye dair kendi yazısı, bulguları okurken akılda tutulmaya değer somut bir maliyet örneği veriyor: *"Herhangi bir recursion limiti veya call budget'ı olmayan bir araştırma asistanı agent'ı, simüle edilmiş 10 dolarlık maliyetle 500 tool çağrısı yaptı... Bir call budget, bir recursion depth limiti ve bir agentic circuit breaker'ı olan bir agent... tek bir tool çağrısını tamamladı, sadece 0.02 dolar harcadı."*

---

## Neden özellikle bu 5 kontrol

Buradaki her kalıp, yazılmadan önce gerçek SDK kaynağına ya da gerçek koda karşı kontrol edildi — training-data varsayımından tahmin edilmedi.

- **Eksik token limiti**, `max_tokens` ya da `max_completion_tokens`'ın hiçbirinin ayarlanmadığı `.chat.completions.create(...)` çağrılarını (OpenAI Python/JS) hedefliyor. Kasıtlı olarak sadece OpenAI-şekilli çağrılarla sınırlı: Anthropic'in kendi SDK'sı `max_tokens`'ı **zorunlu** bir constructor argümanı yapıyor — istek gönderilmeden ÖNCE hata fırlatıyor — bu yüzden orada eşdeğer bir kontrol %100 yanlış-pozitif üretirdi. Reasoning modelleri (o1+) `max_tokens`'ı sessizce yok sayıyor ve bunun yerine `max_completion_tokens` gerektiriyor, bu yüzden kontrol yalnızca ikisi de EKSİKSE bir çağrıyı işaretliyor.
- **Eksik timeout**, kendi argüman aralığında bilinen bir LLM endpoint'inden (`api.openai.com`, `api.anthropic.com`, `/chat/completions`, `/v1/messages`) bahsedilen, elle yazılmış `requests`/`axios`/`fetch` çağrılarını hedefliyor. Resmi OpenAI/Anthropic SDK'ları zaten client-seviyesinde sınırlı bir varsayılan gönderiyor (openai-node: 600sn) — onları işaretlemek sadece gürültü olurdu. `requests.post()`'un kendi Quickstart'ı, ayarlanmamış bir `timeout`'un programı süresiz beklemede bırakabileceği konusunda uyarıyor; axios ve çıplak `fetch` de aynı varsayılan-timeout'suz şekle sahip.
- **Sınırsız döngü**, ikisi de gerçek koda karşı doğrulanmış iki gerçek şekli kapsıyor: iterasyon sınırını çağrıştıran hiçbir şey yakınında olmayan, `tool_calls` dağıtan elle yazılmış bir `while True:`/`while(true)` agent döngüsü (kamuya açık 70 satırlık bir agent anlatımından birebir alıntılanan şekil), ve bir istisna yakalayıp doğrudan LLM'e geri çağrı yapan, attempt sayacı olmadan `continue` eden bir retry döngüsü (OWASP'ın kendi yazısı bunu isim vererek belirtiyor: *"başarısız bir adım tekrar tekrar denenebilir"*). Retry-döngüsü kontrolü kasıtlı olarak gerçekten bir LLM çağıran döngülerle sınırlı — bu kapsamlama olmadan test edilen erken bir sürüm, testler sırasında gerçek bir açık kaynak codebase'inde sıradan polling/retry kodunu işaretlemişti (aşağıdaki Development bölümüne bakın).
- **Devre dışı bırakılmış güvenlik limiti**, `max_iterations=None`'ı (LangChain'in `AgentExecutor`'ı) ve `max_turns=None`'ı (openai-agents-python'un `Runner.run`/`run_sync`'i) işaretliyor — ikisi de yayınlanmadan önce gerçek kaynağa karşı doğrulandı. LangChain'in `AgentExecutor`'ı `max_iterations`'ı varsayılan olarak 15'e ayarlıyor, ve kendi `_should_continue()`'u sınırı yalnızca `self.max_iterations is not None` iken uyguluyor — yani `None` bunu gerçekten devre dışı bırakıyor. openai-agents-python'un kendi issue tracker'ı, `max_turns=None`'ın turn limitini devre dışı bıraktığını açıkça belirtiyor. **LangGraph'in `recursion_limit`'inin eşdeğeri yok — somut bir sayı gerektiriyor — bu yüzden onun için doğrulanmamış bir "devre dışı bırakma" mekanizmasını tahmin etmek yerine hiç kalıp yayınlanmadı.**
- **Eksik rate limit**, buradaki tek heuristik kalıp, bilinçli olarak medium (high/critical değil) severity'de yayınlandı: hiçbir MCP SDK'sı (TypeScript ya da Python) tool kaydında built-in bir per-caller throttling hook'u sağlamıyor, LangChain/LangGraph'in iterasyon sınırları için sağladığı sınırlı varsayılanların aksine. Birden fazla bağımsız 2026 yazısı düzeltmeyi `server.tool()`/`@mcp.tool()` etrafında elle yazılmış bir wrapper olarak tanımlıyor, bu da dayanacak bir framework varsayılanı olmadığını ima ediyor. Bu kontrol başka bir yerde (bir API gateway, başka bir dosyadaki middleware) uygulanan bir rate limiter'ı göremez — bkz. Sınırlamalar.

**`ai-code-scanner` ile ilişkisi:** o pakette zaten daha kaba bir `unbounded_agent_loop` kalıbı var (`excessive-agency` kategorisi altında, bir `.chat.completions.create`/`.messages.create` çağrısının 200 karakter yakınındaki herhangi bir `while(true)`/`for(;;)`) — döngünün gerçekten tool call dağıtıp dağıtmadığını kontrol etmiyor, ve yakında bir iterasyon-sınırı ipucu olup olmadığını kontrol etmiyor, bu yüzden zaten düzgün şekilde sınırlanmış bir döngüyü de işaretler. Bu paketin `unbounded_tool_calling_loop`'u daha dar ve maliyet-özel: gerçek bir `tool_calls`/`toolCalls` referansı (asıl agentic-dispatch şekli) gerektiriyor ve yakında görünür bir sınır ipucu olan döngüleri kasıtlı olarak atlıyor.

---

## Özellikler

- 5 kategoride 7 kalıp, her biri gerçek SDK kaynağına, gerçek bir kod anlatımına, ya da OWASP'ın kendi 2026 yazısına dayanıyor — pattern yorumlarında satır içi kaynak gösterilmiş
- 25 test (her kalıp için pozitif+negatif, sınırsız-döngü kontrollerinin dayandığı gerçek dünya döngü alıntısı dahil)
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- Kasıtlı zafiyet yerleştirilmiş bir fixture'a karşı (7 kalıbın hepsi yakalandı, 3 "güvenli karşılık" negatifin hepsi doğru şekilde atlandı) ve gerçek 3.414 dosyalık bir açık kaynak codebase'ine (`IBM/mcp-context-forge`) artı bu monorepo'nun kendi 495 dosyasına karşı (production kodunda sıfır yanlış-pozitif) uçtan uca doğrulandı. Yayınlanmadan önce bu doğrulama sırasında 2 gerçek yanlış-pozitif bulunup düzeltildi: daha geniş bir erken döngü-gövdesi penceresi, aynı dosyadaki ilgisiz bir `except`/`continue`'un yakındaki bir döngünün parçası sanılmasına yol açıyordu (pencerede bir LLM-çağrısı ipucu zorunlu kılınarak ve pencere küçültülerek düzeltildi), ve bir döngünün birkaç satır altındaki devre-dışı bir `max_iterations=None`, kısa süreliğine yakındaki geçerli bir iterasyon sınırı sanıldı (gerçek bir sınırı test etmeden önce devre-dışı-sınır atamaları temizlenerek düzeltildi).

---

## Hızlı Başlangıç

### Claude Desktop / MCP İstemcisi

```json
{
  "mcpServers": {
    "guardbee-unbounded-consumption-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-unbounded-consumption-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-unbounded-consumption-auditor scan . --fail-on=high --format=sarif > results.sarif
```

---

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `scan_text` | Bir kod parçasını Unbounded Consumption anti-pattern'leri için tarar |
| `scan_file` | Tek bir dosyayı tarar |
| `scan_directory` | Bir dizini özyinelemeli olarak tarar |
| `list_patterns` | Bu auditor'ün tespit ettiği her kalıbı kategoriye göre listeler |

---

## Tespit Edilen Pattern'ler

| Pattern | Kategori | Severity | Anlamı |
|---|---|---|---|
| `openai_chat_completion_missing_max_tokens` | missing-token-limit | medium | Bir OpenAI chat completion çağrısında ne `max_tokens` ne de `max_completion_tokens` ayarlı |
| `raw_http_call_to_llm_endpoint_missing_timeout` | missing-timeout | medium | Bilinen bir LLM endpoint'ine elle yazılmış bir HTTP çağrısının timeout/AbortSignal'i yok |
| `unbounded_tool_calling_loop` | unbounded-loop | medium | Elle yazılmış bir `while(true)`/`while True:` döngüsü, görünür bir iterasyon sınırı olmadan `tool_calls` dağıtıyor |
| `unbounded_retry_loop` | unbounded-loop | medium | Bir LLM çağrısı etrafındaki retry döngüsü bir istisna yakalayıp attempt sayacı olmadan devam ediyor |
| `langchain_max_iterations_disabled` | disabled-safety-limit | high | LangChain'in `AgentExecutor` `max_iterations`'ı bilinçli olarak `None`'a ayarlanmış |
| `openai_agents_max_turns_disabled` | disabled-safety-limit | high | openai-agents-python'un `Runner` `max_turns`'ü bilinçli olarak `None`'a ayarlanmış |
| `mcp_tool_billable_call_no_rate_limit` | missing-rate-limit | medium | Bir MCP tool handler'ı, per-caller rate limiting'i çağrıştıran hiçbir şey olmadan faturalanabilir bir LLM çağrısı yapıyor |

---

## Yapılandırma (`guardbee.yml`)

```yaml
unbounded-consumption-auditor:
  fail-on: high         # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## Sınırlamalar (bilinçli tasarım kararları)

- **Bounded-window heuristikler, gerçek control-flow analizi değil.** Döngü kontrolleri `while True:`/`while(true)`'dan sonraki sabit bir karakter penceresine bakıyor, gerçek döngü gövdesine değil — olağandışı uzun bir gövdesi olan, ya da sınır kontrolü bu pencerenin dışında yaşayan bir döngü kaçırılabilir. Gerçek koda karşı test etmek ters başarısızlık modunu da buldu (yakındaki bir döngünün parçası sanılan, daha aşağıdaki ilgisiz bir `except`/`continue`) ve pencereyi buna göre sıkılaştırdı; hâlâ bir heuristik, bir parser değil.
- **Rate-limit kontrolü başka bir yerdeki uygulamayı göremez.** Kendi gövdesinde rate limiter'ı olmayan bir tool handler'ı yine de bir API gateway, başka bir dosyadaki middleware, ya da bu scanner'ın içine girmediği bir wrapper tarafından korunuyor olabilir — bu kontrol yalnızca handler'ın kendisinde görünen şeyi işaretliyor, daha fazlasını değil.
- **Fonksiyonlar arası varsayılan tespiti yok.** Bir proje bir output limitini ya da timeout'u bir kez, merkezi olarak ayarlıyorsa ve her çağrı noktası buna (çağrı başına geçirmek yerine) örtük olarak güveniyorsa, buradaki çağrı-başına kontroller yine de her çağrı noktasını ayrı ayrı işaretler.
- **LangGraph'in `recursion_limit`'i kontrol edilmiyor.** LangChain ve openai-agents-python'un aksine, LangGraph'in recursion limiti somut bir sayı gerektiriyor — doğrulanmış bir "devre dışı bırakmak için şunu ayarla" mekanizması yok, bu yüzden birini tahmin etmek yerine onun için hiç kalıp yayınlanmadı.

---

## Geliştirme

```bash
npm run build
npm test             # 25 birim testi
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
