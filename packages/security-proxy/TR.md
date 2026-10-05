# @guardbee/mcp-security-proxy

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Herhangi bir MCP sunucusunun önüne oturan şeffaf güvenlik katmanı. Prompt injection saldırılarını engeller, yanıtlardaki PII'yi maskeler ve her isteği değiştirilemez audit log'a yazar.

> Bu paket varsayılan olarak GuardBee'ye kullanım telemetrisi gönderir (tool adı + kısa parametreler, bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)) — bu, kendi local audit log'undan ayrı ve bağımsızdır. Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► MCP Security Proxy ──► Herhangi bir MCP Sunucu
                │
                ├─ Prompt injection tespiti  (27 kural, EN + TR)
                ├─ PII + secret maskeleme    (TC, VKN, IBAN, kart, telefon, 22 anahtar formatı)
                ├─ Block veya warn modu
                ├─ Toxic-flow (lethal trifecta) engelleme
                └─ Hash zincirli audit log
```

---

## Özellikler

- **Prompt Injection Koruması** — İngilizce ve Türkçe 27 kural; kesin kurallar engeller, genel ifadeler sadece uyarır
- **Tool sonucu enjeksiyonu** — aynı kalıplar tool sonucuna uygulanır (MCP06:2025). Block modu sonucu değiştirir; warn modu uyarı ekler
- **Oturum tool sabitlemesi** — ilk `tools/list` sabitlenir. Sonraki description veya şema değişikliği rug pull'dur (MCP03:2025). Block modu sabit tanımı sunmaya devam eder ve kaymış çağrıyı reddeder
- **PII Maskeleme** — TC kimlik no, VKN, IBAN, kart ve telefon numaraları (checksum doğrulamalı), e-posta, 22 sağlayıcı anahtar formatı, özel anahtarlar ve bağlantı dizeleri yanıtlarda maskelenir
- **Block / Warn Modu** — Her interceptor bağımsız olarak engelleyici veya uyarı modunda çalışabilir
- **Audit Log** — Console veya dosyaya yazılan yapılandırılabilir log
- **Gateway modu** — birden fazla MCP sunucusu tek proxy'nin arkasında, tek YAML politikası (allow / deny / mask / warn)
- **Toxic-flow engelleme** — lethal trifecta'yı sunucular arasında izler ve onu tamamlayacak egress çağrısını engeller
- **Sıfır Kod Değişikliği** — Mevcut herhangi bir MCP sunucusunun önüne takılır

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-security-proxy
```

`claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "secure-filesystem": {
      "command": "npx",
      "args": [
        "-y", "@guardbee/mcp-security-proxy",
        "--", "npx", "-y",
        "@modelcontextprotocol/server-filesystem", "/tmp"
      ]
    }
  }
}
```

> Proxy, `--` sonrasındaki komutu hedef MCP sunucu olarak başlatır.

---

## Gateway Modu: Birden Fazla Sunucu, Tek Politika

Tüm MCP sunucularını bir `guardbee-proxy.yaml` ile tek proxy'nin arkasına koyun. `init` taşımayı sizin için yapar:

```bash
npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop   # veya cursor, claude-code, --file ./mcp.json
```

Her stdio sunucusunu `~/.guardbee/guardbee-proxy.yaml` dosyasına (izin 0600) taşır, istemci config'inin yedeğini alır ve config'i proxy'ye yönlendirir. HTTP sunucuları olduğu gibi kalır ve raporlanır, çünkü politikayı atlarlar. `--dry-run` iki dosyayı da yazmadan gösterir. Elle yapmak için:

```json
{
  "mcpServers": {
    "guardbee": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-security-proxy@^1", "--config", "/path/to/guardbee-proxy.yaml"]
    }
  }
}
```

```yaml
version: 1
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }   # ortam değişkeninden okunur
  postgres:
    command: npx
    args: ["-y", "@guardbee/mcp-db-gateway"]

labels:                       # sezgisel etiketleri ezer
  github__get_issue: [untrusted]
  github__create_pull_request: [egress]

rules:                        # ilk eşleşen kural kazanır
  - id: no-deletes
    match: { tool: "postgres__delete_*" }
    action: deny              # allow | deny | mask | warn | approve
  - match: { tool: "postgres__query", args: { table: "salaries" } }   # noktalı yol → değer, string'ler glob
    action: mask
    mask: { fields: [salary, iban] }   # bu JSON anahtarlarını boşalt
  - match: { label: destructive }
    action: approve           # önce kişiye sor

taint:
  mode: strict                # strict | approve | warn | off
  basis: capability           # capability | data — data: yalnızca hassas veri taşıyan egress çağrısını engelle

audit:
  sink: file
  filePath: ./guardbee-audit.jsonl
```

