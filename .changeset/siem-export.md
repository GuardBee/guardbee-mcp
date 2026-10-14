---
"@guardbee/mcp-security-proxy": minor
---

SIEM export: `audit.exporters` sends every audit event, batched and off the request path, to Splunk HEC, Elasticsearch/OpenSearch (`_bulk` create, event hash as `_id`) or syslog (RFC 5424 over UDP, TCP or TLS; CEF or JSON). Credentials come from environment variables; each destination has its own bounded retry queue. The dashboard sink now shares the same queue.
