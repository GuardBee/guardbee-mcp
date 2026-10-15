---
"@guardbee/mcp-security-proxy": minor
---

Fail-closed contract for the LLM and MCP gateways: any masking or scanning failure refuses the request with 502 `guardbee_masking_failed` (never the original text in the response or audit log), content the proxy cannot read (audio, files, PDF documents, unknown blocks) gets 415 `guardbee_unmaskable_content`, and a single text over `llm.maxTextChars` gets 413 `guardbee_text_too_large`. Codes come back in `error.code` and the `x-guardbee-error` header. Anthropic text documents are now masked. A route can opt out with `masking: off`, which is written to the audit log on every request.
