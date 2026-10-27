### guard-core+special

@guardbee/guard-core default detectors + the KVKK Art. 6 term lists (context: identifiers and person words, no names). Dataset tr-special-challenge: 45 documents with personal data (79 labeled spans), 20 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 96.6 (89.7–100.0) | 38.0 (27.3–48.8) | 54.5 (42.3–64.9) | 32.9 (22.7–43.8) |
| **Identifiers** | – | – | – | – |

False-alarm rate (clean documents with any detection): 0.0 (0.0–0.0)%. Latency per document: p50 0.071 ms, p95 0.095 ms (Node v23.11.0).

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
| person_name † | 34 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| health † | 9 | 100.0 (100.0–100.0) | 77.8 (42.9–100.0) | 87.5 (60.0–100.0) | 77.8 (42.9–100.0) |
| religion_belief † | 5 | 100.0 (100.0–100.0) | 80.0 (33.3–100.0) | 88.9 (57.1–100.0) | 80.0 (33.3–100.0) |
| ethnic_origin † | 5 | 100.0 (100.0–100.0) | 80.0 (0.0–100.0) | 88.9 (50.0–100.0) | 60.0 (0.0–100.0) |
| political_opinion † | 4 | 100.0 (100.0–100.0) | 75.0 (0.0–100.0) | 85.7 (50.0–100.0) | 50.0 (0.0–100.0) |
| union_membership † | 4 | 100.0 (100.0–100.0) | 50.0 (0.0–100.0) | 66.7 (33.3–100.0) | 25.0 (0.0–100.0) |
| criminal_record † | 5 | 100.0 (100.0–100.0) | 60.0 (0.0–100.0) | 75.0 (40.0–100.0) | 60.0 (0.0–100.0) |
| sex_life † | 3 | 50.0 (50.0–50.0) | 33.3 (0.0–100.0) | 40.0 (25.0–66.7) | 0.0 (0.0–0.0) |
| biometric † | 4 | 100.0 (100.0–100.0) | 50.0 (0.0–100.0) | 66.7 (33.3–100.0) | 50.0 (0.0–100.0) |
| genetic † | 6 | 100.0 (100.0–100.0) | 66.7 (0.0–100.0) | 80.0 (50.0–100.0) | 66.7 (0.0–100.0) |

† No regex detector: person names come from the NER model, and the KVKK Art. 6 categories from guard-core's opt-in term lists, when the system has them.
