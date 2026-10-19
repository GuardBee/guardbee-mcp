# Labeling guide (tr-pii-v1)

What gets a label, where the span starts and ends, and what is left unlabeled on purpose. The generator applies these rules by construction (`src/templates.ts`); a reviewer checking the data, or labeling new documents by hand, uses the same rules.

## General rules

- **A span is the value, not its label.** In `TCKN: 46337722734` the span is `46337722734`; in `Adres: Gazi Mah. Lale Sok. No:5 Konak/İzmir` it is everything after `Adres: `.
- **Spans do not overlap.** A value is labeled once, with its most specific category: `ayse.yilmaz@hs01.kep.tr` is `kep`, not `email`.
- **Personal data only.** A value is labeled when it identifies, or is about, a natural person. Company numbers that are not personal data stay unlabeled (see below).
- **Synthetic only.** Every identity is generated: random combinations of common names, numbers with valid checksums, reserved or made-up e-mail domains. Never add a real person's data.

## Identifier categories

| Category | Labeled | Not labeled |
|---|---|---|
| `tc_kimlik` | an 11-digit T.C. Kimlik No (valid checksum), with or without a label | an 11-digit order or file number that fails the checksum |
| `vkn` | a 10-digit tax number with a valid check digit | |
| `iban` | a TR IBAN, grouped or compact | |
| `credit_card` | a card number (Luhn-valid), spaced, dashed or plain | |
| `email` | a personal mailbox (`ayse.yilmaz@…`, `ayilmaz@…`) | a department or role mailbox (`ik@`, `destek@`, `info@`, `bordro@`) |
| `kep` | a registered e-mail (KEP) address | |
| `phone_tr` | a person's phone number in any format: `0532 123 45 67`, `+90 532 …`, `0532-123-4567`, `(0532) 123 45 67`, `5321234567` | a company's `0850` call-centre line |
| `passport` | a passport number | |
| `sgk_no` | an SGK / SSK registration number | |
| `mersis` | a MERSİS number (a company's, but labeled: guard-core treats it as an identifier) | |
| `birth_date` | a date of birth in any format: `12.05.1990`, `1990-05-12`, `12 Mayıs 1990` | any other date (a signing date, a delivery date) |
| `address` | a street address, with or without district and city, labeled or inline in prose | a company's building name |

## Person names (`person_name`)

- The first name and surname as written: `Ayşe Yılmaz`, or `Ayşe` / `Yılmaz` alone.
- **Excluded:** case suffixes (`Ayşe Yılmaz'ın` → `Ayşe Yılmaz`) and titles (`Ayşe Hanım`, `Mehmet Bey`, `Av.` → only the name).
- Speaker names in chat logs (`Ayşe: yarın gelemiyorum`) are names.
- **Not labeled:** names inside institution or place names (`Atatürk Kültür Merkezi`), company names.

## KVKK Art. 6 special categories

Labeled **only when tied to an identifiable person** — a named person, the speaker, or someone identified through them ("babam" in a named speaker's message). The same words in a general statement ("diyabet hastaları için rehber", "sendika üyeliği hakkında toplantı", "6. madde uyarınca sağlık verisi") are not labeled: they are what the clean set tests.

The span is the shortest phrase that states the sensitive fact, without connecting words (`tanısı`, `nedeniyle`, `olduğunu`):

| Category | KVKK Art. 6 | Example span |
|---|---|---|
| `health` | sağlık | `tip 2 diyabet`, `majör depresyon` |
| `religion_belief` | din, mezhep, diğer inançlar, felsefi inanç | `Alevi`, `Yehova Şahidi` |
| `ethnic_origin` | ırk, etnik köken | `Kürt` (in `Kürt kökenli`) |
| `political_opinion` | siyasi düşünce | `muhalefet partisinin ilçe yöneticisi` |
| `union_membership` | dernek, vakıf, sendika üyeliği | `metal işçileri sendikası üyesi` |
| `criminal_record` | ceza mahkûmiyeti, güvenlik tedbirleri | `dolandırıcılık suçundan mahkûmiyeti` |
| `sex_life` | cinsel hayat | `eşcinsel`, `evlilik dışı ilişkisi` |
| `biometric` | biyometrik veri | `parmak izi`, `yüz tanıma şablonu` |
| `genetic` | genetik veri | `BRCA1 mutasyonu` |

Not labeled separately: *kılık ve kıyafet* (dress), which Art. 6 also lists.

## Clean set

Documents with no personal data at all. They hold what detectors trip on: order numbers that look like a TC Kimlik No, invoice numbers, dates, versions, product codes, call-centre numbers, role mailboxes, and Art. 6 words with no person. Any detection in a clean document counts toward the false-alarm rate.
