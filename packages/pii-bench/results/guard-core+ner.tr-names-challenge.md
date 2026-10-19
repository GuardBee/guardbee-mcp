### guard-core+ner

@guardbee/guard-core regex + @guardbee/ner default model (akdeniz27/bert-base-turkish-cased-ner, int8). Dataset tr-names-challenge: 28 documents with personal data (36 labeled spans), 20 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 100.0 (100.0–100.0) | 94.4 (84.8–100.0) | 97.1 (91.8–100.0) | 94.4 (84.8–100.0) |
| **Identifiers** | – | – | – | – |

False-alarm rate (clean documents with any detection): 0.0 (0.0–0.0)%. Latency per document: p50 4.069 ms, p95 6.603 ms (Node v23.11.0).

| Category | Labels | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|---|
| tc_kimlik | 0 | – | – | – | – |
| vkn | 0 | – | – | – | – |
| iban | 0 | – | – | – | – |
| credit_card | 0 | – | – | – | – |
| email | 0 | – | – | – | – |
| kep | 0 | – | – | – | – |
| phone_tr | 0 | – | – | – | – |
| passport | 0 | – | – | – | – |
| sgk_no | 0 | – | – | – | – |
| mersis | 0 | – | – | – | – |
| birth_date | 0 | – | – | – | – |
| address | 0 | – | – | – | – |
| person_name † | 36 | 100.0 (100.0–100.0) | 94.4 (84.8–100.0) | 97.1 (91.8–100.0) | 94.4 (84.8–100.0) |
| health † | 0 | – | – | – | – |
| religion_belief † | 0 | – | – | – | – |
| ethnic_origin † | 0 | – | – | – | – |
| political_opinion † | 0 | – | – | – | – |
| union_membership † | 0 | – | – | – | – |
| criminal_record † | 0 | – | – | – | – |
| sex_life † | 0 | – | – | – | – |
| biometric † | 0 | – | – | – | – |
| genetic † | 0 | – | – | – | – |

† No regex detector: person names come from the NER model when the system has one; the KVKK Art. 6 categories have no detector yet.
