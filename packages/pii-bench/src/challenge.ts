/**
 * tr-names-challenge: hand-written sentences where telling a name from a word
 * is the hard part. Many Turkish given names and surnames are ordinary words
 * (Umut "hope", Barış "peace", Deniz "sea", Kaya "rock", Demir "iron"), chat
 * is often lower case, legal text upper case. The templated set cannot tell
 * NER models apart on names; this one is meant to.
 *
 * Markup: [[text|category]] is a label, as in the templates. Lines without
 * one go to the clean set. Same labeling rules (LABELING.md); public figures
 * are people too, so their names are labeled.
 */
export const CHALLENGE_LINES: string[] = [
  // Names that are words
  "[[Umut|person_name]] yarın erken gelecek, toplantıyı o açsın.",
  "[[Barış Demir|person_name]] dün akşam aradı, siparişi iptal etmek istiyor.",
  "Müşteri [[Deniz Kaya|person_name]], faturanın yanlış adrese gittiğini söyledi.",
  "[[Güneş|person_name]] Hanım bugün izinli, dosyayı [[Bahar|person_name]] Hanım'a bırakın.",
  "[[Ay Doğan|person_name]] ile [[Yaprak Çiçek|person_name]] aynı ekipte çalışıyor.",
  "Sınıf temsilcisi [[Mutlu Sever|person_name]] veli toplantısını erteledi.",
  "[[Savaş Yıldırım|person_name]] işe dönüş tarihini henüz bildirmedi.",
  "Dosyayı [[Irmak|person_name]] hazırladı, [[Ozan|person_name]] kontrol etti.",
  "Kargo [[Cem Şeker|person_name]] adına teslim alındı.",
  "[[Gül Kara|person_name]] ile [[Ateş Tan|person_name]] mülakata çağrılacak.",
  // Lower-case chat
  "[[ayşe|person_name]] gelmeyecekmiş, [[mehmet|person_name]] de geç kalırmış",
  "abi [[serkan|person_name]] aradı mı seni, dün bana ulaşamadı",
  "[[zeynep yıldız|person_name]] diye birini tanıyor musun, ik'dan arıyorlar",
  "[[burak|person_name]]'ın doğum günü cumartesi, hediye alalım mı",
  "yarın [[elif|person_name]]le sinemaya gidiyoruz",
  // Upper-case legal
  "DAVACI: [[AYŞE YILMAZ|person_name]]\nVEKİLİ: Av. [[MEHMET KARACA|person_name]]",
  "SANIK [[HÜSEYİN ÖZTÜRK|person_name]] HAKKINDA KAMU DAVASI AÇILMIŞTIR.",
  "TANIK [[FATMA ŞAHİN|person_name]] DUYURULU OLMASINA RAĞMEN DURUŞMAYA GELMEDİ.",
  // Inflected and possessive forms
  "[[Kemal|person_name]]'in raporu masada, [[Selin|person_name]]'e iletin.",
  "Bu karar [[Ahmet|person_name]] Bey'i doğrudan etkiliyor.",
  "[[Özlem Arslan|person_name]]'dan gelen e-postaya henüz cevap verilmedi.",
  // Foreign names
  "Toplantıya [[John Smith|person_name]] ve [[Maria Garcia|person_name]] da katılacak.",
  "Yeni müşteri [[Hans Müller|person_name]], sözleşmeyi Almanca istiyor.",
  // Public figures
  "[[Orhan Pamuk|person_name]]'un yeni romanı kitapçılarda.",
  "Konferansta [[Aziz Sancar|person_name]]'ın Nobel konuşmasından bir bölüm gösterildi.",
  // Names inside longer text with other entities
  "[[Hakan Çelik|person_name]], Ankara şubesinden İzmir'e tayin istedi; Ziraat Bankası'ndaki hesabı aynı kalacak.",
  "Garanti BBVA müşteri temsilcisi [[Seda|person_name]] bugün dönüş yapacak.",
  "Trendyol siparişini [[Onur Aksoy|person_name]] iade etti, Aras Kargo ile gönderilecek.",
  // Clean: the same words, no person
  "Barış görüşmeleri yarın Cenevre'de yeniden başlayacak.",
  "Deniz kenarında yürüyüş yapmak için hava çok güzel.",
  "Güneş açınca panellerin ürettiği enerji iki katına çıktı.",
  "Bahar aylarında satışlar genelde artar.",
  "Umut verici sonuçlar ilk çeyrekte geldi.",
  "Demir ve çelik fiyatları bu ay yüzde beş yükseldi.",
  "Kaya tuzu ile deniz tuzu arasındaki fark nedir?",
  "Ay sonunda bordrolar kapanacak, lütfen mesaileri girin.",
  "Savaş sonrası dönemde ekonomi hızla toparlandı.",
  "Irmak taşınca köprü geçici olarak kapatıldı.",
  "Atatürk Havalimanı yolunda trafik yoğun.",
  "Mimar Sinan Güzel Sanatlar Üniversitesi kayıtları başladı.",
  "Fatih Sultan Mehmet Köprüsü bakım nedeniyle bu gece tek şeritte hizmet verecek.",
  "Ankara, İzmir ve Bursa şubelerinde sistem güncellemesi yapılacak.",
  "Ziraat Bankası ile Garanti BBVA arasındaki EFT gecikmeli.",
  "Mutlu son için senaryo yeniden yazıldı.",
  "Çiçek siparişleri sevgililer gününde iki katına çıktı.",
  "yarın toplantı var mı, saat kaçta",
  "kargo hala gelmedi ya, iade edeceğim",
  "TOPLANTI TUTANAĞI: GÜNDEM MADDELERİ OYBİRLİĞİYLE KABUL EDİLDİ.",
];
