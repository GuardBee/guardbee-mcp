# @guardbee/ner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

Türkçe kişi adlarını bulur. Regex ile yakalanamayan bu verinin de TC Kimlik No, IBAN ve e-posta gibi maskelenmesini sağlar. Yerel bir BERTurk NER modeli ONNX Runtime ile CPU'da çalışır: internet gerekmez, kurum içinde çalışır, hiçbir veri makineden çıkmaz.

Paket isteğe bağlıdır; GuardBee'nin regex dedektörleri buna ihtiyaç duymaz. Adların önemli olduğu yerlerde ekleyin: destek talepleri, İK notları, hukuki metinler, sohbet kayıtları.

## Kurulum

```bash
npm install @guardbee/ner
npx guardbee-ner download        # sabitlenmiş model, ~186 MB, SHA-256 özetleriyle doğrulanır
```

Model `~/.cache/guardbee/ner` altına iner. `GUARDBEE_NER_CACHE` tanımlıysa oraya, `--dir <yol>` verildiyse o dizine iner. İnternetsiz bir sunucu için `download` komutunu ağa erişimi olan bir makinede çalıştırın, dizini kopyalayın ve `--dir` (ya da `GUARDBEE_NER_CACHE`) ile o dizini gösterin. Kopyalanan dizini `guardbee-ner verify --dir <yol>` ile doğrulayabilirsiniz.

## Kullanım

**Uygulama içinde:**

```ts
import { NerModel } from "@guardbee/ner";
import { maskPiiInText } from "@guardbee/guard-core";

const ner = await NerModel.load(); // model dosyaları eksik ya da değiştirilmişse hata fırlatır
const text = "Müşteri Ayşe Yılmaz'ın TC'si 10000000146";
const [found] = await ner.detect([text]);
maskPiiInText(text, undefined, undefined, undefined, () => found);
// → "Müşteri [KİŞİ]'ın TC'si [TC-KİMLİK]"
```

**Yan servis (sidecar) olarak:** Maskelemeyi yapan süreç native bir modül ya da 186 MB'lık bir model yüklememeliyse bu yolu kullanın.

```bash
GUARDBEE_NER_TOKEN=degistir npx guardbee-ner serve --port 8765   # varsayılan olarak 127.0.0.1'e bağlanır
curl -s localhost:8765/v1/detect -H 'authorization: Bearer degistir' \
  -d '{"texts":["DAVACI: AYŞE YILMAZ"]}'
# {"spans":[[{"start":8,"end":19,"detector":"person_name"}]]}
```

- `GET /healthz`, model yüklendikten sonra yanıt verir.
- Metinler hiçbir zaman loglanmaz. Bir hata yalnızca hata türünü bildirir, metni asla içermez.

**Komut satırından:** `npx guardbee-ner detect "Av. Mehmet Karaca dosyayı aldı"`.

## Model

[akdeniz27/bert-base-turkish-cased-ner](https://huggingface.co/akdeniz27/bert-base-turkish-cased-ner) (MIT). Yazarın int8 sürümü kullanılıyor ve tek bir revizyona sabitlenmiş. Model, gözden geçirilmiş bir Türkçe haber NER derlemiyle ince ayar yapılmış BERTurk.

Beş Türkçe NER modeli arasından [pii-bench](../pii-bench/README.md#choosing-the-ner-model) sonuçlarına göre seçildi:

| | Sonuç |
|---|---|
| Kişi adı F1, şablon set | 99,5 (99,0–99,8) |
| Kişi adı F1, elle yazılmış zor isimler seti | 97,1 (91,8–100) |
| Doküman başına gecikme | p50 8 ms, p95 15 ms (M1 Max, tek süreç) |

- Modelin 512 token'lık penceresinden uzun metinler, örtüşen pencerelerle işlenir.
- Bir ad, metinde yazıldığı biçimiyle ad ve soyadını kapsar. Unvanlar (Hanım, Bey, Av.) ve hal ekleri (`'ın`) kapsamın dışında kalır.

## Hata davranışı

- `NerModel.load()`, bir dosya eksikse ya da sabitlenmiş özetiyle eşleşmiyorsa hata fırlatır. Doğrulayamadığı bir modeli asla yüklemez.
- Tespit sırasında bir hata olursa promise reddedilir.
- Maskelemeyi yapan taraf iki durumu da "gönderme" olarak ele almalı: GuardBee'nin maskelemesi hata durumunda isteği kapalı tutar (fail closed). Taranmamış bir metin hiçbir zaman temiz kabul edilmez.

## Sınırlar

- **Yalnızca adlar.** Yer ve kurum adları maskelenmez. KVKK m.6 özel nitelikli verileri (sağlık, din, …) henüz kapsanmıyor.
- **Aynı zamanda kelime olan adlar.** Cümleye büyük harfle başlayan böyle bir kelime (Barış, Umut, Deniz) her iki yöne de gidebilir. Zor isimler setinde satır başındaki "Umut"u kaçırdı; barış görüşmeleriyle ilgili bir cümlenin başındaki "Barış"ı da ad saydı. Cümle ortasında bu kelimeler doğru okundu.
- **Sohbetteki küçük harfli adlar** zor isimler setinde, ekiyle bitişik yazılan biri (`elifle`) dışında bulundu. Ancak model büyük/küçük harf duyarlı olduğu için sohbette düzenli yazılmış metne göre daha fazla kaçırma beklenmeli.
- **Kurum adlarının içindeki kişi adları** ("Mimar Sinan Güzel Sanatlar Üniversitesi") bazen maskeleniyor. Bu bir yanlış alarm, ama hata maskeleme yönünde.
- **Yalnızca Türkçe.** Türkçe metindeki yabancı adlar bulunuyor ("John Smith"). Başka dillerdeki metinler hedeflenmiyor.
