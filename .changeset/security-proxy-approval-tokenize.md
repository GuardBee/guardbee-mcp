---
"@guardbee/mcp-security-proxy": minor
---

Gateway: approvals, tokenized PII, `init`.

- `approve` action and `taint.mode: approve`: the person answers a yes/no form through MCP elicitation; decline, cancel, a timeout (`approval.timeoutSeconds`, default 120) or a client without elicitation all block the call.
- `interceptors.piiMasking.mode: tokenize`: the model sees session tokens such as `<pii:tc_kimlik:7f3a9b21>`, and the proxy puts the real value back when the token is passed to another tool — never to an `egress` tool unless `detokenizeForEgress: true`.
- Rules can match on `args` (dotted path → value, strings are globs), and `mask.fields` blanks named JSON keys in text and `structuredContent`.
- PII in `structuredContent` is now masked; before, only text content was.
- `prompts/get` results get the injection scan and PII masking.
- `definitionDrift.recheck: on-change` re-lists a server's tools only after it sends `tools/list_changed`; the proxy relays that notification to the agent.
- `guardbee-proxy init --client claude-desktop|cursor|claude-code` (or `--file`) moves stdio servers into `guardbee-proxy.yaml`, backs up the client config and points it at the proxy.
