---
"@guardbee/guard-core": minor
---

Find more Turkish phone numbers, dates of birth and addresses. These were the gaps pii-bench found.

- `phone_tr`: an area code in parentheses (`(0532) 123 45 67`, `0 (212) …`) is now found. A bare 10-digit mobile number (`5321234567`) counts only shortly after a word that says it is a phone number (`numaram`, `tel`, `cep`, `iletişim`, `whatsapp`), so `build 5321234567` is still left alone.
- `birth_date`: new label forms (`doğum tarihim`, upper-case `DOĞUM TARİHİ`, `born on`), month names in Turkish and English (`3 Mart 1979`), and a date right before `doğumlu` with no label (`12 Şubat 1985 doğumlu`).
- `address`: a street address with no label in the standard form `<…> Mah. <…> Cad./Sok./Blv. No:<n>`, with optional flat and district/city. Upper-case `ADRESİ:` labels now count too.
- On tr-pii-v1, identifier F1 goes from 84.4 to 97.1, with no new false alarms on the clean set. Those fixes were tuned on that set, so expect less on real text.
