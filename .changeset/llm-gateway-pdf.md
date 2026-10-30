---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway: read PDFs in requests instead of refusing them (#239).

With `llm.documents.pdf: true`, inline PDFs are read with `@guardbee/mcp-document-scanner` and their text goes through every prompt check: injection, credentials, topic rules, sensitive routing and PII. This covers OpenAI `file` parts, Responses `input_file` parts and Anthropic base64 `document` blocks.

- A clean PDF is forwarded unchanged.
- A PDF holding personal data the proxy would mask is refused with `403` (`pii:document`), unless the route has masking off or `llm.sensitive` keeps it in-house.
- A PDF that cannot be read in full (size, pages, encryption, timeout, scanned pages with OCR off) stays `415 guardbee_unmaskable_content`.
- The audit log records each PDF's name, size, hash, pages and the checks that ran (`documents`), never its bytes.
- Off by default: without `llm.documents`, PDFs are refused with `415` as before.
