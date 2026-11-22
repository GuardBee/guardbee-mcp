---
"@guardbee/mcp-security-proxy": minor
---

Legacy SSE upstreams: `upstreams.<name>.transport: sse` puts a server that only serves the older HTTP+SSE transport behind the gateway, with the same policy, headers, `auth` and `network` egress rules as a Streamable HTTP upstream. `guardbee-proxy init` now moves SSE servers (`type: "sse"`, or a URL ending in `/sse`) behind the proxy instead of leaving them outside it.
