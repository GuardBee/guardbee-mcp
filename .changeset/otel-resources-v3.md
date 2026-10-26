---
"@guardbee/mcp-security-proxy": patch
"@guardbee/mcp-db-gateway": patch
---

Align the optional OpenTelemetry peers on the 3.x line (`@opentelemetry/resources` ^3.0.0, alongside `@opentelemetry/exporter-trace-otlp-http` ^0.300.0), and resolve `@modelcontextprotocol/sdk` from the workspace catalog in db-gateway so the monorepo installs a single SDK copy.
