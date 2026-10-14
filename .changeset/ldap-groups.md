---
"@guardbee/mcp-security-proxy": minor
---

`listen.ldap`: add LDAP / Active Directory groups to a known caller (OIDC user or LLM gateway key user) for rules, quotas, `llm.access` and budgets — `memberOf` or a group search, CN or DN names, cached, filter values escaped (RFC 4515), bind password from the environment; an unreachable directory answers 503 unless `onError: token-groups`.
