---
"@guardbee/mcp-secret-scanner": minor
---

High-entropy detection: a random-looking value assigned to a secret-like name (`.env`, YAML, JSON, code) is reported as `high_entropy_secret` even when no provider rule knows its format. Thresholds are per character set (hex needs 32+ characters; values without digits need more bits), public/hash/id/url names, placeholders and references are skipped, and a value a provider rule already reported is not repeated. Medium severity, low in test files; `--no-entropy` or `entropy: false` turns it off. `.tsbuildinfo` files are skipped.
