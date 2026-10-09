---
"@guardbee/mcp-toxic-flow-auditor": patch
---

SARIF output is now accepted by GitHub code scanning: rules no longer repeat the `toxic-flow` tag, and findings (which span several tools and have no file of their own) are anchored to the scanned path.
