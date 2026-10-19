# Turkish PII detection benchmark

A reproducible benchmark for Turkish personal-data detection: how much of it `@guardbee/guard-core` finds, how often it flags something that is not personal data, and how long it takes. It is also how the NER backend for names (`@guardbee/ner`, #126) was chosen: every candidate ran on the same documents with the same metrics (see [Choosing the NER model](#choosing-the-ner-model)).

Not published to npm; it lives in the monorepo next to the detectors it measures.

```bash
pnpm bench                                   # from the repo root: builds guard-core, runs the default system
pnpm --filter @guardbee/pii-bench bench -- --system guard-core-regex --samples 1000
pnpm --filter @guardbee/pii-bench generate   # rebuild data/tr-pii-v1.jsonl from the templates
```

A run prints a markdown report and writes `results/<system>.json` and `results/<system>.md`.

```bash
# guard-core + the NER backend (after `npx guardbee-ner download`)
pnpm --filter @guardbee/pii-bench bench -- --system guard-core+ner
pnpm --filter @guardbee/pii-bench bench -- --system guard-core+ner --dataset tr-names-challenge
# any token-classification model exported to ONNX
pnpm --filter @guardbee/pii-bench bench -- --model-dir ./models/my-ner --dataset tr-names-challenge
```

## Dataset: tr-pii-v1

`data/tr-pii-v1.jsonl`, one document per line: `{ id, domain, set, text, spans: [{ start, end, category }] }`. Offsets are UTF-16 code units (JavaScript string indices).

| | Documents | Domains |
|---|---|---|
| `pii` set | 400 | support tickets, HR notes, legal text, chat logs (100 each) |
| `clean` set | 160 | the same domains (40 each), no personal data |

- **22 categories:** 12 identifiers (TC Kimlik No, VKN, IBAN, card, e-mail, KEP, phone, passport, SGK, MERSİS, date of birth, address), person names, and the 9 KVKK Art. 6 special categories. See [LABELING.md](LABELING.md) for what each covers and where a span starts and ends.
- **Synthetic.** Documents are rendered from templates (`src/templates.ts`) with generated identities: random combinations of common Turkish names, numbers that pass their checksums, reserved or made-up e-mail domains. No real person's data is in it.
- **Labeled by construction.** The generator records each span where it writes the value, so offsets are exact; the generator is seeded, and a test checks the committed file is what it produces.
- **Hard cases on purpose:** phone numbers in parentheses or without a prefix, dates of birth in words, addresses inline in prose, uppercase Turkish labels (`ADRESİ:`), names with case suffixes. The clean set holds look-alikes: 11-digit order numbers that fail the TC checksum, a company's 0850 line, role mailboxes, and Art. 6 words with no person attached.

## Dataset: tr-names-challenge

`data/tr-names-challenge.jsonl`, 48 hand-written lines (`src/challenge.ts`), built because names in the templated set are easy for every model. 28 lines hold 36 names:

- names that are ordinary words: Umut, Barış, Deniz, Kaya, Güneş, Irmak, Savaş
- lower-case chat (`ayşe gelmeyecekmiş`)
- upper-case legal text (`DAVACI: AYŞE YILMAZ`)
- case suffixes, foreign names and public figures

The 20 clean lines use the same words with no person, and person names inside institution names (`Mimar Sinan Güzel Sanatlar Üniversitesi`). The labels are hand-placed, with the same rules as above. It is small, so its intervals are wide: it separates models that fail on these cases, not ones that are close.

### Limits

- Templates are the main limit: 48 PII and 26 clean templates give realistic but repetitive text. A detector tuned on this set will look better here than on real documents, so treat it as a regression and comparison set, not a field estimate.
- Labels have not had a second human review yet. The labeling rules are written down so they can.
- v1 is Turkish only, and covers no opt-in categories (IP, MAC, plates).

License: the dataset and code are MIT, like the rest of the repository.

## Metrics

- **Precision / recall / F1, per category and pooled (micro).** A detection matches a label when they overlap and have the same category. Detections outside the label set (guard-core's credential patterns) count against precision.
- **Fully masked:** the share of labels whose every character some detection covers, whatever its category. This is the privacy view: half a name or the last digits of an IBAN still identify someone.
- **False-alarm rate:** the share of clean documents with at least one detection.
- **Latency:** p50 / p95 milliseconds per document, after a warm-up pass.
- **95% intervals:** document-level bootstrap, 1000 resamples of the PII and clean sets (each to its own size), seeded so a rerun gives the same intervals.

"All categories" pools every category, including the ones a system has no detector for; "Identifiers" pools the 12 identifier categories, guard-core's regex scope.

## Results

<!-- results:guard-core-regex -->
### guard-core-regex

@guardbee/guard-core maskPiiInText, default detectors (regex + checksum validation). Dataset tr-pii-v1: 400 documents with personal data (1396 labeled spans), 160 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 92.8 (90.1–95.0) | 26.6 (23.7–29.5) | 41.4 (37.7–44.8) | 26.6 (23.7–29.5) |
| **Identifiers** | 92.8 (90.1–95.0) | 77.5 (73.2–81.7) | 84.4 (81.3–87.3) | 77.5 (73.2–81.7) |

False-alarm rate (clean documents with any detection): 8.1 (4.4–12.5)%. Latency per document: p50 0.027 ms, p95 0.047 ms (Node v23.11.0).

| Category | Labels | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|---|
| tc_kimlik | 60 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| vkn | 17 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| iban | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| credit_card | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| email | 43 | 74.1 (61.9–84.5) | 100.0 (100.0–100.0) | 85.1 (76.5–91.6) | 100.0 (100.0–100.0) |
| kep | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| phone_tr | 94 | 83.1 (75.3–90.9) | 73.4 (64.4–82.8) | 78.0 (71.1–84.5) | 73.4 (64.4–82.8) |
| passport | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| sgk_no | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| mersis | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| birth_date | 50 | 100.0 (100.0–100.0) | 34.0 (20.7–46.8) | 50.7 (34.3–63.8) | 34.0 (20.7–46.8) |
| address | 68 | 100.0 (100.0–100.0) | 26.5 (16.9–36.8) | 41.9 (28.9–53.8) | 26.5 (16.9–36.8) |
| person_name † | 650 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| health † | 60 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| religion_belief † | 32 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| ethnic_origin † | 17 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| political_opinion † | 25 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| union_membership † | 26 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| criminal_record † | 34 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| sex_life † | 24 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| biometric † | 24 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| genetic † | 24 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |

† No regex detector: person names come from the NER model when the system has one; the KVKK Art. 6 categories have no detector yet.
<!-- /results -->

<!-- results:guard-core+ner -->
### guard-core+ner

@guardbee/guard-core regex + @guardbee/ner default model (akdeniz27/bert-base-turkish-cased-ner, int8). Dataset tr-pii-v1: 400 documents with personal data (1396 labeled spans), 160 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 96.6 (95.4–97.6) | 73.2 (71.2–75.2) | 83.3 (81.9–84.6) | 73.2 (71.2–75.2) |
| **Identifiers** | 92.8 (90.1–95.0) | 77.5 (73.2–81.7) | 84.4 (81.3–87.3) | 77.5 (73.2–81.7) |

False-alarm rate (clean documents with any detection): 11.3 (6.9–16.3)%. Latency per document: p50 7.882 ms, p95 15.525 ms (Node v23.11.0).

| Category | Labels | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|---|
| tc_kimlik | 60 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| vkn | 17 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| iban | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| credit_card | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| email | 43 | 74.1 (61.9–84.5) | 100.0 (100.0–100.0) | 85.1 (76.5–91.6) | 100.0 (100.0–100.0) |
| kep | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| phone_tr | 94 | 83.1 (75.3–90.9) | 73.4 (64.4–82.8) | 78.0 (71.1–84.5) | 73.4 (64.4–82.8) |
| passport | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| sgk_no | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| mersis | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| birth_date | 50 | 100.0 (100.0–100.0) | 34.0 (20.7–46.8) | 50.7 (34.3–63.8) | 34.0 (20.7–46.8) |
| address | 68 | 100.0 (100.0–100.0) | 26.5 (16.9–36.8) | 41.9 (28.9–53.8) | 26.5 (16.9–36.8) |
| person_name † | 650 | 98.9 (98.1–99.6) | 100.0 (100.0–100.0) | 99.5 (99.0–99.8) | 100.0 (100.0–100.0) |
| health † | 60 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| religion_belief † | 32 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| ethnic_origin † | 17 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| political_opinion † | 25 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| union_membership † | 26 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| criminal_record † | 34 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| sex_life † | 24 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| biometric † | 24 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |
| genetic † | 24 | – | 0.0 (0.0–0.0) | – | 0.0 (0.0–0.0) |

† No regex detector: person names come from the NER model when the system has one; the KVKK Art. 6 categories have no detector yet.
<!-- /results -->

<!-- results:guard-core+ner.tr-names-challenge -->
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
<!-- /results -->

## Choosing the NER model

Five Turkish NER models on Hugging Face with a permissive license were exported to ONNX and run through guard-core's masking, the path the proxy takes (`--model-dir`). Full reports are in `results/candidates/`. The person-name results, with 95% intervals:

| Model | License | tr-pii-v1 F1 | tr-pii-v1 fully masked | tr-names-challenge F1 | Clean false alarms (v1 / challenge) |
|---|---|---|---|---|---|
| **akdeniz27/bert-base-turkish-cased-ner** (chosen, int8) | MIT | **99.5** (99.0–99.8) | **100.0** | **97.1** (91.8–100) | 11.3% / 0% |
| btniq/kvkk-ner-bert-turkish | MIT | 99.5 (99.1–99.8) | 99.8 | 98.6 (95.2–100) | 11.3% / 0% |
| akdeniz27/xlm-roberta-base-turkish-ner | MIT | 98.4 (97.5–99.1) | 97.5 | 91.4 (83.6–97.2) | 11.3% / 10% |
| savasy/bert-base-turkish-ner-cased | none stated | 90.8 (88.7–92.7) | 85.2 | 97.1 (92.3–100) | 15.0% / 0% |
| tugrulkaya/turkish-ner-bert | Apache-2.0 | 80.9 (77.8–83.7) | 66.5 | 95.8 (90.6–100) | 14.4% / 5% |

- **Two models are tied:** akdeniz27 BERTurk and btniq; their intervals overlap on both sets.
- **The tie-breaker is provenance.** akdeniz27 documents its training set (a reviewed Turkish news NER corpus) and per-year test results, and is widely used (72k downloads a month). btniq's card says neither what it was trained on nor how it was tested, and a model trained on synthetic KVKK text may score well here for the wrong reason.
- **int8 costs nothing.** The author's int8 build (`-quantized`) scores the same as the fp32 model to the first decimal: v1 F1 99.5, challenge F1 97.1. It is 186 MB instead of 421 MB, and about twice as fast: p50 8 ms instead of 18 ms per document on an M1 Max, single process.
- **Where the extra false alarms come from.** The clean-set rate rises from 8.1% (regex only) to 11.3% with any of the models. It comes from "Mimar Sinan" (an architect's name, read inside a university's name) in five clean documents.

## Adding a system

Implement `System` in `src/systems.ts` (`detect(text)` returns `{ start, end, category }` spans, sync or async) and add it to `SYSTEMS`; category names are the ones in `src/categories.ts`. A model that finds spans (`ModelDetector` from guard-core) goes through `withModel()`, so it is measured through guard-core's masking like in the proxy. Planned: Microsoft Presidio with a Turkish configuration, and a cloud LLM prompt.
