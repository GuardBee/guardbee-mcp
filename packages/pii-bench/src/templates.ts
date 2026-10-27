import type { Domain } from "./categories.js";

/**
 * Document templates. A slot in braces is filled at generation time and
 * labeled by what it holds (see `generate.ts`); `[[text|category]]` is fixed
 * text with a label. Everything else is unlabeled, so a detector that flags
 * it counts as a false positive.
 *
 * People: `P` and `Q` are two people per document. `{P}` is the full name,
 * `{P.first}`, `{P.last}`, `{P.hitap}` (first name + Hanım/Bey: only the name
 * is labeled), `{P.email}`, `{P.kep}`; `:gen|dat|acc|abl|loc` adds a case
 * suffix outside the label (Ayşe Yılmaz'ın).
 *
 * Labeled values: tc, vkn, iban, iban_compact, card, card_dashed, card_plain,
 * phone, phone_plus90, phone_dashed, phone_parens, phone_bare, passport, sgk,
 * mersis, dob, dob_iso, dob_words, addr, addr_short, and the Art. 6 slots
 * health, religion, ethnic, political, union, criminal, sexlife, biometric,
 * genetic.
 *
 * Unlabeled: order (an 11-digit number that fails the TC checksum), refno,
 * ticket, amount, date, time, version, product, company, year, casenum, callcenter
 * (a company's 0850 line, not personal data), rolemail (a department
 * mailbox).
 */
