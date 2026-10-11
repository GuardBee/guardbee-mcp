---
"@guardbee/guard-core": minor
"@guardbee/mcp-secret-scanner": minor
"@guardbee/mcp-security-proxy": patch
---

38 more secret rules (76 in all): cloud and hosting (Azure AD client secret and storage key, DigitalOcean, Heroku, Fly.io, Cloudflare Origin CA, Supabase, PlanetScale), AI providers (OpenRouter, Groq, Perplexity, Replicate, Hugging Face org), developer tools (GitHub fine-grained, GitLab runner, PyPI, Vault, Terraform Cloud, Pulumi, Doppler, 1Password, age) and SaaS (Stripe webhook, Square, Shopify, Twilio API key, Linear, Notion, Atlassian, Sentry, Grafana, Postman, Discord webhook, Telegram bot). The fixed-format ones are also masked by security-proxy (66 formats, up from 32). Turkish providers iyzico, PayTR, Netgsm and İleti Merkezi are matched on their variable names and marked broad, so the scanner reports them and the proxy does not mask on them.
