### guard-core+ner+special

@guardbee/guard-core default detectors + @guardbee/ner default model + the KVKK Art. 6 term lists (preset KVKK_SENSITIVE's detectors). Dataset tr-special-challenge: 45 documents with personal data (79 labeled spans), 20 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 95.1 (90.5–98.7) | 100.0 (100.0–100.0) | 97.5 (95.0–99.4) | 93.7 (87.9–98.7) |
| **Identifiers** | – | – | – | – |

False-alarm rate (clean documents with any detection): 0.0 (0.0–0.0)%. Latency per document: p50 5.003 ms, p95 6.816 ms (Node v23.11.0).

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
| person_name † | 34 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| health † | 9 | 81.8 (63.6–100.0) | 100.0 (100.0–100.0) | 90.0 (77.8–100.0) | 100.0 (100.0–100.0) |
| religion_belief † | 5 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| ethnic_origin † | 5 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 80.0 (0.0–100.0) |
| political_opinion † | 4 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 75.0 (0.0–100.0) |
| union_membership † | 4 | 80.0 (50.0–100.0) | 100.0 (100.0–100.0) | 88.9 (66.7–100.0) | 50.0 (0.0–100.0) |
| criminal_record † | 5 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| sex_life † | 3 | 75.0 (50.0–100.0) | 100.0 (100.0–100.0) | 85.7 (66.7–100.0) | 66.7 (0.0–100.0) |
| biometric † | 4 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| genetic † | 6 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |

† No regex detector: person names come from the NER model, and the KVKK Art. 6 categories from guard-core's opt-in term lists, when the system has them.
