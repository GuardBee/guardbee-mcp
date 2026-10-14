---
"@guardbee/mcp-security-proxy": minor
---

LLM API gateway: OpenAI- and Anthropic-compatible endpoints (`/v1/chat/completions`, `/v1/messages`, `/v1/models`) in HTTP mode. Apps use gateway keys instead of provider keys; prompts get injection, credential and PII checks (masking or tokenize, with tokens put back in the answer); request, token and USD budgets per user or gateway; token usage and cost in the audit log. Streaming is supported for both APIs.
