# Bypass suite: guard-core regex

Masked: **80 of 80** (5 identifiers × 16 forms). Clean strings changed: **0 of 16**.

| Form | Masked | Leaked |
|---|---|---|
| plain | 5/5 | – |
| base64 (value) | 5/5 | – |
| base64 (sentence) | 5/5 | – |
| base64url (JSON) | 5/5 | – |
| base64 of base64 | 5/5 | – |
| hex | 5/5 | – |
| URL encoding | 5/5 | – |
| URL encoding (punctuation) | 5/5 | – |
| HTML decimal entities | 5/5 | – |
| HTML hex entities | 5/5 | – |
| JSON \u escapes | 5/5 | – |
| fullwidth digits | 5/5 | – |
| Arabic-Indic digits | 5/5 | – |
| Devanagari digits | 5/5 | – |
| zero-width characters | 5/5 | – |
| separators / spelled out | 5/5 | – |
| reversed (out of scope) | 1/5 | tc_kimlik, iban, phone_tr, credit_card |

Changed clean strings: none.
Out of scope: reversed (a reversed value reads as noise to a model too); a value split across fields (not masked).
