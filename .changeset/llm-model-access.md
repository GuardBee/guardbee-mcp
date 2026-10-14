---
"@guardbee/mcp-security-proxy": minor
---

LLM gateway: model access control (`llm.access`, `llm.accessDefault`) per user glob or group, with `/models` listing only the caller's models; and sensitive-data routing (`llm.sensitive`) that sends prompts holding personal data or listed topics to a model you run instead, unmasked by default, failing closed when that model has no route for the request's API. Routed requests are audited with `ruleId: llm:route:sensitive` and `llm.routedFrom`.