export const PII_TEMPLATES: Record<Domain, string[]> = {
  support: [
    "Konu: Kart iadesi\nMüşteri: {P}\nTCKN: {tc}\nTelefon: {phone}\n\nMüşteri {date} tarihinde yaptığı {amount} tutarındaki ödemenin iadesini istiyor. İade {iban} numaralı hesaba yapılacak. Sipariş no: {order}.",
    "Merhaba, ben {P}. {card} numaralı kartımdan aynı sipariş için iki kez çekim yapılmış. Bana {phone_plus90} numarasından ya da {P.email} adresinden ulaşabilirsiniz. Talep no {ticket}.",
    "Talep {ticket}\n{P.hitap} aradı, kargosu teslim edilmemiş.\nAdres: {addr}\nİletişim: {phone}\nNot: Müşteri {health} nedeniyle evden çıkamadığını, paketin kapıya bırakılmasını rica etti.",
    "{P.hitap:dat} ait aboneliğin fatura bilgileri güncellendi. VKN: {vkn}, fatura e-postası {P.email}. Eski kayıtlarda {Q:gen} adı geçiyordu, kaldırıldı.",
    "Kimlik doğrulama başarısız: Kullanıcı {P} ({tc}) şubede {biometric} ile doğrulama yapmak istedi, sistem eşleşme bulamadı. Kayıt: {ticket}. Destek hattı: {callcenter}.",
    "Şikayet: {P}, mağaza çalışanının kendisine {religion} olduğu için farklı davrandığını iddia ediyor. Görüşme kaydı incelenmeli. Müşteri tel: {phone_dashed}",
    "Rezervasyon {P} adına.\nPasaport No: {passport}\nDoğum tarihi: {dob}\nUçuş {date} {time}, bagaj hakkı 20 kg.",
    "Merhaba, {P.first} ben. Yeni adresim {addr_short}, kargoları oraya gönderebilir misiniz? Telefonum da değişti: {phone_parens}",
    "Hasar dosyası {order}\nSigortalı: {P}, {dob_words} doğumlu\nKazada yaralanan eşi {Q} hastanede {health} tanısıyla tedavi görüyor.\nÖdeme IBAN: {iban_compact}",
    "Kurumsal müşteri kaydı: {company}, MERSİS No: {mersis}, VKN {vkn}. Yetkili kişi {P}, KEP adresi {P.kep}.",
    "Sayın {P}, {date} tarihli talebiniz alınmıştır. Kart numaranız {card_dashed} ile yapılan {amount} tutarındaki işlem itiraz sürecine alındı. Bilgi için {rolemail}.",
    "Müşteri notu: {P.hitap} yaşlı ve {health} hastası, teslimatlarda zile basılmamasını istiyor. Yedek iletişim kişisi kızı {Q.first}, {phone_bare}.",
  ],
  hr: [
    "Personel: {P}\nSGK sicil no: {sgk}\nDoğum tarihi: {dob}\nAdres: {addr}\n\nÇalışan {date} itibarıyla {health} nedeniyle üç hafta raporlu.",
    "Mülakat notu: Aday {P}, {ethnic} kökenli olduğunu ve iki dil konuştuğunu söyledi. Referansı {Q}. İletişim: {P.email}, {phone}.",
    "{P:gen} disiplin dosyası: Çalışanın {criminal} bulunduğu ve işe girişte bunu beyan etmediği tespit edildi. Dosya hukuk birimine iletildi.",
    "Toplu sözleşme görüşmelerinde {P}, {union} olarak masada yer alacak. İK, {P.first:gen} izin günlerini buna göre planlayacak.",
    "Özel sağlık sigortası başvurusu: {P}. Başvuru formunda {genetic} bilgisi bulunduğundan form kapalı zarfta saklanacak. Maaş hesabı {iban}.",
    "Giriş kontrol sistemine {P:gen} {biometric} tanımlandı. Personel kart no {refno}, tanımlama tarihi {date}.",
    "Çalışan {P}, {political} olduğu gerekçesiyle ekip arkadaşlarının kendisini dışladığını bildirdi. Görüşme {date} tarihinde yapıldı; {Q} tanık olarak dinlenecek.",
    "Esnek çalışma talebi: {P.hitap}, {religion} inancı gereği bazı günlerde erken çıkmak istiyor. Yöneticisi {Q} onay verdi.",
    "Bordro düzeltmesi: TCKN {tc}, ad soyad {P}, SGK no: {sgk}, banka hesabı {iban}. Eksik ödenen fazla mesai {amount}.",
    "Çalışan destek programı: {P}, {health} tedavisi gördüğünü ve düzenli ilaç kullandığını paylaştı. Bilgi yalnızca İK müdürüyle paylaşılacak.",
    "Acil durum kişisi: {Q} ({phone_plus90}). Çalışan {P}, {dob_words} doğumlu, {addr_short} adresinde oturuyor.",
    "Şikayet incelemesi: {P}, yöneticisinin kendisinin {sexlife} olduğunu ekipte ifşa ettiğini belirtti. Yönetici {Q} ifadeye çağrıldı.",
  ],
  legal: [
    "DAVACI: {P} (T.C. Kimlik No: {tc})\nADRESİ: {addr}\nDAVALI: {company}\nKONU: İşe iade talebimizdir.\nAÇIKLAMALAR: Müvekkil, {union} olması nedeniyle iş akdinin feshedildiğini beyan etmektedir.",
    "Sanık {P}, {dob_words} doğumlu, {addr_short} adresinde ikamet etmektedir. Sanığın daha önce {criminal} bulunduğu adli sicil kaydından anlaşılmıştır.",
    "VEKALETNAME\nBen {P}, T.C. kimlik numaram {tc}, Av. {Q:acc} her türlü dava ve takipte vekil tayin ettim. Tel: {phone}",
    "Tanık {P} beyanında, olay günü davacı {Q:gen} {health} krizi geçirdiğini gördüğünü ifade etmiştir.",
    "Bilirkişi raporunda davalı {P:gen} {genetic} taşıdığı tespit edilmiş, rapor {date} tarihinde dosyaya sunulmuştur.",
    "Davalı eş {P:gen} [[evlilik dışı ilişkisi|sex_life]] olduğu, davacı {Q} tarafından sunulan mesaj kayıtlarıyla ileri sürülmektedir.",
    "İHTARNAME\nKeşideci: {company}, MERSİS No: {mersis}\nMuhatap: {P}, {addr}\nKonu: {amount} tutarındaki borcun ödenmesi.",
    "Sanık {P:gen} {political} olarak bilindiği, ancak bunun suç unsuru oluşturmadığı değerlendirilmiştir.",
    "İcra takibi: Borçlu {P}, TCKN {tc}, SSK sicil numarası {sgk}, borç miktarı {amount}, alacaklı hesabı {iban}. Tebligat {P.kep} adresine gönderilmiştir.",
    "Başvurucu {P}, {ethnic} kökenli olması ve {religion} inancı nedeniyle ayrımcılığa uğradığını ileri sürmektedir. Pasaport No: {passport}",
    "KVKK m.11 başvurusu: İlgili kişi {P}, {company} tarafından işlenen {biometric} verisinin silinmesini talep etmektedir. Yanıt {P.email} adresine iletilecektir.",
    "Tutanak: {date} günü saat {time} sularında {P} ile {Q} arasında tartışma çıkmış, {Q.first} hafif yaralanmıştır. Taraflardan {P.last}, {criminal} nedeniyle denetimli serbestlik altındadır.",
  ],
  chat: [
    "[{time}] {P.first}: tc'm {tc} bunu forma yaz\n[{time}] {Q.first}: tamam, iban da lazım\n[{time}] {P.first}: {iban}",
    "{P.first}: yarın gelemiyorum, {health} yüzünden doktora gideceğim\n{Q.first}: geçmiş olsun, haber ver",
    "{P.first}: {Q.first} {political}, biliyorsun, akşam siyaset konuşmayalım\n{Q.first}: 😂 tamam",
    "kanka numaram değişti {phone_bare} kaydet bunu\n— {P.first}",
    "{P.first}: kargo adresi {addr_short}\n{P.first}: zil çalışmıyor, gelince {phone} ara",
    "{P.first}: {Q.first:gen} {sexlife} olduğunu herkese söylemişler, çok üzüldü\n{Q.first}: kim söylemiş?",
    "{P.first}: {Q.first} artık {union}, toplantıya o da gelecek",
    "{P.first}: babam {criminal} yüzünden yine mahkemede, bugün işe gelemem",
    "{P.first}: genetik testin sonucu geldi, {genetic} çıktı 😕\n{Q.first}: doktor ne dedi?",
    "{P.first}: kartın son hali {card_plain} miydi?\n{Q.first}: evet, cvv'yi buraya yazma",
    "{P.first}: doğum tarihim {dob} yaz forma, soyadım {P.last}\n{Q.first}: ok",
    "{P.first}: e-postam {P.email}, dosyayı oradan at\n{P.first}: bir de {Q} seni arayacak, {religion} derneğinden",
  ],
};

