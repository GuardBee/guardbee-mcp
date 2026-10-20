/**
 * tr-special-challenge: hand-written sentences for the KVKK Art. 6 special
 * categories, worded apart from the templates' phrase lists so a term list
 * tuned on tr-pii-v1 cannot score well here by having seen them. Inflected
 * forms, chat, English, people referred to without a name ("hastanın",
 * "babam"), and the hard negatives: the same words with no person behind them,
 * and given names that are also religious or ethnic words.
 *
 * Markup and labeling rules as in challenge.ts and LABELING.md: a special
 * category is labeled only when tied to an identifiable person; names are
 * labeled too. Lines without a label go to the clean set.
 */
export const SPECIAL_CHALLENGE_LINES: string[] = [
  // Health
  "[[Nermin Aydın|person_name]] geçen ay [[pankreas kanseri|health]] teşhisi aldı, kemoterapiye başlıyor.",
  "Hastanın [[hipertansiyonu|health]] var, [[insülin|health]] kullanıyor; kontrolü 3 ay sonra.",
  "[[Okan|person_name]] Bey'in [[alzheimer|health]] başlangıcı olduğu için imza yetkisi gözden geçirilecek.",
  "dün [[migren|health]] krizim tuttu, bugün de gelemiyorum",
  "Employee [[Laura Chen|person_name]] disclosed a [[bipolar disorder|health]] diagnosis to HR.",
  "Çalışanın [[HIV pozitif|health]] olduğu bilgisi yalnızca işyeri hekiminde kalmalı.",
  "[[Tuncay Erdem|person_name]]'in [[kalp krizi|health]] geçirdiği ve bypass olduğu öğrenildi.",
  "Öğrenci [[Ece|person_name]]'nin [[DEHB|health]] tanısı nedeniyle sınavda ek süre verilecek.",
  // Religion and belief
  "[[Mihail Dimitriadis|person_name]] [[Ortodoks|religion_belief]] olduğu için Paskalya'da izin istiyor.",
  "Başvurucu [[ateist|religion_belief]] olduğunu ve din dersinden muaf tutulmak istediğini belirtti.",
  "[[Leyla|person_name]] Hanım [[Cemevi'ne|religion_belief]] gittiği için cuma günleri erken çıkıyor.",
  "babam [[namaz kıldığı|religion_belief]] için toplantıyı 13.30'a alalım",
  "The applicant, [[Daniel Cohen|person_name]], keeps [[kosher|religion_belief]] and asked for a separate meal.",
  // Ethnic origin
  "[[Aram Bedrosyan|person_name]] [[Ermeni asıllı|ethnic_origin]] olduğunu, bu yüzden terfi alamadığını söylüyor.",
  "Müşteri [[Çingene|ethnic_origin]] olduğu gerekçesiyle mağazaya alınmadığını iddia etti.",
  "[[Zelal|person_name]]'in annesi [[Zaza|ethnic_origin]], babası [[Kürt|ethnic_origin]].",
  "Personel dosyasında [[Suriyeli Türkmen|ethnic_origin]] kökenli olduğu not edilmiş: [[Ahmet Halil|person_name]].",
  // Political opinion
  "[[Cengiz Aksoy|person_name]] geçen seçimde belediye meclis üyeliğine [[aday olmuştu|political_opinion]], sosyal medyada paylaşılmasın.",
  "Çalışan [[Gökhan|person_name]]'ın [[komünist|political_opinion]] görüşleri yüzünden ekipte gerginlik var.",
  "[[Rana Tekin|person_name]] [[parti il başkan yardımcısı|political_opinion]] olarak görev yapıyor.",
  "eşim [[mitinge|political_opinion]] katıldı diye işten uyarı aldı",
  // Union membership
  "[[Hasan Polat|person_name]] [[sendikaya üye olduktan|union_membership]] iki hafta sonra işten çıkarıldı.",
  "[[Derya|person_name]] Hanım'ın [[sendika aidatı|union_membership]] maaşından kesiliyor.",
  "Union steward [[Mark Evans|person_name]] is a [[member of Unite|union_membership]].",
  "Çalışan [[işyeri sendika temsilcisi|union_membership]] seçildi, adı [[Kerem Aslan|person_name]].",
  // Criminal record
  "[[Volkan Uçar|person_name]]'ın [[adli sicil kaydında|criminal_record]] karşılıksız çek var.",
  "Aday [[Serdar|person_name]], [[hapis yattığını|criminal_record]] mülakatta kendisi söyledi.",
  "Sanığın daha önce iki kez [[hırsızlıktan hüküm giydiği|criminal_record]] anlaşılmıştır.",
  "[[Melike Aras|person_name]] hakkında [[denetimli serbestlik|criminal_record]] kararı devam ediyor.",
  "The candidate, [[Tom Baker|person_name]], has a [[prior conviction|criminal_record]] for fraud.",
  // Sex life
  "[[Kaan|person_name]] iş arkadaşlarına [[gey|sex_life]] olduğunu açıklamış, bu bilgi dosyaya girmesin.",
  "Danışan, eşcinsel bireylere yönelik ayrımcılığı anlatırken kendisinin de [[eşcinsel bir ilişki|sex_life]] yaşadığını söyledi.",
  "[[Pınar Sezer|person_name]]'in [[lezbiyen|sex_life]] olduğu söylentisi yayılmış.",
  // Biometric
  "[[Oya Kurt|person_name]]'un [[yüz geometrisi verisi|biometric]] turnike sistemine kaydedildi.",
  "Çalışanın [[parmak izi şablonu|biometric]] işten ayrılınca silinmedi.",
  "Personel [[Sinan|person_name]] Bey'in [[iris taraması|biometric]] giriş sistemi için alındı.",
  "[[Fiona Walsh|person_name]]'s [[voiceprint|biometric]] was enrolled for phone banking.",
  // Genetic
  "[[Begüm Ilgaz|person_name]] [[BRCA2 taşıyıcısı|genetic]] çıktı, kız kardeşine de test öneriliyor.",
  "Hastanın [[DNA testi|genetic]] sonucunda [[Down sendromu|genetic]] riski yüksek bulundu.",
  "[[Halil|person_name]]'in [[orak hücre taşıyıcısı|genetic]] olduğu sigorta şirketine bildirilmemeli.",
  "[[Neslihan|person_name]] Hanım'ın [[genetik testinde|genetic]] [[APOE4|genetic]] varyantı bulundu.",

  // Hard negatives: the words, with no person behind them
  "Diyabet hastaları için beslenme rehberi güncellendi.",
  "Kanser taramaları 40 yaş üstü için ücretsiz.",
  "Sendika üyeliği hakkında bilgilendirme toplantısı cuma günü yapılacak.",
  "KVKK 6. madde uyarınca sağlık verisi özel nitelikli kişisel veridir.",
  "Parmak izi okuyuculu turnikelerin teklifini satın alma birimine iletin.",
  "Ses izi doğrulaması 2027 başında kullanıma açılacak.",
  "Alevi kültürü üzerine panel Kadıköy'de düzenlenecek.",
  "Ermeni mimarisi sergisi ziyaretçilere açıldı.",
  "Seçim sonuçları gece yarısından sonra açıklanacak.",
  "Adli sicil kaydı belgesi e-Devlet'ten alınabilir.",
  "Genetik test fiyatları geçen yıla göre arttı.",
  "Depresyon belirtileri ve tedavi seçenekleri broşürü hazırlandı.",
  "Roman dilinde yazılmış bir roman ödül aldı.",
  "Laz böreği tarifi menüye eklendi.",
  "Covid-19 aşı kampanyası nisanda sona erdi.",
  "Yeni sendika yasası mecliste görüşülüyor.",
  "Tip 1 ve tip 2 diyabet arasındaki farklar eğitimde anlatılacak.",
  "HIV testleri anonim olarak yapılmaktadır.",
  "Eşcinsel evlilik konusundaki anket sonuçları yayımlandı.",
  "DNA dizileme cihazının bakım sözleşmesi yenilenecek.",
  // Names that are also religious or ethnic words
  "[[Ramazan Yılmaz|person_name]] faturayı ödedi, makbuzu gönderelim.",
  "[[İslam Çelik|person_name]] yarın depoya uğrayacak.",
  "[[Kürşat|person_name]] Bey toplantıya gelemeyecek.",
  "[[Hristo Petrov|person_name]] siparişini iptal etti.",
];
