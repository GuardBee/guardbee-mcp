---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway `llm.documents` now fetches http(s) PDF and image URLs under the same size/time caps (private, loopback and cloud-metadata addresses refused) before reading them like inline data. With `ner:` configured, person names inside extracted PDF, OCR and transcript text are included in the name scan. Provider `file_id` values stay unmaskable.
