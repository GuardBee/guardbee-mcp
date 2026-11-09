---
"@guardbee/guard-core": minor
"@guardbee/mcp-owasp-scan": patch
---

Rust MCP servers (rmcp `#[tool]` / `#[tool_router]`) are analyzed in full: `extractRustTools`, `RUST_SINK_RULES` (process, filesystem, env::vars), and `ANALYSIS_DEPTH.rust = "full"`. owasp-scan coverage reports Rust as full and counts rmcp tools.
