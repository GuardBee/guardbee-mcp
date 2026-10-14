---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway: a streamed answer that must be rewritten (PII tokens put back, `maskResponses`) now streams incrementally instead of being fetched whole and replayed. Text is held only until a safe cut and rewritten with the text already sent as context, so values split across events are still masked or restored.
