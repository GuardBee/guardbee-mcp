---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": patch
---

Find person names (`ner:`) in model answers and in coding-agent hooks too.

- LLM gateway: with `llm.maskResponses`, names in answers are masked, streamed or not.
  - In a stream, text is not cut next to a capitalised word, so a name reaches the model whole.
  - If the model fails on an answer, the rest of that answer is withheld and the failure is logged once (`pii:ner-failed`).
- Hooks: `guardbee-hook` counts names in tool output toward the session's taint. If the model fails there, the output counts as personal data.
- guard-core: a model span that lies wholly inside a KVKK Art. 6 term (`Huntington` in `Huntington geni`) is left to that category when it runs, instead of being masked as `[KİŞİ]`.