- Tool'lar ve prompt'lar `<upstream>__<tool>` adıyla görünür.
- **Toxic flow (lethal trifecta):** her tool `untrusted`, `sensitive`, `egress` veya `destructive` olarak etiketlenir (ad/açıklama sezgileriyle; `labels` altında ezilebilir). Oturum güvenilmeyen içerik (`untrusted` bir tool veya herhangi bir resource) ve hassas veri (`sensitive` bir tool veya bir sonuçtaki herhangi bir PII) gördükten sonra, `egress` çağrısı `strict` modda engellenir, `warn` modda sadece loglanır. Kontrol sunucular arasında çalışır: GitHub'dan okunan bir issue ile CRM'den gelen bir müşteri kaydı, üçüncü bir sunucudaki webhook çağrısını engeller.
- **Kurallar** `tool` (glob), `upstream`, `label`, `session` (`clean` | `tainted`) ve `args` alanlarıyla eşleşir. `mask`, maskeleme kapalı olsa bile o tool için PII maskelemeyi zorunlu kılar; `mask.fields` ayrıca adı verilen JSON anahtarlarını metinde ve `structuredContent`'te boşaltır. Bir kuraldaki `allow` toxic-flow kontrolünü atlatmaz; bunun yerine tool'un etiketini değiştirin.
- **Onay:** `approve` (kural aksiyonu olarak ya da toxic flow için `taint.mode: approve`) kişiye MCP elicitation üzerinden tool'u, gerekçeyi ve argümanları gösteren bir evet/hayır formu açar. Açık bir "evet" dışındaki her cevap (red, iptal, `approval.timeoutSeconds` içinde cevap gelmemesi; varsayılan 120) çağrıyı engeller. Elicitation desteklemeyen istemci onay veremez; çağrı bunu söyleyen bir mesajla engellenir.
- **Dashboard'dan onay:** `approval.channels: [elicitation, dashboard]` ve `audit.dashboard` ayarlıysa, onay formu gösteremeyen istemcide çağrı artık doğrudan engellenmez. İstek, argümanlardaki kişisel veriler maskelenmiş olarak GuardBee dashboard'una (MCP Gateway sayfası) gider; workspace sahipleri ve yöneticilerine bildirim düşer; proxy çağrıyı biri oradan onaylayana ya da reddedene veya `timeoutSeconds` dolana kadar bekletir. Kanallar sırayla denenir; soru sorabilen ilk kanal cevabı verir.
- **Veri bazlı taint (`taint.basis: data`):** varsayılan `capability`, oturum güvenilmeyen ve hassas içerik gördükten sonra her egress çağrısını engeller. `data` ile proxy, hassas tool'ların (ve PII içeren cevapların) döndürdüklerinin hash'lenmiş parmak izlerini tutar — kişisel veri ve kimlik bilgileri, id benzeri değerler ve kelime dizileri — ve bir egress çağrısını yalnızca argümanları bu veriyi taşıyorsa (12+ ortak kelime ya da birebir aynı tanımlayıcı; PII token'ları gerçek değerleri sayılır) ve oturum güvenilmeyen içerik de gördüyse toxic flow sayar. Engelleme mesajı verinin hangi tool'dan geldiğini söyler. Lisans metni, markdown kalıpları ve sıradan cevaplarda ya da 3+ tool'da tekrar eden metin yok sayılır. Parmak izleri hash'tir, oturum başına bellekte tutulur. Bedeli: verinin başka kelimelerle anlatılması veya özetlenmesi yakalanmaz; bunun önemli olduğu yerde `capability` kullanın. `capability` modunda da kanıt bulunursa engelleme gerekçesine eklenir.
- **Dashboard'dan politika:** `policy: { source: dashboard, refreshSeconds: 60 }` (`audit.dashboard` ile birlikte) etiketleri, kuralları, taint, onay, varsayılan aksiyon ve interceptor ayarlarını bu dosya yerine GuardBee dashboard'unda düzenlenen workspace politikasından alır. Upstream'ler, listen ve audit yerelde kalır. Proxy politikayı açılışta çeker ve ETag ile yeniden kontrol eder; güncelleme her oturumda bir sonraki çağrıda geçerli olur (etiketler bir sonraki `tools/list`'te). Dashboard'da kayıtlı politika yoksa, dashboard'a ulaşılamazsa ya da belge geçersizse proxy yerel ya da son geçerli politikayı korur — asla politikasız çalışmaz.
- **Kişisel veri sayıları:** PII içeren tool cevapları ve resource okumaları, kategori başına sayı tutan `piiHits` alanını taşır (`tc_kimlik`, `vkn`, `iban`, `credit_card`, `email`, `phone_tr`; kimlik bilgileri/anahtarlar `secret`). Yalnızca sayılar tutulur, değerler asla; maskeleme kapalıyken de sayılır. Dashboard'daki KVKK raporu bu sayılardan üretilir.
- **Tokenize:** `interceptors.piiMasking.mode: tokenize` ile model değerin yerine `<pii:tc_kimlik:7f3a9b21>` görür ve bu token'ı başka bir tool'a yine verebilir; proxy gerçek değeri o sunucuya giderken geri koyar. Token'lar sadece oturum boyunca bellekte tutulur ve `piiMasking.detokenizeForEgress: true` olmadıkça `egress` tool'lar için geri çevrilmez.
- **Prompt'lar** (`prompts/get`) tool sonuçlarıyla aynı injection taramasından ve PII maskelemeden geçer.
- `interceptors.definitionDrift.recheck: on-change` her çağrıdaki `tools/list`'i atlar ve sadece sunucu `tools/list_changed` gönderdiğinde yeniden kontrol eder; proxy bu bildirimi ajana da iletir.
- **Audit log** hash zincirlidir. Varsayılan olarak argümanların kendisi yerine SHA-256'sını tutar, sonuçları hiç yazmaz; yazmak için `audit.includePayloads: true`. Bir log'u `guardbee-proxy verify-audit ./guardbee-audit.jsonl` ile doğrulayın.
- `guardbee-proxy validate --config guardbee-proxy.yaml` sunucu başlatmadan config'i kontrol eder.
- `--config` verilmezse proxy `./guardbee-proxy.yaml` dosyasını veya `GUARDBEE_PROXY_CONFIG=<dosya>.yaml` değişkenini de okur.

