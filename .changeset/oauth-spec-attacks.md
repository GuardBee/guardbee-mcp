---
"@guardbee/mcp-oauth-auditor": minor
"@guardbee/mcp-owasp-scan": patch
---

oauth-auditor checks the attacks the MCP spec's Security Best Practices name that it did not cover (#203): predictable or unbound state/session handles (state handle hijacking), authorization codes redeemed without an `iss` check (mix-up, RFC 9207), authorization URLs opened without a scheme check or through a shell, and HTTP MCP servers with no authentication, no Host/Origin check (DNS rebinding) or bound to 0.0.0.0. Every finding links its spec section (SARIF `helpUri`) and carries its OWASP MCP Top 10 id; owasp-scan now reports the shell-open rule under MCP05. New `guardbee-oauth-auditor probe <url>`: a read-only check of a running local or private HTTP MCP endpoint for unauthenticated access and foreign Host/Origin acceptance.
