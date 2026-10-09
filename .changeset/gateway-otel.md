---
"@guardbee/mcp-security-proxy": minor
---

OpenTelemetry: each tool call is a `tools/call <tool>` span with MCP semantic-convention attributes, the upstream call is a child span, and every audit event of the call (blocks, toxic flows, approvals, sampling) is a span event. The proxy depends only on `@opentelemetry/api`; with the SDK installed (optional peers, included in the Docker image) and `OTEL_EXPORTER_OTLP_ENDPOINT` set, spans go out over OTLP/HTTP. An SDK the process registered first is left in place.
