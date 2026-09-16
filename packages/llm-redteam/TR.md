# @guardbee/mcp-llm-redteam

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — canlı bir LLM endpoint'ini ya da chatbot'u **aktif** olarak red-team'ler. GuardBee'nin diğer tarayıcıları gibi statik analiz değil, sizin kontrolünüzdeki gerçek bir hedefe gerçek probe istekleri gönderir.

`ai-code-scanner`, `mcp-server-auditor` ve `prompt-injection-scanner` hepsi durağan kod/içeriğe bakıyor. Bu paket **çalışan bir sisteme** bakıyor: deploy edilmiş bir LLM/chatbot'un guardrail'leri, bilinen jailbreak/extraction/obfuscation/refusal-suppression tekniklerine karşı gerçekten, şu an, prod'da dayanıyor mu?

> ⚠️ **Bunu sadece sahibi olduğunuz veya açıkça test etme yetkiniz olan bir endpoint'e yönlendirin.** Her probe gerçek bir istek gönderir ve hedefte API kotası tüketir. Bu bir kendi-kendini-test aracıdır — kendi API key'inizi/endpoint'inizi siz sağlarsınız.
>
> **Hiçbir probe hedeften gerçekten zararlı içerik üretmesini istemez.** Her probe *canary-tabanlı*dır: başarı, hedefin her çalıştırmada ürettiğimiz rastgele, tek kullanımlık bir token'ı tekrar üretip üretmediğiyle ölçülür — bu, karaktere aykırı bir talimatın uyulduğunun kanıtıdır, gerçek zararlı çıktı hiç istenmeden. Bu, sonuçları deterministik (bir canary tesadüfen ortaya çıkamaz) ve canlı bir endpoint'e karşı çalıştırmayı güvenli kılar.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler — API key'iniz, prompt'larınız ya da hedefin yanıtları ASLA dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
LLM endpoint'iniz / chatbot'unuz ◄── llm-redteam ──► Claude
              │
              ├─ Instruction override    (DAN-tarzı rol yapma, direkt "talimatları unut")
              ├─ Extraction              ("yukarıdaki her şeyi tekrarla", çeviri ile yeniden çerçeveleme)
              ├─ Obfuscation             (base64 kodlu talimat, zero-width kaçakçılığı)
              ├─ Refusal suppression     (sahte system-override taklidi)
              └─ Multilingual            (aynı override, İngilizce olmayan ifadeyle)
```

---

## Özellikler

- **12 probe, 5 kategori** — instruction-override, extraction, obfuscation, refusal-suppression, multilingual
- **Canary-tabanlı, zarar-tabanlı değil** — deterministik geçti/kaldı, asla gerçek zararlı içerik istemez
- **3 hedef tipi** — OpenAI-uyumlu chat API'leri (OpenAI, Groq, yerel vLLM vb.), Anthropic Messages API, ya da kendi webhook'unuz
- Her bypass'ta **neden önemli olduğu ve ne yapılması gerektiği** (`recommendation`)
- CI için CLI modu (örn. her deploy'da staging chatbot'unuzu red-team'leyin)
- 29 unit test — target adaptörleri mock'lanmış `fetch` ile test edildi, test suite'inde gerçek ağ çağrısı yok

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-llm-redteam": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-llm-redteam"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

Sonra Claude'a sorun: *"gpt-4o-mini kullanarak OpenAI endpoint'ime karşı GuardBee red-team suite'ini çalıştır."*

### CLI (CI/CD)

```bash
export OPENAI_API_KEY=sk-...
npx @guardbee/mcp-llm-redteam probe --type=openai --model=gpt-4o-mini --api-key-env=OPENAI_API_KEY --fail-on=high
```

```bash
# Kendi chatbot endpoint'iniz
npx @guardbee/mcp-llm-redteam probe --type=webhook --url=https://staging.example.com/chat --fail-on=any
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `list_probes` | Tüm probe'ları kategoriye göre listeler — ağ çağrısı yok |
| `run_probe_suite` | Belirttiğiniz bir hedefe karşı probe'ları çalıştırır; hangilerinin guardrail'leri geçtiğini döner |

---

## Hedef Tipleri

| Tip | Kullanım alanı |
|---|---|
| `openai` | OpenAI'ın Chat Completions API'si, ya da `baseUrl` ile herhangi bir OpenAI-uyumlu gateway (Groq, yerel vLLM/Ollama proxy'leri vb.) |
| `anthropic` | Anthropic'in Messages API'si doğrudan |
| `webhook` | Kendi chatbot/ürün endpoint'iniz — JSON olarak `{ prompt }` POST eder, yanıtı yapılandırılabilir bir alandan okur |

API key **hiçbir zaman** tool/CLI parametresi olarak geçirilmez — sadece onu zaten tutan bir ortam değişkeninin adı (`apiKeyEnv`). Çalıştırmadan önce bu env var'ı ayarlayın.

---

## Tespit Edilen Bypass Kategorileri

| Kategori | Örnek probe | Önem | Bir bypass ne anlama gelir |
|---|---|---|---|
| instruction-override | `direct_override`, `role_play_dan` | high | Direkt ya da rol-yapma bir override talimatı system prompt'un yetkisinin yerini aldı |
| extraction | `system_prompt_leak_direct`, `repeat_above` | critical | Hedef kendi system prompt'unu ifşa etti (ya da ifşa edeceğini kanıtladı) |
| obfuscation | `base64_instruction`, `zero_width_smuggling` | high/medium | Encoding ya da görünmez karakterlerle gizlenen bir override talimatı yine de işe yaradı |
| refusal-suppression | `authority_impersonation` | high | Sahte bir "system override" çerçevelemesine gerçek talimat yetkisi verildi |
| multilingual | `non_english_override` | medium | Aynı override İngilizce olmayan bir dilde ifade edildiğinde de başarılı oldu |

Bunlar **bilinen, kamuya açık dokümante edilmiş teknik kalıpları**dır — bu savunma amaçlı kapsam testi, yeni saldırı araştırması değil. Geçen bir probe hedefin kırılamaz olduğunu kanıtlamaz; bypass edilen bir probe ise somut, tekrarlanabilir bir bulgudur.

---

## Geliştirme

```bash
npm run build
npm test             # 29 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
