---
"@guardbee/mcp-security-proxy": minor
---

Mask Turkish person names with the optional NER model ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).

- New top-level `ner:` section in the gateway config: a `guardbee-ner serve` sidecar (`url`, `tokenEnv`, `timeoutMs`) or `@guardbee/ner` loaded in-process (`modelDir`). A sidecar on another host must use `https://`. This is deployment config: a dashboard policy cannot set it.
- With `ner:` set, every string is run through the model once before masking, and names are masked as `[KİŞİ]` (or tokenized as `<pii:person_name:…>`) in the same pass as the regex detectors. This covers tool results, `structuredContent`, resources, prompt templates, sampling answers and LLM gateway requests, including embeddings and `llm.sensitive` routing. `person_name` counts as personal data in `piiHits` and taint.
- Fails closed: if the model cannot answer, the tool result is withheld and an LLM request is refused with `502 guardbee_masking_failed`, `ruleId: pii:ner-failed`. Masking never falls back to regex alone.
- Not covered yet: model answers (`maskResponses`) and coding-agent hooks.
- Fix: `interceptors.documents` failed in the published (CommonJS) proxy because it could not load `@guardbee/mcp-document-scanner`. Fixed by that package's new `default` export condition, which needs Node 20.19+ or 22.12+.
