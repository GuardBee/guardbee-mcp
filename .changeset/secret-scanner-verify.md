---
"@guardbee/mcp-secret-scanner": minor
---

Live verification, CLI only: `--verify` asks each provider (GitHub, GitLab, OpenAI, Anthropic, Slack, Stripe, Hugging Face, npm, SendGrid, Groq, OpenRouter, DigitalOcean) through a read-only identity endpoint whether a found key still works, marks findings `live` / `invalid` / `unknown` and lists live ones first; `--fail-on=live` fails only for keys that still work. Each key goes only to its own provider, once; raw values never reach a finding or the output. The MCP tools do not verify.
