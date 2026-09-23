# @guardbee/mcp-vector-store-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — bir vektör veritabanı (ya da vektör-index yeteneği olan) endpoint'ini **auth'suz erişilebilirlik** için prob'lar. Bu, açık Elasticsearch/MongoDB/Redis instance'larının veri sızdırdığı tekrarlayan gerçek dünya olaylarının arkasındaki aynı yanlış yapılandırma sınıfı — şimdi RAG-çağı stack'ine yönelmiş: Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis ve Postgres/pgvector.

Her RAG pipeline'ının embedding'leri bir yerde yaşar. O vektör store ağda auth'suz erişilebilirse, onu bulan herkes retrieval pipeline'ınıza verilmiş her belgeyi okuyabilir (çoğu zaman yazabilir de) — bir chunk'a giren hassas herhangi bir şey dahil.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, prob'lanan host/response içeriği hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► vector-store-scanner ──► Vektör store endpoint'iniz
              │
              ├─ weaviate / qdrant / chroma / elasticsearch  (HTTP fingerprint)
              │     info ──► schema/collections ──► gerçek saklanan veri
              ├─ redis        (ham RESP: PING, AUTH gönderilmez)
              └─ postgres     (ham wire protocol: SSLRequest + StartupMessage, şifre gönderilmez)
```

---

## Nasıl escalating çalışıyor

Her HTTP tabanlı prob "bu şey ayakta mı" ile durmuyor — bir saldırganın izleyeceği aynı yolu, artan etki sırasıyla yürüyor ve sadece gerçekten başarılı olanı raporluyor:

1. **Instance info** (medium) — version/build detayları auth'suz okunabiliyor. Tek başına düşük etki ama servisin açık olduğunu doğruluyor ve bilinen CVE'leri fingerprint'lemeye yardımcı oluyor.
2. **Schema / collection listesi** (high) — class ya da collection adları auth'suz okunabiliyor. Herhangi bir gerçek veri okunmadan önce bile veri modelinizi ortaya çıkarıyor.
3. **Gerçek saklanan veri** (critical) — gerçek bir object/point/document auth'suz geri geliyor. Önemli olan bulgu bu: embedding'leriniz (ve neden oluşturuldularsa o) bu porta erişebilen herkes tarafından okunabilir.

Redis ve Postgres, HTTP yerine kendi native wire protokolleri üzerinden aynı muameleyi görüyor — bir `PING` (Redis) ya da bir `StartupMessage` (Postgres), gerçek bir şifre hiç gönderilmeden auth'un zorunlu olup olmadığını öğrenmeye yetiyor. **Hiçbir credential asla tahmin edilmiyor, brute-force edilmiyor ya da gönderilmiyor** — buradaki her kontrol, bu monorepo'da başka yerlerde `dns-intelligence` ve `ssl-inspector`'ın zaten yaptığı türden salt-okunur fingerprinting.

---

## Özellikler

- **6 hedef tipi**: Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch (HTTP), Redis (ham RESP), Postgres/pgvector (ham wire protocol)
- **Otomatik tespit** — `type` belirtilmediğinde endpoint'i bilinen her tipi sırayla deneyerek fingerprint'ler
- Redis ve Postgres için **sıfırdan protokol implementasyonu** — client library bağımlılığı yok, gerçek credential asla gönderilmiyor, Postgres'in `SSLRequest` handshake'i için TLS-upgrade yolu dahil
- Escalating kontroller (info → schema → data) sayesinde "critical" bir bulgu her zaman gerçek verinin gerçekten okunduğu anlamına gelir, sadece bir portun yanıt verdiği değil
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- Lokal mock HTTP/TCP sunuculara karşı 26 unit test, ayrıca gerçek lokal bir PostgreSQL sunucusuna (SCRAM-SHA-256 gerekli olduğunu doğru raporladı, yanlış-pozitif yok) ve gerçek lokal bir Redis'e (gerçek bir `requirepass`'siz instance'ı doğru yakaladı) karşı uçtan uca doğrulama

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-vector-store-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-vector-store-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-vector-store-scanner scan my-qdrant.internal --type=qdrant --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_endpoint` | Tek bir host/port'u auth'suz erişilebilirlik için prob'lar |
| `list_patterns` | Desteklenen store tiplerini ve her birinin neyi kontrol ettiğini listeler |

---

## Neyi yakalar

| Store | Kontrol | Önem |
|---|---|---|
| Weaviate | `/v1/meta` auth'suz okunabiliyor | medium |
| Weaviate | `/v1/schema` auth'suz okunabiliyor — class adlarını ortaya çıkarıyor | high |
| Weaviate | `/v1/objects` auth'suz gerçek veri döndürüyor | critical |
| Qdrant | `/` instance info auth'suz okunabiliyor | medium |
| Qdrant | `/collections` auth'suz okunabiliyor | high |
| Qdrant | `/collections/<name>/points/scroll` auth'suz gerçek veri döndürüyor | critical |
| Chroma | heartbeat auth'suz erişilebiliyor | medium |
| Chroma | `/collections` auth'suz okunabiliyor | high |
| Elasticsearch/OpenSearch | cluster info auth'suz okunabiliyor | medium |
| Elasticsearch/OpenSearch | `/_cat/indices` auth'suz okunabiliyor | high |
| Elasticsearch/OpenSearch | `/<index>/_search` auth'suz gerçek doküman döndürüyor | critical |
| Redis | `PING`, `AUTH` olmadan kabul ediliyor | critical |
| Postgres/pgvector | TLS sunulmuyor | medium |
| Postgres/pgvector | şifre challenge'ı olmadan `AuthenticationOk` | critical |

---

## Yapılandırma (`guardbee.yml`)

```yaml
vector-store-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  timeout-ms: 4000
```

---

## Kısıtlamalar (bilinçli tasarım)

- Chroma'nın gerçek doküman okuma kontrolü yapılmıyor — data-read API'si versiyonlar arasında ciddi değişiyor, bu yüzden scanner onun için collection-listeleme seviyesinde duruyor (birincil "hiç auth yok" yanlış yapılandırmasını yakalamaya yine de yetiyor).
- Milvus desteklenmiyor — birincil API'si gRPC, diğerleri gibi hafif bir prob'la fingerprint'lenemiyor.
- Bu **auth'suz okuma erişimini** kontrol eder, çalışan bir auth katmanının arkasındaki yetkilendirme hatalarını değil (örn. geçerli ama aşırı yetkili bir API key) — bu, credential'sız harici bir prob için kapsam dışı.

---

## Geliştirme

```bash
npm run build
npm test             # 26 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
