# @guardbee/mcp-security-proxy

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Herhangi bir MCP sunucusunun önüne oturan şeffaf güvenlik katmanı. Prompt injection saldırılarını engeller, yanıtlardaki PII'yi maskeler ve her isteği değiştirilemez audit log'a yazar.

> Bu paket varsayılan olarak GuardBee'ye kullanım telemetrisi gönderir (tool adı + kısa parametreler, bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)) — bu, kendi local audit log'undan ayrı ve bağımsızdır. Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► MCP Security Proxy ──► Herhangi bir MCP Sunucu
                │
                ├─ Prompt injection tespiti  (16 saldırı deseni)
                ├─ PII maskeleme             (TC kimlik, IBAN, e-posta, JWT, API key)
                ├─ Block veya warn modu
                ├─ Toxic-flow (lethal trifecta) engelleme
                └─ Hash zincirli audit log
```

---

## Özellikler

- **Prompt Injection Koruması** — 16 saldırı deseni ile sistem prompt'larını geçersiz kılmaya çalışan istekler engellenir
- **Tool sonucu enjeksiyonu** — aynı kalıplar tool sonucuna uygulanır (MCP06:2025). Block modu sonucu değiştirir; warn modu uyarı ekler
- **Oturum tool sabitlemesi** — ilk `tools/list` sabitlenir. Sonraki description veya şema değişikliği rug pull'dur (MCP03:2025). Block modu sabit tanımı sunmaya devam eder ve kaymış çağrıyı reddeder
- **PII Maskeleme** — TC kimlik no, IBAN, e-posta, telefon, JWT token, API key yanıtlarda otomatik maskelenir
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

Tüm MCP sunucularını bir `guardbee-proxy.yaml` ile tek proxy'nin arkasına koyun:

```json
{
  "mcpServers": {
    "guardbee": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-security-proxy", "--config", "/path/to/guardbee-proxy.yaml"]
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
    action: deny              # allow | deny | mask | warn

taint:
  mode: strict                # strict | warn | off

audit:
  sink: file
  filePath: ./guardbee-audit.jsonl
```

- Tool'lar ve prompt'lar `<upstream>__<tool>` adıyla görünür.
- **Toxic flow (lethal trifecta):** her tool `untrusted`, `sensitive`, `egress` veya `destructive` olarak etiketlenir (ad/açıklama sezgileriyle; `labels` altında ezilebilir). Oturum güvenilmeyen içerik (`untrusted` bir tool veya herhangi bir resource) ve hassas veri (`sensitive` bir tool veya bir sonuçtaki herhangi bir PII) gördükten sonra, `egress` çağrısı `strict` modda engellenir, `warn` modda sadece loglanır. Kontrol sunucular arasında çalışır: GitHub'dan okunan bir issue ile CRM'den gelen bir müşteri kaydı, üçüncü bir sunucudaki webhook çağrısını engeller.
- **Kurallar** `tool` (glob), `upstream`, `label` ve `session` (`clean` | `tainted`) alanlarıyla eşleşir. `mask`, maskeleme kapalı olsa bile o tool için PII maskelemeyi zorunlu kılar. Bir kuraldaki `allow` toxic-flow kontrolünü atlatmaz; bunun yerine tool'un etiketini değiştirin.
- **Audit log** hash zincirlidir. Varsayılan olarak argümanların kendisi yerine SHA-256'sını tutar, sonuçları hiç yazmaz; yazmak için `audit.includePayloads: true`. Bir log'u `guardbee-proxy verify-audit ./guardbee-audit.jsonl` ile doğrulayın.
- `guardbee-proxy validate --config guardbee-proxy.yaml` sunucu başlatmadan config'i kontrol eder.
- `--config` verilmezse proxy `./guardbee-proxy.yaml` dosyasını veya `GUARDBEE_PROXY_CONFIG=<dosya>.yaml` değişkenini de okur.

Yukarıdaki tek sunuculu `--` kullanımı 0.x davranışını korur: tool adlarına önek eklenmez, payload'lar loglanır ve toxic flow sadece uyarı olarak loglanır.

---

## MCP Tools

Proxy kendi tool'unu kaydetmez. Hedef sunucunun tool'larını iletir ve her çağrıda interceptor zincirini uygular.

---

## Interceptor'lar

### Prompt Injection Detector

Gelen mesajlarda aşağıdaki saldırı desenlerini arar:

- `ignore previous instructions`
- `disregard your system prompt`
- `you are now [DAN/jailbreak]`
- `act as` / `pretend to be` rol değiştirme
- `DAN mode`, `developer mode`, `jailbreak`
- sahte `[SYSTEM]` / `<system>` etiketleri
- ve 6 desen daha

### PII Masker

| Veri Tipi | Kontrol | Örnek Girdi | Çıktı |
|-----------|---------|-------------|-------|
| TC Kimlik | resmi checksum | `10000000146` | `[TC-KİMLİK]` |
| IBAN (TR) | mod-97 | `TR330006100519786457841326` | `TR**[IBAN]` |
| Kart numarası | Luhn | `4111 1111 1111 1111` | `****-****-****-[KART]` |
| E-posta | — | `ahmet@example.com` | `***@[EMAIL]` |
| Telefon (TR) | — | `0532 123 45 67` | `+90-***-***-**[TELEFON]` |
| JWT | — | `eyJhbGc...` | `[JWT-TOKEN]` |
| API Key | — | `sk_abc123...` | `[API-KEY]` |

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
