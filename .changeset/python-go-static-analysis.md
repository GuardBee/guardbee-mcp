---
"@guardbee/guard-core": minor
"@guardbee/mcp-tool-poisoning-scanner": minor
"@guardbee/mcp-server-auditor": minor
"@guardbee/mcp-oauth-auditor": minor
"@guardbee/mcp-owasp-scan": minor
---

Static analysis of Python and Go MCP servers.

- guard-core: `extractPythonTools` / `extractGoTools` read tool definitions (name, description, parameter descriptions, `readOnlyHint`, input names and handler code) from FastMCP / official Python SDK decorators, the low-level `Tool(...)` + `call_tool` form, the official go-sdk and mark3labs/mcp-go; `languageOf`, `ANALYSIS_DEPTH`; `PYTHON_SINK_RULES`, `GO_SINK_RULES`, `sinkRulesFor`. The sensitive-file description rule also matches `~/.cursor/mcp.json`, `claude_desktop_config.json` and `~/.kube/config`; a long camelCase identifier is no longer taken for an encoded blob.
- tool-poisoning-scanner: description injection and confused-deputy checks on Python and Go servers; findings carry `language` (also in SARIF); `scan_text` takes a `language`.
- mcp-server-auditor: tool input followed from the tool definition through assignments into shell, file write/delete, HTTP and SQL calls in Python and Go handlers (`python_fs_write_from_tool_input`, `go_shell_from_tool_input`, `go_fs_write_from_tool_input`, `go_ssrf_from_tool_input`, `go_sql_injection_via_tool_input`, and the existing Python ids for FastMCP parameters).
- oauth-auditor: authlib and python-jose audience checks, `verify_aud: False`, forwarding all request headers, authlib PKCE; Go rules for golang-jwt / jwx audience, go-oidc `SkipClientIDCheck`, header passthrough, hardcoded `ClientSecret`, `strings.HasPrefix` redirect checks, math/rand state, discovery SSRF, shell-opened auth URLs, x/oauth2 PKCE and go-sdk / mcp-go HTTP transports; `token_passthrough_via_variable` for both. Language-specific rules run only on their own language.
- owasp-scan: the report's `coverage` lists every source file with its language, analysis depth (`full` or `patterns`) and tool definitions found, with a per-language summary in text output.