Yukarıdaki tek sunuculu `--` kullanımı 0.x davranışını korur: tool adlarına önek eklenmez, payload'lar loglanır ve toxic flow sadece uyarı olarak loglanır.

---

## Remote Mod (HTTP)

Proxy, tek bir istemcinin alt süreci olmak yerine paylaşılan bir ağ servisi olarak da çalışabilir. Ajanlar Streamable HTTP ile bağlanır; upstream'ler de uzak Streamable HTTP server'lar olabilir.

```yaml
version: 1
listen:
  transport: http              # stdio (default) | http
  host: 0.0.0.0                # konteynerde 0.0.0.0; dizüstünde 127.0.0.1
  port: 8787
  path: /mcp
  apiKeys: ["${GUARDBEE_PROXY_KEY}"]   # ajanlar Authorization: Bearer <key> gönderir
  maxSessions: 100
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  linear:
    url: https://mcp.linear.app/mcp     # bir Streamable HTTP upstream
    headers: { Authorization: "Bearer ${LINEAR_TOKEN}" }
audit:
  sink: file
  filePath: /var/log/guardbee/audit.jsonl
  dashboard:
    url: https://app.guardbee.ai/api/v1/gateway/events
    apiKeyEnv: GUARDBEE_API_KEY        # gateway.write scope'lu workspace API key'i
```

- **Oturumlar birbirinden ayrık.** Her MCP oturumunun kendi taint durumu, PII token'ları ve tool pin'leri vardır; bir ajanın toxic flow'u başka bir ajanı asla engellemez. Tüm oturumlar upstream bağlantılarını paylaşır. Audit olayları `sessionId` taşır.
- **Key yoksa ağ da yok.** `listen.apiKeys` olmadan loopback dışında dinlemek config hatasıdır. Key'ler sabit zamanda karşılaştırılır; yanlış veya eksik key `401` alır.
- `GET /healthz` `{"ok": true, "sessions": N}` döner. `maxSessions` üstündeki oturumlar `503` alır.
- **Dashboard:** `audit.dashboard` her audit olayını toplu halde, `apiKeyEnv`'den alınan workspace API key'iyle GuardBee dashboard'una gönderir; key dosyada durmaz. Dashboard'a ulaşılamazsa olaylar bellekte bekler (en fazla 10.000) ve sonra gönderilir. Reddedilen key stderr'e bir kez raporlanır. Tool çağrıları dashboard'u asla beklemez.
- `init` artık Streamable HTTP server'ları (`url` + `headers`) da proxy'nin arkasına taşır. Eski SSE server'lar istemci config'inde kalır ve raporlanır.

