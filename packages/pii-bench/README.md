# Turkish PII detection benchmark

A reproducible benchmark for Turkish personal-data detection: how much of it `@guardbee/guard-core` finds, how often it flags something that is not personal data, and how long it takes. It is also how the NER backend for names (`@guardbee/ner`, #126) was chosen: every candidate ran on the same documents with the same metrics (see [Choosing the NER model](#choosing-the-ner-model)).

Not published to npm; it lives in the monorepo next to the detectors it measures.

```bash
pnpm bench                                   # from the repo root: builds guard-core, runs the default system
pnpm --filter @guardbee/pii-bench bench -- --system guard-core-regex --samples 1000
pnpm --filter @guardbee/pii-bench generate   # rebuild data/tr-pii-v1.jsonl from the templates
pnpm --filter @guardbee/pii-bench bypass     # encoded and disguised identifiers (see Bypass suite)
```

A run prints a markdown report and writes `results/<system>.json` and `results/<system>.md`.

```bash
# guard-core + the NER backend (after `npx guardbee-ner download`)
pnpm --filter @guardbee/pii-bench bench -- --system guard-core+ner
pnpm --filter @guardbee/pii-bench bench -- --system guard-core+ner --dataset tr-names-challenge
# any token-classification model exported to ONNX
pnpm --filter @guardbee/pii-bench bench -- --model-dir ./models/my-ner --dataset tr-names-challenge
# the KVKK Art. 6 term lists (preset KVKK_SENSITIVE), with and without the name model
pnpm --filter @guardbee/pii-bench bench -- --system guard-core+ner+special --dataset tr-special-challenge
pnpm --filter @guardbee/pii-bench bench -- --system guard-core+special
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

## Dataset: tr-special-challenge

`data/tr-special-challenge.jsonl`, 65 hand-written lines (`src/special-challenge.ts`) for the KVKK Art. 6 categories, written before guard-core's term lists and worded apart from the templates' phrases. 41 lines hold 45 special-category labels (3–9 per category), next to 34 names:

- inflected forms and phrases not in the templates (`pankreas kanseri`, `Cemevi'ne`, `sendikaya üye olduktan`)
- people with no name: `hastanın`, `babam`, the speaker of a chat line
- English (`prior conviction`, `voiceprint`)

The 20 clean lines are the hard negatives: the same words with no person behind them (`Diyabet hastaları için beslenme rehberi`, `Ermeni mimarisi sergisi`), and four lines whose only personal data is a name that is also a religious or ethnic word (Ramazan, İslam, Kürşat, Hristo).

### Limits

- Templates are the main limit: 48 PII and 26 clean templates give realistic but repetitive text. A detector tuned on this set will look better here than on real documents, so treat it as a regression and comparison set, not a field estimate.
- **The identifier numbers are no longer blind.** guard-core's phone, date-of-birth and address detectors were extended after reading this set's misses: phones in parentheses or bare after `numaram`, dates in words or before `doğumlu`, addresses with no label. Identifier F1 went from 84.4 to 97.1 here, and recall on the three categories from 73 / 34 / 27% to 100%. The clean-set false-alarm rate stayed at 8.1%. The same templates now overstate those detectors. guard-core's `identifier-forms.test.ts` checks forms the templates do not use, but real text will still be lower.
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
| **All categories** | 94.3 (92.2–96.0) | 34.4 (31.7–37.2) | 50.4 (47.4–53.4) | 34.4 (31.7–37.2) |
| **Identifiers** | 94.3 (92.2–96.0) | 100.0 (100.0–100.0) | 97.1 (95.9–98.0) | 100.0 (100.0–100.0) |

False-alarm rate (clean documents with any detection): 8.1 (4.4–12.5)%. Latency per document: p50 0.037 ms, p95 0.071 ms (Node v23.11.0).

| Category | Labels | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|---|
| tc_kimlik | 60 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| vkn | 17 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| iban | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| credit_card | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| email | 43 | 74.1 (61.9–84.5) | 100.0 (100.0–100.0) | 85.1 (76.5–91.6) | 100.0 (100.0–100.0) |
| kep | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| phone_tr | 94 | 87.0 (80.9–93.0) | 100.0 (100.0–100.0) | 93.1 (89.4–96.4) | 100.0 (100.0–100.0) |
| passport | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| sgk_no | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| mersis | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| birth_date | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| address | 68 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
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

† No regex detector: person names come from the NER model, and the KVKK Art. 6 categories from guard-core's opt-in term lists, when the system has them.
<!-- /results -->

<!-- results:guard-core+ner -->
### guard-core+ner

@guardbee/guard-core regex + @guardbee/ner default model (akdeniz27/bert-base-turkish-cased-ner, int8). Dataset tr-pii-v1: 400 documents with personal data (1396 labeled spans), 160 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 96.9 (95.8–97.8) | 80.9 (79.4–82.5) | 88.2 (87.2–89.2) | 80.9 (79.4–82.5) |
| **Identifiers** | 94.3 (92.2–96.0) | 100.0 (100.0–100.0) | 97.1 (95.9–98.0) | 100.0 (100.0–100.0) |

False-alarm rate (clean documents with any detection): 11.3 (6.9–16.3)%. Latency per document: p50 7.910 ms, p95 15.195 ms (Node v23.11.0).

| Category | Labels | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|---|
| tc_kimlik | 60 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| vkn | 17 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| iban | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| credit_card | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| email | 43 | 74.1 (61.9–84.5) | 100.0 (100.0–100.0) | 85.1 (76.5–91.6) | 100.0 (100.0–100.0) |
| kep | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| phone_tr | 94 | 87.0 (80.9–93.0) | 100.0 (100.0–100.0) | 93.1 (89.4–96.4) | 100.0 (100.0–100.0) |
| passport | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| sgk_no | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| mersis | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| birth_date | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| address | 68 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
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

† No regex detector: person names come from the NER model, and the KVKK Art. 6 categories from guard-core's opt-in term lists, when the system has them.
<!-- /results -->

<!-- results:guard-core+ner.tr-names-challenge -->
### guard-core+ner

@guardbee/guard-core regex + @guardbee/ner default model (akdeniz27/bert-base-turkish-cased-ner, int8). Dataset tr-names-challenge: 28 documents with personal data (36 labeled spans), 20 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 100.0 (100.0–100.0) | 94.4 (84.8–100.0) | 97.1 (91.8–100.0) | 94.4 (84.8–100.0) |
| **Identifiers** | – | – | – | – |

False-alarm rate (clean documents with any detection): 0.0 (0.0–0.0)%. Latency per document: p50 4.118 ms, p95 6.458 ms (Node v23.11.0).

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

† No regex detector: person names come from the NER model, and the KVKK Art. 6 categories from guard-core's opt-in term lists, when the system has them.
<!-- /results -->

<!-- results:guard-core+ner+special -->
### guard-core+ner+special

@guardbee/guard-core default detectors + @guardbee/ner default model + the KVKK Art. 6 term lists (preset KVKK_SENSITIVE's detectors). Dataset tr-pii-v1: 400 documents with personal data (1396 labeled spans), 160 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 97.1 (96.2–97.9) | 100.0 (100.0–100.0) | 98.5 (98.1–98.9) | 99.7 (99.4–99.9) |
| **Identifiers** | 94.3 (92.2–96.0) | 100.0 (100.0–100.0) | 97.1 (95.9–98.0) | 100.0 (100.0–100.0) |

False-alarm rate (clean documents with any detection): 11.3 (6.9–16.3)%. Latency per document: p50 8.054 ms, p95 15.235 ms (Node v23.11.0).

| Category | Labels | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|---|
| tc_kimlik | 60 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| vkn | 17 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| iban | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| credit_card | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| email | 43 | 74.1 (61.9–84.5) | 100.0 (100.0–100.0) | 85.1 (76.5–91.6) | 100.0 (100.0–100.0) |
| kep | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| phone_tr | 94 | 87.0 (80.9–93.0) | 100.0 (100.0–100.0) | 93.1 (89.4–96.4) | 100.0 (100.0–100.0) |
| passport | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| sgk_no | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| mersis | 16 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| birth_date | 50 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| address | 68 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| person_name † | 650 | 99.2 (98.5–99.8) | 100.0 (100.0–100.0) | 99.6 (99.2–99.9) | 100.0 (100.0–100.0) |
| health † | 60 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| religion_belief † | 32 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| ethnic_origin † | 17 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| political_opinion † | 25 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| union_membership † | 26 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| criminal_record † | 34 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| sex_life † | 24 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) |
| biometric † | 24 | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 100.0 (100.0–100.0) | 83.3 (66.7–96.3) |
| genetic † | 24 | 75.0 (65.0–87.5) | 100.0 (100.0–100.0) | 85.7 (78.8–93.3) | 100.0 (100.0–100.0) |

† No regex detector: person names come from the NER model, and the KVKK Art. 6 categories from guard-core's opt-in term lists, when the system has them.
<!-- /results -->

<!-- results:guard-core+ner+special.tr-special-challenge -->
### guard-core+ner+special

@guardbee/guard-core default detectors + @guardbee/ner default model + the KVKK Art. 6 term lists (preset KVKK_SENSITIVE's detectors). Dataset tr-special-challenge: 45 documents with personal data (79 labeled spans), 20 without. Percentages with 95% bootstrap intervals (1000 document-level resamples).

| | Precision | Recall | F1 | Fully masked |
|---|---|---|---|---|
| **All categories** | 95.1 (90.5–98.7) | 100.0 (100.0–100.0) | 97.5 (95.0–99.4) | 93.7 (87.9–98.7) |
| **Identifiers** | – | – | – | – |

False-alarm rate (clean documents with any detection): 0.0 (0.0–0.0)%. Latency per document: p50 4.677 ms, p95 6.585 ms (Node v23.11.0).

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
<!-- /results -->

## Bypass suite

The datasets measure text as people write it. The bypass suite (`src/bypass.ts`) measures text written to slip past a regex, or that a tool returns encoded: each of five identifiers (TC Kimlik, IBAN, e-mail, phone, card) in 16 forms — base64 (a value, a sentence, nested twice), base64url JSON, hex, URL escapes, HTML entities, JSON `\u` escapes, fullwidth, Arabic-Indic and Devanagari digits, zero-width characters, separators and spelled-out e-mail. A case leaks when its encoded form is still in the masked output. 16 clean strings that look encoded (hashes, a PNG, ids, encoded prose, percentages, escapes of ordinary text) must come out unchanged.

```bash
pnpm --filter @guardbee/pii-bench bypass   # writes results/bypass.md and the block below
```

Before #166 guard-core masked 23 of the 80: the plain forms, fullwidth digits (NFKC), zero-width characters, the dashed IBAN and card, and the cases a form leaves readable (an e-mail has no digits to swap; URL-escaping punctuation leaves a number as it was). guard-core regex now:

<!-- results:bypass -->
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
<!-- /results -->

How it works: character escapes and other scripts' digits are decoded in the normalized copy detection runs on, so a masked value maps back onto exactly the characters it was written with. A base64 or hex run that decodes to readable text is masked as text and encoded again in the same form (padding and alphabet kept), so a tool that expects base64 back still gets base64; binary runs are left alone. Names inside an encoded run are not found: the NER model sees the text as sent.

## KVKK Art. 6 term lists

guard-core finds the nine special categories with a term list per category and a context rule (`packages/guard-core/src/special.ts`): a term is masked only when the text is about a person — a name the NER model found, a personal identifier, or a word that points at someone. They are opt-in (preset `KVKK_SENSITIVE`). F1 per category, with 95% intervals in the reports above and in `results/`:

| Category | tr-pii-v1, with NER | tr-special-challenge, with NER | tr-special-challenge, no NER |
|---|---|---|---|
| health | 100 | 90.0 | 87.5 |
| religion / belief | 100 | 100 | 88.9 |
| ethnic origin | 100 | 100 | 88.9 |
| political opinion | 100 | 100 | 85.7 |
| union membership | 100 | 88.9 | 66.7 |
| criminal record | 100 | 100 | 75.0 |
| sex life | 100 | 85.7 | 40.0 |
| biometric | 100 | 100 | 66.7 |
| genetic | 85.7 | 100 | 80.0 |
| clean false alarms | 11.3% (same as NER alone) | 0% | 0% |

- **Run it with the name model.** Without names the context rule only has identifiers and role words to go on, and recall drops: many sentences are about a person only through their name.
- **The challenge set is no longer blind.** It was written before the term lists, but its errors were then read and fixed (upper-case `HIV` becoming `hıv` under Turkish lower-casing, `sanığın`, phrases like `tip 2 diyabet`). The tr-pii-v1 numbers are higher still because the lists were written by the same author as the templates. Expect lower numbers on real text, mostly from terms that are not on the lists.
- **The bias is conservative.** Once a text is about someone, every listed term in it is masked. The term lists add no false alarm on either clean set; on tr-special-challenge the one extra find is `eşcinsel` in `eşcinsel bireylere yönelik ayrımcılığı` (a group), in a line that is also about the speaker.
- **Latency:** under 0.15 ms per document on top of the regex detectors; the NER model dominates (p50 8 ms).

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
