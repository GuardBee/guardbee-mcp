---
"@guardbee/mcp-security-engineer": minor
---

`detect_stack` also recognizes `vercel.json`, `netlify.toml`, `public/_headers`, Cloudflare worker deps, and Dockerfiles that reference nginx; Fly.io and Firebase Hosting show up as notes. The MCP server version now follows `package.json`.