Docker:

```bash
docker build -t guardbee/mcp-security-proxy packages/security-proxy
docker run -p 8787:8787 -e GUARDBEE_PROXY_KEY=... -e GUARDBEE_API_KEY=... \
  -v "$PWD/guardbee-proxy.yaml:/etc/guardbee/guardbee-proxy.yaml:ro" guardbee/mcp-security-proxy
```

---

## MCP Tools

Proxy kendi tool'unu kaydetmez. Hedef sunucunun tool'larını iletir ve her çağrıda interceptor zincirini uygular.

---

## Interceptor'lar

### Prompt Injection Detector

[`@guardbee/guard-core`](../guard-core/README.md) içindeki 27 kural; tool argümanlarına, tool sonuçlarına, resource'lara ve prompt'lara uygulanır:

- **Engeller** (13 kesin kural, high/critical): İngilizce ve Türkçe talimat geçersiz kılma ("ignore all previous instructions", "önceki talimatları yok say"), `DAN mode`, "bypass your safety guardrails", chat-template token'ları (`<|im_start|>`, `[INST]`), `<system>` etiketleri, Unicode tag karakterlerine gizlenmiş metin, CSS ile gizlenmiş öğelerde veya HTML yorumlarında talimat, markdown görsel exfiltration işaretçileri, sistem istemini isteme (İngilizce ve Türkçe), "send the user's data to https://…".
- **Sadece uyarır** (14): sıradan metinde de geçen genel ifadeler — "act as", "you are now", "developer mode", "jailbreak", "override policy", "sen artık" — ve zero-width veya bidi kontrol karakterleri, satır başındaki `System:` etiketi gibi orta önemdeki işaretler.
- **Base64:** okunabilir metne çözülen dizileri çözer ve engelleme kurallarıyla kontrol eder; talimat kodlanmış bir blob'a saklanamaz.

1.1'den itibaren genel bir ifade tek başına engellemez: 1.0'da bir tool sonucundaki "use jailbreak mode" veya "act as a reverse proxy" engelleniyordu; artık loglanır ve sonuca bir uyarı eklenir.

### PII Masker

| Veri Tipi | Kontrol | Örnek Girdi | Çıktı |
|-----------|---------|-------------|-------|
| TC Kimlik | resmi checksum | `10000000146` | `[TC-KİMLİK]` |
| IBAN (TR) | mod-97 | `TR330006100519786457841326` | `TR**[IBAN]` |
| Kart numarası | Luhn | `4111 1111 1111 1111` | `****-****-****-[KART]` |
| E-posta | — | `ahmet@example.com` | `***@[EMAIL]` |
| Telefon (TR) | cep / sabit hat / 850 öneki | `0532 123 45 67` | `+90-***-***-**[TELEFON]` |
| Vergi no (VKN) | kontrol hanesi, `VKN` / `Vergi No` etiketi gerekir | `VKN: 1234567890` | `VKN: [VKN]` |
| Sağlayıcı anahtarları | secret-scanner'dan 22 anahtar ve token formatı (AWS, GitHub, Stripe, OpenAI, Anthropic, Slack, …) | `ghp_…`, `AKIA…` | `[API-KEY]` |
| Diğer API key'ler | `sk_`/`api_`/`token_`… öneki, harf ve rakam | `api_k3y9x8…` | `[API-KEY]` |
| Özel anahtar | BEGIN…END bloğunun tamamı | `-----BEGIN … PRIVATE KEY-----` | `[PRIVATE-KEY]` |
| Bağlantı dizesi | URL'de kullanıcı:şifre (localhost hariç) | `postgres://app:pw@db/prod` | `[CONNECTION-STRING]` |
| JWT | — | `eyJhbGc...` | `[JWT-TOKEN]` |

Checksum'ı tutmayan sayılar (sipariş no, takip kodu) olduğu gibi bırakılır.

---

## Yapılandırma

Ortam değişkenleri ile yapılandırılabilir:

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `PROXY_MODE` | `block` | `block` veya `warn` |
| `PROXY_LOG` | `console` | `console` veya `file` |
| `PROXY_LOG_PATH` | `./proxy-audit.jsonl` | Log dosya yolu |
| `PROXY_PII_MASK` | `true` | PII maskelemeyi etkinleştir |
| `PROXY_INJECTION_CHECK` | `true` | Injection kontrolünü etkinleştir |

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
