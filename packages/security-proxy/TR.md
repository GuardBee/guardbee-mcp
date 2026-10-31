# @guardbee/mcp-security-proxy

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Herhangi bir MCP sunucusunun önüne oturan şeffaf güvenlik katmanı. Prompt injection saldırılarını engeller, yanıtlardaki PII'yi maskeler ve her isteği değiştirilemez audit log'a yazar.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

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

tools:                        # ajanın gördüğü tool'lar (<upstream>__<tool> üzerinde glob)
  hide: ["*__delete_*"]
  descriptions:
    github__create_issue: "Create an issue in acme/* repositories only."

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

interceptors:
  anomaly:                    # ayarlanmazsa kapalı; oturum başına, kayan pencere
    enabled: true
    action: warn              # warn | block
    callBurst: { count: 60, windowSeconds: 60 }

audit:
  sink: file
  filePath: ./guardbee-audit.jsonl
```

- Tool'lar ve prompt'lar `<upstream>__<tool>` adıyla görünür.
- **Toxic flow (lethal trifecta):** her tool `untrusted`, `sensitive`, `egress` veya `destructive` olarak etiketlenir (ad/açıklama sezgileriyle; `labels` altında ezilebilir). Oturum güvenilmeyen içerik (`untrusted` bir tool veya herhangi bir resource) ve hassas veri (`sensitive` bir tool veya bir sonuçtaki herhangi bir PII) gördükten sonra, `egress` çağrısı `strict` modda engellenir, `warn` modda sadece loglanır. Kontrol sunucular arasında çalışır: GitHub'dan okunan bir issue ile CRM'den gelen bir müşteri kaydı, üçüncü bir sunucudaki webhook çağrısını engeller.
- **Kurallar** `tool` (glob), `upstream`, `label`, `session` (`clean` | `tainted`) ve `args` alanlarıyla eşleşir. `mask`, maskeleme kapalı olsa bile o tool için PII maskelemeyi zorunlu kılar; `mask.fields` ayrıca adı verilen JSON anahtarlarını metinde ve `structuredContent`'te boşaltır. Bir kuraldaki `allow` toxic-flow kontrolünü atlatmaz; bunun yerine tool'un etiketini değiştirin.
- **Konular (`topics`, `match.topic`):** bir kural tool yerine bir konuyu hedefleyebilir — "birleşme veya maaş konuları bu ajan üzerinden dışarı çıkmasın". Konu bir terim listesidir; metinde `minMatches` (varsayılan 1) farklı terim geçerse konu tespit edilir. Eşleşme büyük/küçük harf ve Türkçe karakterlerden bağımsızdır (`BİRLEŞME` = `birlesme`), terim ek alabilir (`maaş` → `maaşları`, `satın alma` → `satın almayı`); tam kelime için terimi tırnak içine alın (`'"AI"'`). Kural hem çağrının argümanlarında hem dönen içerikte (tool sonucu, resource, prompt) çalışır: `deny` içeriği tutar, `mask` PII maskelemeyi zorlar, `warn` loglar, `approve` onay ister. [LLM API gateway](#llm-api-gateway) tarafında konu kuralları tüm prompt'a `tool: llm:<model>` ile uygulanır.
- **Tool görünürlüğü (`tools`):** `expose`, ajanın gördüğü ad üzerinde glob'lardan oluşan bir beyaz listedir (yoksa tüm tool'lar), `hide` ondan sonra tool çıkarır. Gizli bir tool `tools/list`'te yer almaz, model açıklamasını hiç okumaz (daha küçük zehirleme yüzeyi, daha az token); çağrılırsa reddedilir ve `anomaly.repeatedBlocks` sayacına eklenir. `descriptions`, bir tool'un açıklamasını sizin yazdığınızla değiştirir; tanım değişikliği tespiti sunucunun kendi açıklamasını izlemeye devam eder. Çağrı anında reddeden `deny` kuralından farkı, tool'u ajanın görüş alanından tamamen çıkarmasıdır.
- **`tools/list` anında tool poisoning (`interceptors.toolPoisoning`, varsayılan açık):** her tanım ajan görmeden önce taranır — açıklama (`tools.descriptions` altında kendiniz yazdıysanız sizinki), input schema'daki parametre açıklamaları ve enum değerleri, ve read-only annotation. Modele yönelik talimatları (`<IMPORTANT>`, "kullanıcıya söyleme", "önceki talimatları yok say"), tool'lar arası shadowing'i ("X tool'unu kullanırken her zaman…"), `.ssh`/`.env` okuma isteklerini, gizli zero-width, bidi ve ANSI karakterlerini, Kiril veya Yunan benzeri harf içeren kelimeleri ve açıklamanın çeliştiği bir `readOnlyHint`'i yakalar. `block` modunda (varsayılan; ayarlanmazsa `promptInjection.action`'ı izler) critical veya high bulgusu olan tool listeden çıkarılır ve çağrıları reddedilir; medium bulgular (kodlanmış bloblar) sadece uyarır. Her bulgu bir kez `ruleId: poisoning:<kural>` ile loglanır. Kurallar `@guardbee/mcp-tool-poisoning-scanner`'ın kullandıklarıdır, artık guard-core üzerinden paylaşılır.
- **Dışarı çıkan kimlik bilgileri (`interceptors.egressSecrets`, varsayılan açık):** bir `egress` tool çalışmadan önce, gerçekten alacağı argümanlarda kimlik bilgisi aranır — sağlayıcı anahtarları (AWS, GitHub, OpenAI, Anthropic, Stripe, Slack, …), private key'ler ve şifre içeren bağlantı adresleri; PII maskelemenin kullandığı kesin formatlı kurallar, geniş anahtar-kelime kuralları asla. Veri bazlı taint sadece bu oturumdaki tool'ların döndürdüklerini bilir; bu kontrol modelin prompt'tan, bir dosyadan ya da kendi bağlamından aldığı bir anahtarı da yakalar. `block` (varsayılan; ayarlanmazsa `promptInjection.action`'ı izler) çağrıyı reddeder, `warn` loglar; audit event'inde kimlik bilgisi her iki durumda da maskelenir. Bir PII token'ı `piiMasking.detokenizeForEgress` açık değilse egress tool için token olarak kalır, değeri yalnızca o zaman kontrol edilir. `allowTools` tool'ları glob ile muaf tutar (ör. DB URL alan bir deploy tool'u). Kişisel veri PII maskeleme ve taint'e bırakılır.
- **Sampling (`interceptors.sampling`, varsayılan kapalı):** bir sunucu ajanın modelinden metin isteyebilir (`sampling/createMessage`) — kötü niyetli bir sunucu bunu modele talimat kaçırmak ya da veri çekmek için kullanabilir. Kapalıyken proxy sunuculara sampling'i hiç sunmaz. Açıkken bir istek yalnızca o sunucunun tool çağrılarından biri sürerken ve çağrıyı yapan oturum tarafından cevaplanır (iki oturum aynı sunucuyu aynı anda çağırıyorsa reddedilir, çünkü istek ikisine de ait olabilir); `includeContext` her zaman `none` yapılır, sunucu konuşmayı asla almaz; `maxTokens` (varsayılan 1024) ve çağrı başına istek sayısı (`maxPerCall`, varsayılan 3) sınırlanır; system prompt ve mesajlar injection taramasından geçer; `approval: true` önce kişiye sorar. Modelin cevabı sunucuya döndüğü için egress sayılır: bir kimlik bilgisi ya da oturumun gördüğü veri cevabı engeller, kişisel veri maskelenir. Event'ler `tool: sampling:<upstream>` ve `ruleId: sampling:<kontrol>` kullanır. Yetenek proxy başlarken sunulur; açıp kapatmak yeniden başlatma gerektirir.
- **Onay:** `approve` (kural aksiyonu olarak ya da toxic flow için `taint.mode: approve`) kişiye MCP elicitation üzerinden tool'u, gerekçeyi ve argümanları gösteren bir evet/hayır formu açar. Açık bir "evet" dışındaki her cevap (red, iptal, `approval.timeoutSeconds` içinde cevap gelmemesi; varsayılan 120) çağrıyı engeller. Elicitation desteklemeyen istemci onay veremez; çağrı bunu söyleyen bir mesajla engellenir.
- **Dashboard'dan onay:** `approval.channels: [elicitation, dashboard]` ve `audit.dashboard` ayarlıysa, onay formu gösteremeyen istemcide çağrı artık doğrudan engellenmez. İstek, argümanlardaki kişisel veriler maskelenmiş olarak GuardBee dashboard'una (MCP Gateway sayfası) gider; workspace sahipleri ve yöneticilerine bildirim düşer; proxy çağrıyı biri oradan onaylayana ya da reddedene veya `timeoutSeconds` dolana kadar bekletir. Kanallar sırayla denenir; soru sorabilen ilk kanal cevabı verir.
- **Veri bazlı taint (`taint.basis: data`):** varsayılan `capability`, oturum güvenilmeyen ve hassas içerik gördükten sonra her egress çağrısını engeller. `data` ile proxy, hassas tool'ların (ve PII içeren cevapların) döndürdüklerinin hash'lenmiş parmak izlerini tutar — kişisel veri ve kimlik bilgileri, id benzeri değerler ve kelime dizileri — ve bir egress çağrısını yalnızca argümanları bu veriyi taşıyorsa (12+ ortak kelime ya da birebir aynı tanımlayıcı; PII token'ları gerçek değerleri sayılır) ve oturum güvenilmeyen içerik de gördüyse toxic flow sayar. Engelleme mesajı verinin hangi tool'dan geldiğini söyler. Lisans metni, markdown kalıpları ve sıradan cevaplarda ya da 3+ tool'da tekrar eden metin yok sayılır. Parmak izleri hash'tir, oturum başına bellekte tutulur. Bedeli: verinin başka kelimelerle anlatılması veya özetlenmesi yakalanmaz; bunun önemli olduğu yerde `capability` kullanın. `capability` modunda da kanıt bulunursa engelleme gerekçesine eklenir.
- **Anomali kontrolleri (`interceptors.anomaly`):** tek bir çağrıda görünmeyen davranış, oturum başına kayan pencerede sayılır. `callBurst` — 60 saniyede 60'tan fazla tool çağrısı (döngüye giren ajan ya da denial-of-wallet). `sensitiveSweep` — 300 saniyede `sensitive` tool'lara 25'ten fazla *farklı* okuma (bir veri deposunu kayıt kayıt taramak; aynı kaydı tekrar okumak sayılmaz). `destructiveBurst` — 60 saniyede 5'ten fazla `destructive` çağrı. `repeatedBlocks` — 300 saniyede 5'ten fazla engellenen ya da reddedilen çağrı (politikayı yoklamak; onay penceresi gösteremeyen istemci sayılmaz). Her biri `{ count, windowSeconds }` alır; yukarıdaki sayılar varsayılandır. `warn` her kontrolün ilk tetiklenişini loglar; `block` pencere kayana kadar sınırı aşan çağrıları reddeder, tekrarlanan engellemelerden sonra da oturumdaki tüm sonraki çağrıları reddeder. Event'ler `ruleId: anomaly:<kontrol>` ile `warn`/`blocked` tipindedir, dashboard değişiklik gerekmeden gösterir. Ayarlanmadıkça kapalıdır.
- **Kotalar (`quotas`):** tool çağrılarına sabit bir pencerede, oturumlar arası sayılan sınırlar — `interceptors.anomaly` tek bir oturumu izlerken, kota bir kullanıcı on oturum açtığında da geçerlidir. Her kayıtta `match` (`tool` ve `user` glob, `upstream`, `label`, `group`; hepsi isteğe bağlı), `limit`, `windowSeconds` ve `per` vardır: `user` (varsayılan; OIDC kullanıcısı, yoksa oturum), `session` ya da `gateway` (herkes için tek bütçe, ör. ücretli bir upstream). Örnek: `quotas: [{ id: exports, match: { label: egress, group: contractors }, limit: 20, windowSeconds: 3600 }]`. Eşleşen her kota kontrol edilir ve çağrı ya hepsine ya hiçbirine sayılır; yalnızca upstream'e ulaşmak üzere olan çağrılar sayılır, policy'nin reddettiği çağrı kota harcamaz. Dolu bir kota çağrıyı tekrar deneme süresiyle reddeder, `ruleId: quota:<id>` loglar ve `anomaly.repeatedBlocks` sayacına eklenmez. Sayaçlar proxy process'inde tutulur: birden fazla kopya her biri kendi sayacını tutar.
- **Dashboard'dan politika:** `policy: { source: dashboard, refreshSeconds: 60 }` (`audit.dashboard` ile birlikte) etiketleri, kuralları, taint, onay, varsayılan aksiyon ve interceptor ayarlarını bu dosya yerine GuardBee dashboard'unda düzenlenen workspace politikasından alır. Upstream'ler, listen ve audit yerelde kalır. Proxy politikayı açılışta çeker ve ETag ile yeniden kontrol eder; güncelleme her oturumda bir sonraki çağrıda geçerli olur (etiketler bir sonraki `tools/list`'te). Dashboard'da kayıtlı politika yoksa, dashboard'a ulaşılamazsa ya da belge geçersizse proxy yerel ya da son geçerli politikayı korur — asla politikasız çalışmaz.
- **Belgeler (`interceptors.documents`, varsayılan kapalı):** tool sonuçlarındaki, gömülü resource'lardaki ve resource okumalarındaki görseller ve blob'lar (PDF, ekran görüntüsü, taranmış sayfa) [`@guardbee/mcp-document-scanner`](../document-scanner) ile okunur: PDF metin katmanı, isteğe bağlı `tesseract.js` (taranmış PDF için `@napi-rs/canvas`) kuruluysa OCR. Kişisel veri veya credential içeren belge `block` modunda bir notla değiştirilir (`ruleId: documents:pii`), `warn` modunda loglanır; sayıları `piiHits`'e girer.
- **Kişisel veri sayıları:** PII içeren tool cevapları ve resource okumaları, kategori başına sayı tutan `piiHits` alanını taşır (`tc_kimlik`, `vkn`, `iban`, `credit_card`, `email`, `phone_tr`; kimlik bilgileri/anahtarlar `secret`). Yalnızca sayılar tutulur, değerler asla; maskeleme kapalıyken de sayılır. Dashboard'daki KVKK raporu bu sayılardan üretilir.
- **Tokenize:** `interceptors.piiMasking.mode: tokenize` ile model değerin yerine `<pii:tc_kimlik:7f3a9b21>` görür ve bu token'ı başka bir tool'a yine verebilir; proxy gerçek değeri o sunucuya giderken geri koyar. Token'lar sadece oturum boyunca bellekte tutulur ve `piiMasking.detokenizeForEgress: true` olmadıkça `egress` tool'lar için geri çevrilmez.
- **Prompt'lar** (`prompts/get`) tool sonuçlarıyla aynı injection taramasından ve PII maskelemeden geçer.
- `interceptors.definitionDrift.recheck: on-change` her çağrıdaki `tools/list`'i atlar ve sadece sunucu `tools/list_changed` gönderdiğinde yeniden kontrol eder; proxy bu bildirimi ajana da iletir.
- **Derleme kaynağı doğrulaması (`provenance`, varsayılan `warn`):** bir stdio upstream başlamadan önce proxy, `npx` / `pnpm dlx` / `bunx`'in çalıştıracağı paketi çözer ve npm provenance'ını kontrol eder: Sigstore ile imzalı bir SLSA attestation'ı (imza, sertifika zinciri ve transparency-log kaydı, TUF ile alınan Sigstore güven köküne göre). Bu attestation tam o tarball'ı (sha512 = registry'nin `integrity`'si) adlandırmalı, adlandırdığı repodaki bir workflow tarafından imzalanmış olmalı ve bu repo paketin `repository` alanıyla eşleşmelidir. Ardından komut kontrol edilen sürüme sabitlenerek çalışır (`npx -y pkg` → `npx -y pkg@1.2.3`); böylece arada yayınlanan bir sürüm başlatılmaz. `warn` doğrulanmamış paketleri başlatır ve `ruleId: provenance:unsigned | invalid | error | unsupported` olarak loglar; `require` onları reddeder (upstream bazında: `upstreams.<ad>.provenance: off | warn | require`). Sonuçlar sürüm başına `~/.guardbee/provenance.json`'da önbelleklenir (`provenance.cacheFile`); daha önce doğrulanmış bir sürümün altında farklı bir tarball görülürse bu kurcalama sayılır. `provenance.offline: true` yalnızca önbelleği ve diskteki güven kökünü kullanır (bunun için tam sürüm sabitleyin). Hiçbir şey başlatmadan kontrol: `guardbee-proxy provenance --config <dosya>` (bir upstream reddedilecekse çıkış kodu 1). **PyPI** (`uvx`, `uv tool run`): sürümün her dosyası, Trusted Publisher'ından gelen bir PEP 740 attestation'ı taşımalıdır (o reponun workflow'u imzalamış, dosyayı ve sha256'sını adlandırıyor olmalı); `uvx pkg`, `uvx pkg==<sürüm>` olarak çalışır. **Container imajları** (`docker run`, `podman run`): tag digest'e çözülür ve imajın cosign keyless imzası (`sha256-<digest>.sig`) doğrulanır; imzalayan, `ghcr.io/<owner>/…` için imaj sahibinin GitHub hesabındaki bir workflow olmalı, başka yerlerde `provenance.signers` ile eşleşmelidir; komut `image@sha256:…`'ya sabitlenerek çalışır. `--format sarif` bulguları code scanning için SARIF 2.1.0 olarak yazar. Sınırlar: birçok paket provenance olmadan yayınlanır (`unsigned` görünür; cosign dışında imzalanan imajlar da, örneğin Docker Hub'ın `mcp/` imajları); özel npm registry `provenance.registry` veya `npm_config_registry` ile, PyPI aynası `provenance.pypiIndex` ile kullanılır (integrity API'si gerekir); özel imajlar desteklenmez (yalnızca anonim registry token'ı); tek sunuculu `--` biçimi kontrol yapmaz.
- **Kalıcı tool sabitleme (`interceptors.definitionDrift.persist`, gateway modunda varsayılan açık):** sunucunun ilk listelediği tanımlar (ad, açıklama, girdi/çıktı şeması, annotation'lar) SHA-256 ile `~/.guardbee/pins.json` dosyasına sabitlenir (`pins.file` ile taşınabilir; atomik yazılır, izin 0600). Böylece iki çalışma arasında, bir güncellemeden ya da ele geçirilmeden sonra tool'unu değiştiren bir sunucuya, sırf yeni bir oturum başladı diye yeniden güvenilmez. Değişiklikte `onChange: approve` (varsayılan) ajana onaylanmış tanımı göstermeye devam eder ve ilk çağrıdan önce eski ve yeni açıklamayı yan yana göstererek kişiye sorar; onaylanırsa yeni tanım sabitlenir. `block` çağrıyı reddeder, `warn` loglayıp yenisini kullanır. Bilinen bir sunucudaki yeni tool da aynı şekilde bekletilir. Audit olayları (`ruleId: pin:changed | pin:added | pin:removed`) iki hash'i de taşır; açıklamalar yalnızca `audit.includePayloads` ile yazılır. Yönetmek için `guardbee-proxy pins list | approve <upstream> [tool] | reset [upstream] [tool]`; CI'dan doldurmak için `guardbee-proxy pins import <baseline.json> --upstream <ad>` (bir `mcp-rug-pull-detector` baseline'ı: aynı hash'ler). Tek sunuculu `--` biçimi yalnızca oturum içi sabitlemeyi kullanır.
- **Audit log** hash zincirlidir. Varsayılan olarak argümanların kendisi yerine SHA-256'sını tutar, sonuçları hiç yazmaz; yazmak için `audit.includePayloads: true`. Bir log'u `guardbee-proxy verify-audit ./guardbee-audit.jsonl` ile doğrulayın.
- `guardbee-proxy validate --config guardbee-proxy.yaml` sunucu başlatmadan config'i kontrol eder.
- `--config` verilmezse proxy `./guardbee-proxy.yaml` dosyasını veya `GUARDBEE_PROXY_CONFIG=<dosya>.yaml` değişkenini de okur.

Yukarıdaki tek sunuculu `--` kullanımı 0.x davranışını korur: tool adlarına önek eklenmez, payload'lar loglanır ve toxic flow sadece uyarı olarak loglanır.

---

## Sandbox'lı Upstream'ler

Politika, taint ve maskeleme MCP mesajlarını görür. Bir stdio sunucusu ise sizin yetkilerinizle çalışan bir süreçtir: ele geçirilmiş bir paket bir tool çağrısına hiç cevap vermeden `~/.ssh`'yi ya da bir `.env` dosyasını okuyup dışarı gönderebilir. `upstreams.<ad>.sandbox` onu bir işletim sistemi sandbox'ında çalıştırır: `runtime: docker | podman | bwrap | sandbox-exec | none` (varsayılan: sandbox yok), `fs.readWrite` / `fs.readOnly` / `fs.deny`, `env` (geçirilecek host değişkenleri), `network: open | none` ve `limits: { cpus, memory, pids }` (yalnızca docker / podman).

- **Disk salt okunur.** Yazma yalnızca `fs.readWrite`'a ve özel bir eve, `~/.guardbee/sandbox/<ad>`'a gider (HOME ve TMPDIR oraya işaret eder; sandbox'lı sunucunun npm/uv önbelleği kendisinindir ve sizinkini zehirleyemez).
- **Kimlik bilgileri gizli.** `~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker`, `~/.gnupg`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`, `~/.git-credentials`, `~/.config/gh`, parola depoları, tarayıcı profilleri ve anahtar zincirleri, `.env` dosyaları, proxy'nin kendi pin ve provenance dosyaları ve `fs.deny`.
- **Host ortamı yok.** Yalnızca `PATH`, `LANG`, `LC_ALL`, `TERM`, `TZ`, `env`'deki adlar ve upstream'in kendi `env`'i.
- **`network: none`** ağı keser (paket o zaman zaten kurulu olmalıdır).
- **Platformlar:** `docker` / `podman` (Linux, macOS, Windows; yalnızca mount edilen yollar görünür, CPU/bellek/pid sınırları), `bwrap` (Linux; tüm disk salt okunur, `--unshare-all`), `sandbox-exec` (macOS Seatbelt; yazma ve ağ reddedilir). Windows'ta yerleşik runtime yoktur: `docker` veya `podman` kullanın.
- **Sessiz geri dönüş yok.** Bu makinede çalışamayacak bir sandbox (runtime `PATH`'te yok, Linux'ta `sandbox-exec`, container olmadan `limits`, `~` veya `/` için `readWrite`, kimlik deposunun içindeki bir yol) gateway'i gerekçesiyle durdurur; `guardbee-proxy validate` aynı sorunları listeler. Başlatma hataları `ruleId: sandbox:invalid | sandbox:failed` audit olaylarıdır.
- **`guardbee-proxy init --sandbox [runtime]`** içe aktarılan her stdio sunucusunu sandbox'a koyar (varsayılan: macOS'ta `sandbox-exec`, kuruluysa Linux'ta `bwrap`, değilse `docker`); argüman olarak verilen dizinler yazılabilir olur.
- **Sınırlar:** `sandbox-exec` Apple tarafından kullanımdan kaldırılmış olsa da macOS'un mekanizmasıdır ve CPU/bellek sınırlamaz; `bwrap` ayrıcalıksız user namespace ister. Container olmayan runtime'larda yalnızca kimlik listesi, `.env` dosyaları ve `fs.deny` okumaya kapalıdır, gerisi okunabilir (allowlist için container kullanın). stdio sunucuları için `network: open` ya hep ya hiçtir; host allowlist'leri HTTP upstream'lerine uygulanır. Ayrıntılı tablo ve örnek için [README](README.md#sandboxed-upstreams).

## Güvenlik Raporları

`guardbee-proxy report`, audit log'dan güvenlik ekibi veya denetçi için dönemsel bir rapor üretir: özet sayılar, **OWASP LLM Top 10 (2025)** ve **MITRE ATLAS** ile eşlenmiş bulgular, kişisel veri sayıları, en çok engelleyen kurallar ve hash zincirinin durumu. Payload asla rapora girmez.

```bash
openssl genpkey -algorithm ed25519 -out guardbee-report.key
openssl pkey -in guardbee-report.key -pubout -out guardbee-report.pub
guardbee-proxy report ./guardbee-audit.jsonl --days 30 --lang tr --key guardbee-report.key --out ekim.html
guardbee-proxy verify-report ekim.html --pubkey guardbee-report.pub
```

Rapor, kanonik JSON'unun SHA-256'sını ve dönemdeki son audit olayının hash'ini taşır; `--key` ile Ed25519 imzalanır. `verify-report` `.json`, `.html` veya `.md` raporu doğrular; imzalayanı sabitlemek için `--pubkey` verin. Biçimler: Markdown, HTML, JSON; `--lang en|tr`. Eşleme tablosu için [README](README.md#security-reports).

- **Uyumluluk çerçeveleri (`--framework eu-ai-act | iso42001 | soc2 | nist-ai-rmf`):** raporun içine, gateway'in desteklediği gereksinimleri atıflarıyla (EU AI Act maddesi, ISO/IEC 42001 Ek A kontrolü, SOC 2 Trust Services kriteri, NIST AI RMF alt kategorisi) ve dönemdeki kanıtlarıyla (eşlenen kategorilerdeki bulgular; kayıt tutma için hash zincirli log, insan gözetimi için onaylar, tedarikçi kontrolleri için pin ve provenance kontrolleri…) listeleyen bir bölüm ekler. Bölüm imzalı raporun parçasıdır. Tablolar GuardBee'nin metinleri yorumlamasıdır, `@guardbee/guard-core`'da (`COMPLIANCE_FRAMEWORKS`) sürümlenir (`mappingVersion`): bir değerlendirme için kanıttır, sertifika değildir.
- **AIBOM:** `guardbee-proxy aibom --config guardbee-proxy.yaml --out aibom.cdx.json`, gateway'in arkasındaki MCP sunucularını (package URL, sabitlenmişse sürüm, provenance durumu ve kaynak repo, sandbox ayarları), her sunucunun tool'larını (ad, açıklama, sabitlenmiş SHA-256, hint'ler) ve LLM rotalarını (`machine-learning-model`) **CycloneDX 1.6** olarak yazar. Config'i, pin dosyasını ve provenance önbelleğini okur, istek yapmaz; ortam değerleri, header'lar ve anahtarlar asla içinde olmaz. Çıktı resmi CycloneDX 1.6 şemasına göre geçerlidir (test edilir).

## Gözlemlenebilirlik (OpenTelemetry)

Her tool çağrısı `tools/call <tool>` adlı bir span'dır (kind SERVER) ve MCP semantik kurallarının özniteliklerini taşır — `mcp.method.name`, `gen_ai.tool.name`, `gen_ai.operation.name: execute_tool`, `mcp.session.id`, `enduser.id` (OIDC) — ayrıca `guardbee.upstream`, `guardbee.labels` ve `guardbee.pii_hits`. Upstream'e yapılan çağrı bir alt span'dır (kind CLIENT, `server.address` = upstream). Çağrının her audit olayı — engellemeler, toxic flow'lar, onaylar, uyarılar, sunucunun sampling istekleri — bir span event'idir (`guardbee.blocked`, … `guardbee.rule_id` ve `guardbee.reason` ile); engellenen çağrı `guardbee.blocked: true` taşır. Argümanlar ve sonuçlar span'lara asla yazılmaz.

Proxy yalnızca `@opentelemetry/api`'ye bağımlıdır; SDK yoksa span'ların maliyeti yoktur. OTLP/HTTP ile göndermek için SDK'yı proxy'nin yanına kurun ve standart ortam değişkenlerini ayarlayın:

```bash
npm i -g @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com:4318
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer …"   # collector'ınız istiyorsa
export OTEL_SERVICE_NAME=guardbee-gateway                      # varsayılan: guardbee-security-proxy
```

Docker imajında SDK hazırdır. `OTEL_SDK_DISABLED=true` ya da `OTEL_TRACES_EXPORTER=none` kapalı tutar; kendi SDK'sını önce kaydeden bir process (`NODE_OPTIONS` ile zero-code enstrümantasyon) onu kullanmaya devam eder.

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
  oidc:                       # ve/veya: kullanıcılar kimlik sağlayıcınızla girer
    issuer: https://login.acme.com
    audience: guardbee-gateway
  maxSessions: 100
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  linear:
    url: https://mcp.linear.app/mcp     # bir Streamable HTTP upstream
    headers: { Authorization: "Bearer ${LINEAR_TOKEN}" }
    network: { mode: allowlist, allowHosts: ["mcp.linear.app"] }   # yönlendirme olsa bile yalnızca bu host'lar
audit:
  sink: file
  filePath: /var/log/guardbee/audit.jsonl
  dashboard:
    url: https://app.guardbee.ai/api/v1/gateway/events
    apiKeyEnv: GUARDBEE_API_KEY        # gateway.write scope'lu workspace API key'i
```

- **Oturumlar birbirinden ayrık.** Her MCP oturumunun kendi taint durumu, PII token'ları ve tool pin'leri vardır; bir ajanın toxic flow'u başka bir ajanı asla engellemez. Tüm oturumlar upstream bağlantılarını paylaşır. Audit olayları `sessionId` taşır. MCP 2026-07-28'de oturum yoktur; yerine ne geçtiği için [MCP Protokol Sürümleri](#mcp-protokol-sürümleri).
- **Key yoksa ağ da yok.** `listen.apiKeys` ya da `listen.oidc` olmadan loopback dışında dinlemek config hatasıdır. Key'ler sabit zamanda karşılaştırılır; yanlış veya eksik key `401` alır.
- **Ağ çıkışı (`upstreams.<ad>.network`):** proxy'nin bir HTTP upstream'e açtığı her bağlantı (yönlendirmenin her adımı dahil) bağlantı anında denetlenir: ad çözülür, her adres kontrol edilir ve soket kontrol edilen adrese bağlanır; böylece kontrol ile bağlantı arasında değişen bir DNS cevabı (rebinding) iç ağa ulaşamaz. Link-local adresler (`169.254.169.254` gibi bulut metadata servisleri), `0.0.0.0` ve ayrılmış aralıklar her kodlamada (sekizlik/onaltılık IPv4, IPv4-mapped veya NAT64 IPv6) her zaman reddedilir. `blockPrivate` loopback ve özel adresleri (RFC 1918, CGNAT, `fc00::/7`) reddeder; verilmezse yapılandırılan URL'e göre karar verilir: `localhost` veya özel adresteki bir sunucu orada kalabilir, herkese açık bir sunucu iç ağınıza ulaşamaz. `mode: allowlist` ve `allowHosts` (`*.example.com` glob'ları) host'ları sınırlar. Reddedilen bağlantılar `type: blocked`, `ruleId: network:private | network:metadata | network:reserved | network:host` audit olayıdır ve `destination` (host ve adres, isteğin kendisi asla) taşır; SIEM aktarımına ve dashboard'a da gider. Stdio sunucuları kendi soketlerini açar; bunları sınırlamak bir işletim sistemi sandbox'ı gerektirir ve burada kapsanmaz.
- **Dizin grupları (`listen.ldap`):** LDAP / Active Directory grupları, kimliği zaten bilinen çağırana (OIDC kullanıcısı veya LLM gateway anahtarının kullanıcısı) eklenir; kurallar, kotalar, `llm.access` ve bütçelerdeki `group` eşleşmeleri bunları kullanır. Dizin kimlik doğrulamaz. `{user}` RFC 4515'e göre kaçışlanır; dizine ulaşılamazsa varsayılan `503` (`onError: token-groups` ile token grupları ile devam). SAML proxy ayarı değildir: SAML konuşan IdP'ler (Entra ID, Okta, ADFS, Keycloak) OIDC token da verir — `listen.oidc` kullanın. Örnek için [README](README.md#remote-mode-http).
- **Kullanıcılar (`listen.oidc`):** proxy, API key'lerin yanında ya da yerine OpenID Connect sağlayıcınızın (Okta, Entra ID, Auth0, Keycloak, Google…) JWT'lerini kabul eder. İmzayı issuer'ın JWKS'ine göre (discovery belgesinden ya da `jwksUri`'den), issuer'ı, `audience`'ı (zorunlu: başka bir servis için verilmiş token reddedilir) ve süreyi doğrular. Kullanıcı `userClaim`'den (varsayılan `sub`; `email` yaygındır), gruplar `groupsClaim`'den (varsayılan `groups`, liste ya da boşlukla ayrılmış metin) gelir. Kurallar `user` (glob, ör. `"*@contractor.com"`) ve `group` ile eşleşebilir, her audit event'i `user` taşır. Oturum onu açan kullanıcıya aittir: başka bir kullanıcının token'ı o oturumda `403` alır. `401` cevabı `WWW-Authenticate: Bearer resource_metadata=…` taşır ve `/.well-known/oauth-protected-resource` (RFC 9728) issuer'ı bildirir; böylece yetkilendirme spec'ini uygulayan MCP istemcileri nerede giriş yapacağını bulur. Reverse proxy arkasında `oidc.resource`'u herkese açık URL'e ayarlayın.
- **SIEM aktarımı (`audit.exporters`):** her audit event'i, istek yolunu bekletmeden batch'ler halinde Splunk HEC'e, Elasticsearch/OpenSearch `_bulk`'a veya bir syslog toplayıcısına (UDP/TCP/TLS, RFC 5424, CEF veya JSON) da gönderilir. Kimlik bilgileri ortam değişkenlerinden okunur; Elasticsearch'e event hash'i `_id` olarak yazıldığı için tekrar gönderilen batch çoğalmaz. Ayrıntılar ve örnek için [README](README.md#remote-mode-http).
- **Birden fazla replika (`state`):** kotalar ve LLM bütçeleri varsayılan olarak süreç içinde sayılır; yük dengeleyici arkasındaki her replika tam limiti verir. `state.backend: redis` ile her replika aynı sayaçları kullanır: kontrol ve sayım tek bir Lua betiğinde çalışır, böylece iki replika son çağrıyı birlikte alamaz; anahtarlar pencereleriyle birlikte sona erer (Redis 6 ve üstü; anahtarlar tek hash tag'i paylaştığı için Redis Cluster da çalışır). Proxy RESP'i kendisi konuşur, kurulacak bir şey yoktur. Redis'e ulaşılamazsa `onError` karar verir: `local` (varsayılan) Redis dönene kadar süreç içinde sayar, `fail-open` çağrıları saymadan geçirir, `fail-closed` kota veya bütçesi olan çağrıları reddeder; kesinti ve düzelme audit olaylarıdır (`ruleId: state:unavailable | state:recovered`). Anomali pencereleri oturum başınadır; bir MCP oturumu zaten tek replikada yaşar. Örnek için [README](README.md#remote-mode-http).
- `GET /healthz` `{"ok": true, "sessions": N, "contexts": M}` döner (2025 oturumları ve 2026-07-28 bağlamları). `maxSessions` üstündeki oturum ve bağlamlar `503` alır.
- **Dashboard:** `audit.dashboard` her audit olayını toplu halde, `apiKeyEnv`'den alınan workspace API key'iyle GuardBee dashboard'una gönderir; key dosyada durmaz. Dashboard'a ulaşılamazsa olaylar bellekte bekler (en fazla 10.000) ve sonra gönderilir. Reddedilen key stderr'e bir kez raporlanır. Tool çağrıları dashboard'u asla beklemez.
- `init` artık Streamable HTTP server'ları (`url` + `headers`) da proxy'nin arkasına taşır. Eski SSE server'lar istemci config'inde kalır ve raporlanır.

Docker:

```bash
docker build -t guardbee/mcp-security-proxy packages/security-proxy
docker run -p 8787:8787 -e GUARDBEE_PROXY_KEY=... -e GUARDBEE_API_KEY=... \
  -v "$PWD/guardbee-proxy.yaml:/etc/guardbee/guardbee-proxy.yaml:ro" guardbee/mcp-security-proxy
```

---

## MCP Protokol Sürümleri

Proxy her iki tarafta da MCP **2026-07-28** ve **2025-11-25** (ve ondan önceki 2025 sürümlerini) konuşur ve bunları karıştırabilir: 2025 sürümündeki bir ajan proxy üzerinden 2026-07-28 sunucusunu kullanabilir, tersi de geçerli. MCP TypeScript SDK v2 üzerine kuruludur.

- **Ajanlar.** stdio'da sürüm bağlantı açılırken belirlenir. HTTP'de her istek hangi sürümü konuştuğunu söyler: 2025 istemcileri eskisi gibi oturum alır (`Mcp-Session-Id`), 2026-07-28 istekleri oturumsuz karşılanır.
- **Upstream'ler.** Varsayılan olarak proxy her sunucuya önce 2026-07-28'i sorar (`server/discover`), olmazsa 2025 `initialize` el sıkışmasına döner. Upstream başına `protocol` ile sabitlenebilir: `auto` (varsayılan), `2025-11-25` (yoklama yok) veya `2026-07-28` (yalnızca yeni). stdio'da `auto` yoklama için sunucuyu kısa süreliğine bir kez daha başlatır; iki kez başlatılmaması gereken sunucular için `protocol: 2025-11-25` verin. `docker` veya `podman` sandbox'ındaki sunucuda varsayılan `2025-11-25`'tir; `auto` veya `2026-07-28` ile kendi container'ında yoklanır.
- **Oturumun yerine ne geçer (HTTP, 2026-07-28).** Taint, PII token'ları, tool pin'leri ve anomali sayaçları **kullanıcı ve bağlam** başına tutulur: kullanıcı OIDC token'dan (API key ile gelenler tek kullanıcı sayılır), bağlam isteğe bağlı `X-GuardBee-Context` header'ından (1–128 harf, rakam, `.`, `_`, `:`, `-`; örneğin ajan sohbeti başına bir değer) gelir. Header yoksa kullanıcının çağrıları tek bağlamı paylaşır; bu engellemeden yana hata yapar: bir sohbetin okuduğu veri, başka biri dışarı bir şey göndermeye çalıştığında da sayılır. Bağlam `listen.contextIdleSeconds` (varsayılan 1800) saniye istek gelmezse düşer; oturum ve bağlamların toplamını `listen.maxSessions` sınırlar. Keşif ve `subscriptions/listen` istekleri (`Mcp-Method` header'ından tanınır) bağlam almaz.
- **Onaylar.** 2026-07-28 sunucusu çağrının ortasında istemciye elicitation isteği gönderemez. Bir kural çağrıdan önce onay istediğinde proxy çağrıyı `input_required` ile cevaplar; istemci formu gösterir, cevapla çağrıyı tekrar gönderir ve çağrı ancak o zaman sunucuya ulaşır. Cevap kullanıcıya, araca ve argümanların kendisine bağlı, imzalı bir `requestState` içinde taşınır; başka bir çağrıda kullanılamaz, uydurulamaz. Ancak sunucu cevap verdikten sonra sorulabilen onaylar (sonuçlardaki konu kuralları) ve sampling onayları `approval.channels`'ta dashboard varsa oraya gider, yoksa reddedilir. Yük dengeleyici arkasında her replikaya aynı anahtarı verin: `listen.stateKeyEnv: GUARDBEE_STATE_KEY` (en az 32 bayt; varsayılan: süreç başına rastgele).
- **Sampling.** 2026-07-28 istemcisinden başka bir sunucunun çağrısının ortasında tamamlama istenemez; böyle bir istemciyle sunucuların sampling istekleri reddedilir (`sampling:unavailable`). Ajan 2025-11-25'teyken çağrı sırasında sampling isteyen bir 2026-07-28 *sunucusu* eskisi gibi karşılanır.
- **SSE yok.** Proxy yalnızca Streamable HTTP'ye bağlanır ve onu sunar. `guardbee-proxy init` SSE sunucularını dışarıda bırakır ve çoğunun artık `/sse` yerine sunduğu `/mcp` uç noktasını gösterir.

## LLM API Gateway

HTTP modunda proxy, uygulamalarınızla model sağlayıcıları (OpenAI, Anthropic, OpenAI uyumlu yerel modeller) arasında da durabilir. Uygulamalar SDK'nın base URL'ini proxy'ye çevirip bir gateway anahtarı kullanır; gerçek sağlayıcı anahtarları proxy'nin ortam değişkenlerinde kalır.

- **Uç noktalar:** `POST /v1/chat/completions`, `POST /v1/responses` (OpenAI Responses API), `POST /v1/embeddings` (OpenAI), `POST /v1/messages` (Anthropic), `GET /v1/models`. Responses API'de `instructions`, mesaj öğeleri, fonksiyon çağrısı argümanları ve tool çıktıları maskelenir; `input_file`/`input_audio` `415` alır. `mode: tokenize` ile `previous_response_id` üzerinden sürdürülen bir konuşmada önceki isteğin token'ları geri konamaz
- **Anahtarlar:** `llm.keys` ile kişi/uygulama başına gateway anahtarı (kullanıcı ve grup bilgisiyle); `listen.apiKeys` ve OIDC token'ları da kabul edilir
- **Kontroller:** kullanıcı ve tool mesajlarında prompt injection, prompt'ta credential (403), mesaj metninde PII maskeleme veya `tokenize` (sağlayıcı gerçek değeri görmez, kullanıcı yanıtta görür)
- **Model erişimi (`llm.access`):** kullanıcı (glob) veya gruba göre hangi modellerin kullanılabileceği; eşleşen girdi yoksa `accessDefault` (allow/deny). İzin verilmeyen model `403` alır ve `/models` yalnızca izinli modelleri listeler
- **Hassas veri yönlendirme (`llm.sensitive`):** prompt'ta kişisel veri (isteğe bağlı olarak yalnızca belirli kategoriler) veya listelenen bir konu varsa istek, istenen model yerine kendi çalıştırdığınız modele (Ollama, vLLM, llama.cpp) gider; veri içeride kaldığı için varsayılan olarak maskelenmez. Yönlendirme audit log'a `ruleId: llm:route:sensitive` ile yazılır ve dashboard'da görünür. Yerel modelin bu API için route'u yoksa istek reddedilir
- **Bütçeler:** kullanıcı veya gateway başına istek, token ve USD limitleri; dolunca `429` + `Retry-After`
- **Audit:** her çağrı `llm: { model, inputTokens, outputTokens, costUsd }` ile loglanır
- **Streaming:** iki API'de de çalışır; yanıtın yeniden yazılması gerektiğinde (token geri koyma, `maskResponses`) metin akarken yeniden yazılır: yalnızca güvenli bir kesme noktasına kadar (iki yanında rakam olmayan boşluk; IBAN, kart gibi gruplu sayılar bölünmez) bekletilir ve daha önce gönderilen son 300 karakterle birlikte işlenir, böylece `Pasaport No:` gibi bir etiket sonraki olaydaki değere yine uygulanır

Tam yapılandırma örneği için [README](README.md#llm-api-gateway) dosyasına bakın.

### İsteklerdeki PDF'ler, görseller ve ses

`llm.documents.pdf: true` ile istek içindeki bir PDF reddedilmek yerine okunur: `data:application/pdf;base64,` URL'li OpenAI `file` ve Responses `input_file` parçaları, base64 PDF kaynaklı Anthropic `document` blokları (mesajlarda, system prompt'ta ve tool sonuçlarında). Proxy PDF'in metin katmanını [`@guardbee/mcp-document-scanner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/document-scanner) ile çıkarır ve bu metni, PDF'in yerine, yukarıdaki her adımdan geçirir: prompt injection, credential, konu kuralları, hassas yönlendirme ve PII.

- **Temiz:** PDF sağlayıcıya değiştirilmeden gider.
- **Proxy'nin maskeleyeceği kişisel veri:** `403` ile reddedilir (`ruleId: pii:document`), çünkü proxy bir PDF'i yeniden yazamaz ve maskesiz de göndermez. Mesaj kategorileri söyler, değerleri asla. `masking: off` olan bir route'ta veya `llm.sensitive` isteği kendi modelinize yönlendirdiğinde PDF iletilir ve PII'ı `piiHits`'te sayılır; `llm.sensitive` ile kişisel veri içeren bir PDF tam da içeride kalması gereken şeydir.
- **Injection, credential, konu kuralları:** metindekiyle aynı retler (`llm:injection`, `llm:credential`, kuralın id'si).
- **Tamamı okunamayan:** `maxBytes` veya `maxPages` üstü, aslında PDF olmayan, şifreli ya da bozuk, `timeoutSeconds`'tan uzun süren, ya da `ocr` kapalıyken metin katmanı olmayan bir sayfa içeren PDF. Sebebi anan `documents:unread` `warn` event'i yazılır ve PDF maskelenemez kalır: maskeleme uygulanıyorsa `415 guardbee_unmaskable_content`. Kısmen okunmuş bir PDF asla kontrol edilmiş sayılmaz.
- **Audit:** `tool_call` event'inin `input`'unda PDF yerine `[pdf "<ad>": <bayt> bytes, sha256 <hash>]` durur. `documents` alanı okunan her PDF'i listeler: `{ name, modality: "pdf", bytes, sha256, pages, chars, checks }`; `checks` metni üzerinde çalışan kontrolleri adlandırır (`injection`, `credentials`, `topics`, `sensitive-routing`, `pii`).

`llm.documents.images: true` ile istek içindeki görseller de aynı şekilde, OCR ile okunur: `data:image/...;base64,` URL'li OpenAI `image_url` ve Responses `input_image` parçaları, base64 kaynaklı Anthropic `image` blokları (mesajlarda, system prompt'ta ve tool sonuçlarında). OCR'ın bulduğu metin her kontrolde görselin yerini alır ve sonuçlar PDF'tekiyle aynıdır: temiz görsel değiştirilmeden iletilir, proxy'nin maskeleyeceği kişisel veriyi içeren görsel `403 pii:document` ile reddedilir, okunamayan görsel (`tesseract.js` kurulu değil, veri görsel değil, `maxBytes` üstü, `timeoutSeconds`'tan uzun) maskeleme uygulanıyorsa `415 guardbee_unmaskable_content` olur. Audit'teki yer tutucu `[image "image <n>": <bayt> bytes, sha256 <hash>]`, `documents` kayıtlarında `modality: "image"`.

