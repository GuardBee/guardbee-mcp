---
"@guardbee/mcp-security-proxy": minor
---

Sandboxed stdio upstreams can reach a host allowlist: `sandbox.network: allowlist` with `allowHosts` (and `blockPrivate`, default true). The gateway runs an egress proxy per upstream (CONNECT and plain HTTP) that connects only to those hosts, checks the resolved address on the connection (metadata, link-local and private refused, DNS rebinding included) and audits every refusal. The sandbox can reach that proxy and nothing else: Seatbelt allows only its localhost port, bwrap gets its own network namespace with a forwarder to the proxy's unix socket, docker / podman put the server on an `--internal` network with a forwarder sidecar (removed on exit). `HTTP_PROXY` / `HTTPS_PROXY`, `NODE_USE_ENV_PROXY` and `npm_config_*proxy` are set in the sandbox and cannot be overridden by the upstream's env.
