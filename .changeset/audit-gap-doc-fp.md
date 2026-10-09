---
"@guardbee/mcp-audit-gap-auditor": patch
---

`audit_disabled_in_code` no longer fires on documentation files (`.md`, `.mdx`, `.rst`, `.txt`, `.adoc`), where `GUARDBEE_TELEMETRY=0` is an opt-out instruction rather than a hard-coded disable.
