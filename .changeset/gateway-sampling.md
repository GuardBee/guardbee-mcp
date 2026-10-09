---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
---

Sampling (`interceptors.sampling`, off by default): servers can ask the agent's model for a completion through the gateway, with guards. A request is answered only during one of that server's tool calls, by the calling session; `includeContext` is forced to `none`; `maxTokens` and requests per call are capped; what the server sends gets the injection scan; `approval` can ask the person first; and the model's answer is checked like egress (credentials and session data block it, personal data is masked). guard-core's policy schema gains `interceptors.sampling`.
