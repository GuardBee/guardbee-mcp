---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway: `POST /v1/responses` (OpenAI Responses API, streaming included) and `POST /v1/embeddings`. Responses get the same checks and masking as chat (instructions, message items, function call arguments and outputs, stored-prompt variables), tokens are put back and answers masked in streams too, and input files/audio are refused with 415. Embeddings mask every input text deterministically (fixed placeholders, no tokenize, org numbers per text) so the same text always gets the same vector; token-id input is refused with 415, one element over `llm.maxTextChars` refuses the batch with 413, and injection scanning and `llm.sensitive` routing are skipped.
