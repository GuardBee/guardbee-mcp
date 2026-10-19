# Turkish PII detection benchmark

A reproducible benchmark for Turkish personal-data detection: how much of it `@guardbee/guard-core` finds, how often it flags something that is not personal data, and how long it takes. It is also how the NER backend for names and KVKK Art. 6 data (#126) gets chosen: every candidate runs on the same documents with the same metrics.

Not published to npm; it lives in the monorepo next to the detectors it measures.

```bash
pnpm bench                                   # from the repo root: builds guard-core, runs the default system
pnpm --filter @guardbee/pii-bench bench -- --system guard-core-regex --samples 1000
pnpm --filter @guardbee/pii-bench generate   # rebuild data/tr-pii-v1.jsonl from the templates
```

A run prints a markdown report and writes `results/<system>.json` and `results/<system>.md`.

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

### Limits

- Templates are the main limit: 48 PII and 25 clean templates give realistic but repetitive text. A detector tuned on this set will look better here than on real documents, so treat it as a regression and comparison set, not a field estimate.
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

False-alarm rate (clean documents with any detection): 8.1 (4.4–12.5)%. Latency per document: p50 0.027 ms, p95 0.048 ms (Node v23.11.0).

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

† Person names and KVKK Art. 6 special categories: guard-core has no regex detector for them.
<!-- /results -->

## Adding a system

Implement `System` in `src/systems.ts` (`detect(text)` returns `{ start, end, category }` spans, sync or async) and add it to `SYSTEMS`; category names are the ones in `src/categories.ts`. Planned: guard-core with the NER backend (#126), Microsoft Presidio with a Turkish configuration, and a cloud LLM prompt.
