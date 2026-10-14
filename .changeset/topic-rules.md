---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
---

Topic-based policy rules: a `topics` list (terms in Turkish or English, case- and Turkish-letter-insensitive, suffix-tolerant) and a `match.topic` rule field. The proxy checks topic rules on tool arguments and again on tool results, resources and prompts (`deny` withholds, `mask` forces PII masking, `warn` logs, `approve` asks), and on LLM gateway prompts with `tool: llm:<model>`. guard-core exports `detectTopics`, `topicSchema` and `checkTopicReferences`; dashboard policies validate topics too.