- **`tesseract.js`'i proxy'nin yanına kurun** (`npm i tesseract.js`). Dil verisi (`languages`, varsayılan Türkçe ve İngilizce) bir kez `~/.cache/guardbee/tessdata`'ya indirilir; proxy'yi çevrimdışı tutmak için `langPath`'i `.traineddata` dosyalarının olduğu bir klasöre ayarlayın.
- **OCR basılı metni okur, modelin gördüğü her şeyi değil.** El yazısı, düşük kontrastlı veya çok küçük metin, fotoğraf ve grafiklerdeki metin kaçabilir; model OCR'ın okumadığını yine de okuyabilir. `images: true`'yu belge, sohbet ve form ekran görüntülerini yakalayan bir kontrol olarak görün, bir görselde kişisel veri olmadığının garantisi olarak değil.
- **Maliyet:** dizüstü CPU'da ekran görüntüsü başına yaklaşık 0,3 sn, görsel taşıyan her istekte; büyük görsellerde daha fazla. `timeoutSeconds` ve `maxBytes` bunu sınırlar.

`llm.documents.audio` ile Chat Completions `input_audio` parçaları (`wav`, `mp3`) belirttiğiniz konuşmadan metne servisiyle yazıya dökülür ve döküm aynı sonuçlarla her kontrolden geçer: temiz ses değiştirilmeden iletilir, içinde kişisel veri söylenen ses `403 pii:document` ile reddedilir, yazıya dökülemeyen ses (başka format, o formatta olmayan veri, servis kapalı, hata dönüyor veya `timeoutSeconds`'tan yavaş) maskeleme uygulanıyorsa `415 guardbee_unmaskable_content` olur. Audit'teki yer tutucu `[audio "audio <n>": <bayt> bytes, sha256 <hash>]`; dökümün kendisi loglanmaz.

- **Servis**, OpenAI'ın `POST /v1/audio/transcriptions` isteğini (multipart `file`, `model`, `response_format=json`, isteğe bağlı `language`) alıp `{ "text": … }` dönen herhangi bir endpoint olabilir: [whisper.cpp](https://github.com/ggml-org/whisper.cpp) `whisper-server --inference-path /v1/audio/transcriptions`, faster-whisper-server / Speaches, vLLM veya bir sağlayıcının API'si.
- **Ses bu servise, kontrollerden önce, olduğu gibi gider**; servisi verinin gidebileceği yerde çalıştırın: kendi makinenizde veya ağınızda. Herkese açık bir API'ye yönlendirmek her sesli mesajı oraya göndermek demektir.
- **Konuşmadan metne yanlış duyabilir.** Sesli okunan numaralar ("on bir, sıfır sıfır…") kelime olarak veya hatalı dönebilir; bunu net konuşmayı yakalayan bir kontrol olarak görün, garanti olarak değil.
- **Maliyet:** her ses parçası için bir döküm, CPU'da dakikalık konuşma başına birkaç saniye; `timeoutSeconds` ve `maxBytes` bunu sınırlar.

Henüz kapsanmayanlar: file id veya URL ile verilen PDF'ler (yine `415`), URL veya file id ile verilen görseller (okunmadan iletilir: proxy bunları indirmez), `ner:` modelinin PDF, görsel veya döküm içindeki kişi adları ve Responses ya da Realtime API'deki ses. PDF okumak, PDF taşıyan her istekte süre ekler; `timeoutSeconds` ve `maxPages` bunu sınırlar.

```yaml
llm:
  documents:
    { pdf: true, images: true, ocr: false, languages: [tur, eng], maxBytes: 20971520, maxPages: 50, timeoutSeconds: 30,
      audio: { url: "http://127.0.0.1:8080/v1/audio/transcriptions", model: whisper-1, language: tr } }
```

### Embeddings

`POST /v1/embeddings` her girdi metnini embedding'den önce maskeler; vektörler olduğu gibi döner. Maskelenmiş metni indekslemeden önce bilinmesi gerekenler:

- **Maskeleme burada deterministiktir.** Yerleşik değerler sabit yer tutucusunu alır (`[TC-KİMLİK]`, `***@[EMAIL]`), `mode: tokenize` kullanılmaz (token istek başınadır, aynı doküman her seferinde farklı embed edilirdi), org block kalıpları istek başına değil metin başına numaralanır. Aynı metin, hangi batch'te gönderilirse gönderilsin aynı vektörü verir.
- **Yalnızca maskelenen değerde farklı olan dokümanlar aynı vektöre düşer.** Sadece kişi adı veya kimlik numarası farklı iki kayıt tek vektörde birleşir; benzerlik araması bu kişileri ayırt edemez. Vektör benzerliğine değil, kendi ID alanınıza (metadata) göre filtreleyin.
- **İndeksleme ve sorgu aynı yoldan geçmeli.** Maskeli metinden üretilen vektör yalnızca maskeli metinden üretilen vektörlerle karşılaştırılabilir: hem indekslediğiniz dokümanları hem arama sorgularını aynı `piiMasking` ayarlarıyla gateway'den geçirin.
- **Uzunluk sınırı eleman başınadır.** `input`'un her elemanı `llm.maxTextChars` ile kontrol edilir; sınırı aşan tek eleman tüm batch'i `413` ile reddettirir. Token-id girdisi (`[[1, 2, 3]]`) maskelenemez, `415` alır — metin gönderin.
- Embeddings'e uygulanmayanlar: prompt injection taraması (injection hakkındaki bir doküman da indekslenebilmeli) ve `llm.sensitive` yönlendirmesi (başka modelin vektörleri indeksinizle karşılaştırılamaz). Credential, konu, bütçe ve erişim kontrolleri her zamanki gibi uygulanır.

### Hata durumunda davranış

Gateway kapalı başarısız olur (fail closed): bir isteği kontrol edemediğinde veya maskeleyemediğinde sağlayıcı çağrılmaz. Ret, hata gövdesinde (`error.code`; OpenAI ve Anthropic hata biçiminde) ve `x-guardbee-error` başlığında sabit bir kod taşır, audit log'a `blocked` event'i yazılır. Maskelenemeyen metin ne yanıtta ne audit log'da yer alır; dedektörün kendi hata mesajı yerine yalnızca hata sınıfı yazılır.

| Durum | Kod | Ne zaman | Audit `ruleId` |
| --- | --- | --- | --- |
| `502` | `guardbee_masking_failed` | Bir dedektör veya tarama hata fırlattı, bir block kalıbı zaman bütçesini aştı ya da isim modeli (`ner:`) yanıt vermedi. Çağrıdan önceki her kontrolü kapsar: injection, credential, konu, hassas yönlendirme, maskeleme. | `pii:masking-failed`, `pii:pattern-timeout`, `pii:ner-failed` |
| `415` | `guardbee_unmaskable_content` | İstekte proxy'nin okuyamadığı içerik var: OpenAI `input_audio` veya `file` parçaları, kaynağı PDF (base64, url, file) olan Anthropic `document`, bilinmeyen parça/blok türü, metin ya da liste olmayan içerik. `llm.documents.pdf` ile istek içindeki PDF'ler okunur, yalnızca tamamı okunamayan reddedilir; `llm.documents.images` ve `llm.documents.audio` ile okunamayan görseller ve ses de reddedilir. Mesaj bulunanı adıyla söyler. | `pii:unmaskable` |
| `413` | `guardbee_text_too_large` | Tek bir metin (mesaj, parça, tool sonucu) `llm.maxTextChars`'tan (varsayılan 2.000.000 karakter) uzun. Sınır istek başına değil metin başınadır: metni birkaç mesaja veya parçaya bölün. | `pii:text-too-large` |

Reddedilmeyenler: görseller (`image_url`, `input_image`, Anthropic `image`) olduğu gibi iletilir ve `llm.documents.images` yoksa incelenmez; assistant turunda sağlayıcının kendi ürettiği bloklar (`thinking`, `redacted_thinking`, `server_tool_use`, `*_tool_result`) aynen geri gönderilir. `415` ve `413` yalnızca istek maskelendiğinde uygulanır: `piiMasking.enabled: false`, `masking: off` olan bir route veya `llm.sensitive` ile `mask: true` olmadan içeri yönlendirilen istek maskelenmez, maskelenemez diye de reddedilmez.

Maskelenemeyen bir yanıt (`maskResponses` ya da token geri koyarken hata) alıkonur: metin, akış ortasında da olsa `[GuardBee: withheld, …]` ile değiştirilir ve aynı `ruleId`'lerle loglanır.

**Route başına maskesiz geçiş.** Bir `llm.routes` girdisinde `masking: off`, o route'un prompt'larını (ve yanıtlarını) maskelemeden gönderir. Açıkça yazılması gerekir, örtük geçiş yoktur; bu tür her istek route'u adıyla anan `ruleId: pii:masking-off` `warn` event'i yazar, PII yine `piiHits`'te sayılır. `mask` aksiyonlu bir konu kuralı o route'ta da maskeler.

MCP gateway'de maskeleme hatası tool sonucunu alıkoyar: istemci `data: { guardbee: "guardbee_masking_failed" }` taşıyan bir MCP hatası (`InternalError`, `Result withheld: …`) alır, `tool_response` event'i yazılmaz.

---

## Kodlama Ajanı Hook'ları

Proxy yalnızca MCP trafiğini görür; kodlama ajanının kendi tool'ları (shell, dosya okuma, web fetch) ondan geçmez, yani `cat .env` ardından `curl -d @.env …` görünmez kalır. `guardbee-hook` aynı politikayı ajanların hook sistemleri üzerinden bu tool'lara uygular.

```bash
npm i -g @guardbee/mcp-security-proxy
guardbee-hook install --claude-code     # ~/.claude/settings.json (PreToolUse + PostToolUse)
guardbee-hook install --cursor          # ~/.cursor/hooks.json
guardbee-hook uninstall --claude-code   # yalnızca GuardBee girdilerini kaldırır
```

- `.env`, `~/.ssh`, cloud credential dosyaları `sensitive`; `curl`, `git push`, `npm publish` gibi komutlar `egress`; `rm -rf`, `git push --force` `destructive`; `WebFetch`/`WebSearch` `untrusted` + `egress` olarak etiketlenir.
- Kurallar `upstream: claude-code|cursor`, `tool: Bash|Read|WebFetch|mcp__…`, `args` ve `topic` ile eşleşir; lethal trifecta kontrolü oturum boyunca (diskte saklanan taint ile) çalışır.
- Hook sizin yerinize hiçbir zaman "allow" demez; ajanın kendi izin istemleri yerinde kalır. `defaults.action` ajan tool'larına uygulanmaz.
- Çıktıdaki gizli talimatlar ajanı durdurur; çıktıdaki PII oturumu taint eder. Yerleşik tool çıktıları yeniden yazılmaz (aksi halde `Edit` çağrıları bozulurdu).
- Ayrıntılar için [README](README.md#coding-agent-hooks).

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
| Telefon (TR) | cep / sabit hat / 850 öneki; `(0532) …` da; öneksiz `5xx` numara yalnızca `numaram`, `tel`, `cep` gibi bir sözcükten sonra | `0532 123 45 67` | `+90-***-***-**[TELEFON]` |
| Vergi no (VKN) | kontrol hanesi, `VKN` / `Vergi No` etiketi gerekir | `VKN: 1234567890` | `VKN: [VKN]` |
| Sağlayıcı anahtarları | secret-scanner'dan 22 anahtar ve token formatı (AWS, GitHub, Stripe, OpenAI, Anthropic, Slack, …) | `ghp_…`, `AKIA…` | `[API-KEY]` |
| Diğer API key'ler | `sk_`/`api_`/`token_`… öneki, harf ve rakam | `api_k3y9x8…` | `[API-KEY]` |
| Özel anahtar | BEGIN…END bloğunun tamamı | `-----BEGIN … PRIVATE KEY-----` | `[PRIVATE-KEY]` |
| Bağlantı dizesi | URL'de kullanıcı:şifre (localhost hariç) | `postgres://app:pw@db/prod` | `[CONNECTION-STRING]` |
| JWT | — | `eyJhbGc...` | `[JWT-TOKEN]` |
| Pasaport | `Pasaport` / `Passport` etiketi gerekir | `Pasaport No: U12345678` | `Pasaport No: [PASAPORT]` |
| SGK / SSK / Bağ-Kur no | etiket gerekir | `SGK sicil no: 1234567890` | `SGK sicil no: [SGK-NO]` |
| MERSİS no | etiket gerekir; 16 hane | `MERSİS No: 0123 4567 8901 2345` | `MERSİS No: [MERSİS]` |
| Doğum tarihi | `Doğum tarihi` / `DOB` etiketi ya da hemen ardından `doğumlu` gerekir; rakamla ya da ay adıyla | `Doğum tarihi: 12.05.1990`, `3 Mart 1979 doğumlu` | `Doğum tarihi: [DOĞUM-TARİHİ]` |
| Posta adresi | `Adres:` etiketi (numara veya cadde/sokak kelimesiyle; IP/e-posta/web adresi değil) ya da etiketsiz `Mah. … Cad./Sok. … No:` biçimi | `Adres: Moda Cad. No 5`, `Gazi Mah. Akasya Cad. No:5 D:3` | `Adres: [ADRES]` |
| KEP adresi | `@….kep.tr` | `acme@hs01.kep.tr` | `***@[KEP]` |
| Kişi adı *(`ner:` gerekir)* | yerel Türkçe NER modeli ([`@guardbee/ner`](../ner)) | `Ayşe Yılmaz aradı` | `[KİŞİ] aradı` |
| IP adresi *(isteğe bağlı)* | geçerli IPv4; `::` veya 8 grup içeren IPv6 | `10.0.3.17` | `[IP]` |
| MAC adresi *(isteğe bağlı)* | 6 hex çift, tek ayraç | `aa:bb:cc:dd:ee:ff` | `[MAC]` |
| Araç plakası *(isteğe bağlı)* | il kodu 01–81, harf/rakam kombinasyonu, birimler değil (`16 GB 2400`) | `34 ABC 123` | `[PLAKA]` |

IP, MAC adresleri ve plakalar altyapı çıktılarında çok sık geçtiği için varsayılan olarak kapalıdır; açmak için: `interceptors.piiMasking.include: [ip_address, mac_address, plate_tr]`. Her kategori `piiHits` ve dashboard'un KVKK raporunda sayılır.

**Neyin maskeleneceğini seçmek.** `piiMasking.preset` maskeleyen dedektörleri seçer; `enable` / `disable` dedektörleri adıyla ekler ya da çıkarır (`piiHits`'teki adlar, ör. `tc_kimlik`, `email`, `github_pat`). `upstreams.<ad>` bir upstream ya da LLM sağlayıcısı için seçimi değiştirir. Tespit daralmaz: varsayılan dedektörlerin hepsi `piiHits`'te sayılmaya ve oturumu taint etmeye devam eder, yalnızca maskeleme seçime uyar. İsteğe bağlı dedektörler hiçbir presette yoktur; `enable` (ya da `include`) ile açılır.

| Preset | Maskeler |
| --- | --- |
| `ALL` (varsayılan) | isteğe bağlı olanlar dışında yukarıdaki tüm dedektörler ve kimlik bilgileri |
| `KVKK` | yalnızca kişisel veri, kimlik bilgisi yok |
| `KVKK_SENSITIVE` | `KVKK` ve dokuz KVKK m.6 özel nitelikli kategori (aşağıda) |
| `IDENTITY` | kişi adı (`ner:` ile), posta adresi, doğum tarihi |
| `IDENTIFIERS` | TC kimlik, VKN, MERSİS, SGK, pasaport, IBAN, kart, telefon, KEP, e-posta |
| `SECRETS` | API anahtarları, token'lar, private key'ler, bağlantı adresleri, JWT |

```yaml
interceptors:
  piiMasking:
    enabled: true
    preset: KVKK
    disable: [address]
    upstreams:
      ops: { preset: SECRETS, enable: [ip_address] }   # bir altyapı sunucusu
```

Bilinmeyen bir preset, dedektör ya da upstream adı config doğrulamasında hata verir.

**Kendi kalıplarınız.** `piiMasking.blockPatterns` hiçbir dedektörün bilmediğini maskeler (dosya no, müşteri kodu): bir regex ya da `{ pattern, category }`; kategori numaralı bir yer tutucu (`CLIENT_NO` → `<CLIENT_NO_1>`, aynı değer aynı numarayı alır) ve `piiHits` anahtarı olur. Çakışmada yerleşik tespit kazanır; block kalıpları presetten bağımsız uygulanır. `piiMasking.allowPatterns`, metninin tamamı eşleşen tespit edilmiş bir değeri maskelemeden bırakır (herkese açık destek adresiniz); korumayı azalttığı için her seferinde audit log'a `ruleId: pii:allow` ile bir `warn` event'i yazılır.

```yaml
interceptors:
  piiMasking:
    enabled: true
    blockPatterns:
      - { pattern: "CL-\\d{6}", category: CLIENT_NO }
      - "DOSYA/\\d{4}"                       # kategori CUSTOM
    allowPatterns: ["destek@acme\\.com\\.tr"]
```

Her kalıbın bir zaman bütçesi vardır (maskeleme çağrısı başına 100 ms); felakete giden bir regex proxy'yi kilitleyemez. İki tür bilerek ters yönde başarısız olur: bütçeyi aşan bir block kalıbı sonucu alıkoyar (`pii:pattern-timeout`; LLM gateway 502 döner), bütçeyi aşan bir allow kalıbı atlanır ve değer maskeli kalır (`pii:allow-skipped`). En fazla 25 kalıp, her biri 200 karakter; geçersiz regex ya da yerleşik bir dedektörün adını taşıyan kategori (`EMAIL`, `IBAN`, `SECRET`, …) config doğrulamasında hata verir. LLM gateway'e gelen bir istek, gövdedeki `guardbee` alanıyla kendi block kalıplarını ekleyebilir (`{ "guardbee": { "blockPatterns": [...] } }`, sağlayıcıya gitmeden çıkarılır); bunlar config'dekilere eklenir, `allowPatterns` içeren istek 400 ile reddedilir: bir istek yalnızca maskelemeyi artırabilir.

Checksum'ı tutmayan sayılar (sipariş no, takip kodu) olduğu gibi bırakılır.

**Kişi adları.** İsmi bir regex bulamaz; `person_name` bir modelden gelir: [`@guardbee/ner`](../ner), çevrimdışı çalışan Türkçe bir BERT NER modeli (186 MB, dizüstü CPU'da metin başına yaklaşık 8 ms). Config'de üst düzey bir `ner:` bölümü olmadıkça kapalıdır. Bu bölüm politika değil kurulum ayarıdır: dashboard politikası onu açamaz, başka yere yönlendiremez.

```yaml
ner:
  url: http://127.0.0.1:8765        # guardbee-ner serve (sidecar)
  tokenEnv: GUARDBEE_NER_TOKEN      # bearer token'ı, ortam değişkeninden
  timeoutMs: 5000                   # varsayılan
# ya da bu süreçte (@guardbee/ner proxy'nin yanına kurulu olmalı):
# ner:
#   modelDir: /opt/guardbee/ner     # varsayılan: guardbee-ner download'un önbelleği
```

Sidecar'ı `npx @guardbee/ner download` ve ardından `npx @guardbee/ner serve` ile çalıştırın; loopback'i dinler. Başka bir makinedeki sidecar `https://` olmalıdır, yoksa metinler ağda açık metin olarak gider. Model, yüklenmeden önce dosyalarını sabitlenmiş SHA-256 özetleriyle karşılaştırır.

Maskelemeden önce değerdeki her metin modele bir kez gönderilir, sonra regex dedektörleriyle aynı geçişte maskelenir. Böylece `person_name` her dedektör gibi `preset` / `enable` / `disable`, `mode: tokenize` (`<pii:person_name:…>`) ve allow kalıplarına uyar. İsimler tool sonuçlarında, `structuredContent`'te, resource'larda, prompt şablonlarında, sampling yanıtlarında ve LLM gateway isteklerinde (embeddings dahil) maskelenir, `llm.sensitive` yönlendirmesinde de sayılır. `llm.maskResponses` açıkken modelin yanıtlarındaki isimler de maskelenir. Akışta metin büyük harfli bir sözcüğün yanından kesilmez, böylece isim modele bütün olarak ulaşır. Model bir yanıtta hata verirse o yanıtın kalanı alıkonur (`[GuardBee: withheld, name detection failed]`). Kodlama ajanı hook'ları, tool çıktısındaki isimleri oturumun taint durumu için sayar; model orada hata verirse çıktı kişisel veri sayılır. Hook süreci her çağrıda yeniden başladığı için hook'lara `modelDir` yerine bir sidecar (`ner.url`) verin. Maskeleme kapalıyken isim aranmaz.

Tamamen bir özel kategori teriminin içinde kalan bir model span'i (`Huntington geni` içindeki `Huntington`), `KVKK_SENSITIVE` çalışıyorsa o kategoriye bırakılır.

`ner:` ayarlıyken model yanıt veremezse (sidecar kapalı, zaman aşımı, hata) hiçbir şey dışarı çıkmaz: tool sonucu alıkonur, LLM isteği `502 guardbee_masking_failed` ile reddedilir, `ruleId: pii:ner-failed`. Maskeleme hiçbir zaman yalnızca regex'e geri düşmez, çünkü metinde yalnızca modelin bulacağı bir isim olabilir.

Model bazı isimleri kaçırır, bazı kelimeleri isim sanar. Cümle başında büyük harfle yazılan ve aynı zamanda isim olan bir kelime (`Barış`, `Umut`) iki yöne de gidebilir; tamamı küçük harfli sohbeti (`elifle konuştum`) çoğu zaman kaçırır. Ölçülmüş sayılar [pii-bench](../pii-bench)'tedir.

**KVKK m.6 özel nitelikli kişisel veriler.** `preset: KVKK_SENSITIVE` (ya da adıyla `enable`) sağlık, din ve inanç, etnik köken, siyasi düşünce, sendika üyeliği, ceza mahkûmiyeti, cinsel hayat, biyometrik ve genetik verileri de maskeler: `health` → `[SAĞLIK]`, `religion_belief` → `[DİN-İNANÇ]`, `ethnic_origin` → `[ETNİK-KÖKEN]`, `political_opinion` → `[SİYASİ-GÖRÜŞ]`, `union_membership` → `[SENDİKA]`, `criminal_record` → `[SABIKA]`, `sex_life` → `[CİNSEL-HAYAT]`, `biometric` → `[BİYOMETRİK]`, `genetic` → `[GENETİK]`. Kategori başına Türkçe ve İngilizce bir terim listesi ve bir bağlam kuralı ile bulunurlar. Bir terim yalnızca aynı metin bir kişiyle ilgiliyse maskelenir: modelin bulduğu bir isim, kişisel bir tanımlayıcı ya da birini işaret eden bir sözcük (`hastanın`, `çalışan`, `babam`, birinci tekil kişi fiili). `Diyabet hastaları için rehber` olduğu gibi kalır; `Çalışan migren nedeniyle raporlu` ise `Çalışan [SAĞLIK] nedeniyle raporlu` olur. Maske terimin çevresindeki ifadeye yayılır, böylece `metal işçileri sendikası üyesi` bütünüyle maskelenir.

Bu dedektörler isteğe bağlıdır, çünkü bir terim listesi tıbbi bir bilgi bankasını hasta dosyasından ayıramaz. Yanlılık ihtiyatlı yöndedir: metin birisiyle ilgiliyse içindeki listelenmiş her terim maskelenir. Anlam değil sözcük bulurlar, bu yüzden listede olmayan bir terimi kaçırırlar. `ner:` ile kullanın, çünkü isimler olmadan birçok metnin bir kişiyle ilgili olduğu ancak o kişinin adından anlaşılır. [pii-bench](../pii-bench#kvkk-art-6-term-lists)'te elle yazılmış zor sette kategori başına F1, isim modeliyle 86–100, modelsiz 40–89; temiz satırlarda yanlış alarm yok. Metin başına 0,15 ms'den az ekler.

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

## Geri bildirim

Sorunuz, öneriniz ya da yanlış bir alarm mı var? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)'ta bir konu açın veya [issue oluşturun](https://github.com/GuardBee/guardbee-mcp/issues). GuardBee işinize yaradıysa [repoya](https://github.com/GuardBee/guardbee-mcp) bir ⭐ başkalarının da bulmasına yardım eder.
