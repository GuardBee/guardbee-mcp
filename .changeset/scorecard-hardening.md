---
"@guardbee/mcp-security-proxy": patch
"@guardbee/mcp-db-gateway": minor
"@guardbee/mcp-telemetry": patch
"@guardbee/security-suite": patch
"@guardbee/mcp-document-scanner": patch
---

`mcp-security-proxy` and `mcp-db-gateway` get an `exports` map (the package root, `./dist/*` for existing deep imports, `package.json`); db-gateway also exports `./adapters/*`, so the documented `import { createPrismaAdapter } from "@guardbee/mcp-db-gateway/adapters/prisma"` now resolves. The proxy moves to ldapts 9 (its older uuid had an advisory). The telemetry package description now says opt-in, the suite's starts with "MCP security suite", and document-scanner's homepage is its README.