/** No personal data, but the shapes detectors trip on: numbers, dates, Art. 6 words with no person. */
export const CLEAN_TEMPLATES: Record<Domain, string[]> = {
  support: [
    "Sipariş {order} kargoya verildi. Tahmini teslim {date}. Toplam tutar {amount}.",
    "Sürüm {version} yayınlandı: ödeme ekranında kart numarası alanı artık boşluklu girişi kabul ediyor.",
    "Fatura no {refno}, ürün kodu {product}. İade süresi teslimattan itibaren 14 gündür.",
    "Biyometrik giriş özelliği uygulamanın {version} sürümüyle geldi; parmak izi verisi cihazdan dışarı çıkmaz.",
    "Kampanya {date} tarihinde başlıyor, tüm siparişlerde %20 indirim. Sorularınız için çağrı merkezi: {callcenter}.",
    "Talep {ticket} çözüldü olarak kapatıldı. Ürün {product} stoklara {date} tarihinde yeniden girecek.",
  ],
  hr: [
    "Sendika üyeliği hakkında bilgilendirme toplantısı {date} saat {time}'da büyük salonda yapılacak.",
    "Sağlık sigortası poliçesi yenilendi; diyabet ve hipertansiyon gibi kronik hastalıklar teminat kapsamında.",
    "Yeni ofisimiz {company} binasının 4. katında. Ziyaretçi girişleri resepsiyondan yapılacak.",
    "Bordro dönemi {date} itibarıyla kapanacak. Sorular için {rolemail} adresine yazabilirsiniz.",
    "Çeşitlilik ve kapsayıcılık eğitimi: din, etnik köken veya cinsel yönelim temelli ayrımcılık disiplin suçudur.",
    "Yıllık izin planlaması {year} için başladı. Personel kart numaraları {refno} ile başlayan seriden verilecek.",
  ],
  legal: [
    "6698 sayılı Kanun'un 6. maddesi uyarınca sağlık, din, etnik köken ve biyometrik veriler özel nitelikli kişisel veridir.",
    "Yargıtay 9. Hukuk Dairesi'nin {year}/{casenum} E. sayılı kararında sendika üyeliği nedeniyle yapılan feshin geçersizliği tartışılmıştır.",
    "Sözleşme {date} tarihinde imzalanmış olup {amount} bedel üzerinden düzenlenmiştir. Dosya no {order}.",
    "Adli sicil kayıtlarının silinmesine ilişkin şartlar 5352 sayılı Adli Sicil Kanunu'nda düzenlenmiştir.",
    "Taraflar arasındaki uyuşmazlık {company} ile tedarikçi arasında akdedilen {date} tarihli çerçeve sözleşmeden kaynaklanmaktadır.",
    "Genetik verilerin işlenmesine ilişkin Kurul kararı {date} tarihinde Resmî Gazete'de yayımlanmıştır.",
  ],
  chat: [
    "toplantı {time}'da, link takvimde",
    "sürüm {version} çıktı mı? changelog'a baktın mı",
    "diyabet hakkında güzel bir belgesel izledim dün, tavsiye ederim",
    "seçim sonuçlarını izledin mi, sendikalar da açıklama yapmış",
    "sipariş no {order}, hâlâ gelmedi ya",
    "{product} stokta yokmuş, {date} gibi gelirmiş",
    "konser Atatürk Kültür Merkezi'nde, {time}'da başlıyor, Mimar Sinan'dan arkadaşlar da gelecek",
  ],
};
