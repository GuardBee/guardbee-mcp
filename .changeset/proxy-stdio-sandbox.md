---
"@guardbee/mcp-security-proxy": minor
---

Sandbox for stdio upstreams: `upstreams.<name>.sandbox` runs a server in docker, podman, bubblewrap (Linux) or sandbox-exec (macOS) with a read-only disk (writes only to `fs.readWrite` and a private home that holds its package cache), credential stores and `.env` files hidden, no host environment unless listed in `env`, optional `network: none`, and CPU / memory / pid limits in containers. A sandbox that cannot work on the host stops the gateway instead of falling back; `guardbee-proxy validate` reports why, and start failures are audit events (`ruleId: sandbox:*`). `guardbee-proxy init --sandbox [runtime]` sandboxes imported servers. Configs without `sandbox` are unchanged.
