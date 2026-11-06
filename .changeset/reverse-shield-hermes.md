---
"@guardbee/mcp-reverse-shield": minor
"@guardbee/security-suite": patch
---

reverse-shield: `hermes_names_not_minified` (medium). A React Native bundle compiled to Hermes bytecode is now read (string table and function headers, bytecode version 98) and flagged when its functions keep their source names, which hermes-dec and hbctool print back. Other bytecode versions are noted as before.
