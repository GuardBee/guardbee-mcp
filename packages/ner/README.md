# @guardbee/ner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

Finds Turkish person names, which no regex can, so GuardBee can mask them next to TC Kimlik numbers, IBANs and e-mail addresses. A local BERTurk NER model runs on CPU with ONNX Runtime: offline, on-prem, and nothing leaves the host.

It is optional. GuardBee's regex detectors need none of this. Add it where names matter: support tickets, HR notes, legal text, chat logs.

## Install

```bash
npm install @guardbee/ner
npx guardbee-ner download        # the pinned model, ~186 MB, checked against its SHA-256 hashes
```

The model goes to `~/.cache/guardbee/ner`, or to `GUARDBEE_NER_CACHE` if set, or to `--dir <path>`. For an offline host, run `download` where there is network, copy the directory over, and point `--dir` (or `GUARDBEE_NER_CACHE`) at it. `guardbee-ner verify --dir <path>` checks a copied directory.

## Use

**In process:**

```ts
import { NerModel } from "@guardbee/ner";
import { maskPiiInText } from "@guardbee/guard-core";

const ner = await NerModel.load(); // throws if the model files are missing or altered
const text = "Müşteri Ayşe Yılmaz'ın TC'si 10000000146";
const [found] = await ner.detect([text]);
maskPiiInText(text, undefined, undefined, undefined, () => found);
// → "Müşteri [KİŞİ]'ın TC'si [TC-KİMLİK]"
```

**As a sidecar,** when the process that masks should not load a native module or a 186 MB model:

```bash
GUARDBEE_NER_TOKEN=change-me npx guardbee-ner serve --port 8765   # binds 127.0.0.1 by default
curl -s localhost:8765/v1/detect -H 'authorization: Bearer change-me' \
  -d '{"texts":["DAVACI: AYŞE YILMAZ"]}'
# {"spans":[[{"start":8,"end":19,"detector":"person_name"}]]}
```

- `GET /healthz` answers once the model is loaded.
- Texts are never logged. An error reports its class, never the text.

**From the command line:** `npx guardbee-ner detect "Av. Mehmet Karaca dosyayı aldı"`.

## The model

[akdeniz27/bert-base-turkish-cased-ner](https://huggingface.co/akdeniz27/bert-base-turkish-cased-ner) (MIT), in the author's int8 build, pinned to one revision. It is BERTurk, fine-tuned on a reviewed Turkish news NER corpus.

It was picked out of five Turkish NER models on the [pii-bench](../pii-bench/README.md#choosing-the-ner-model) numbers:

| | Score |
|---|---|
| Person-name F1, templated set | 99.5 (99.0–99.8) |
| Person-name F1, hand-written hard-names set | 97.1 (91.8–100) |
| Latency per document | p50 8 ms, p95 15 ms (M1 Max, one process) |

- A text longer than the model's 512-token window runs in overlapping windows.
- A name spans the given name and surname as written. Titles (Hanım, Bey, Av.) and case suffixes (`'ın`) stay outside it.

## Failure behavior

- `NerModel.load()` throws when a file is missing or does not match its pinned hash. It never loads a model it cannot vouch for.
- A detection error rejects the promise.
- A caller that masks must treat both as "do not send": GuardBee's masking fails closed. An unscanned text is never passed as clean.

## Limits

- **Names only.** Locations and organizations are not masked. KVKK Art. 6 special categories (health, religion, …) are not covered yet.
- **Words that are also names.** A capitalized one that opens a sentence (Barış, Umut, Deniz) can go either way. It missed "Umut" opening a line in the hard-names set, and has read "Barış" opening a sentence about peace talks as a name. In the middle of a sentence these words were read correctly.
- **Lower-case names** in chat were all found in the hard-names set except one written together with its suffix (`elifle`). The model is cased, though, so expect more misses in chat than in edited text.
- **Person names inside institution names** ("Mimar Sinan Güzel Sanatlar Üniversitesi") are sometimes masked. That is a false alarm, and it errs toward masking.
- **Turkish only.** Foreign names in Turkish text are found ("John Smith"); text in other languages is not the target.
