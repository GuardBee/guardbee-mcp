# guardbee-gateway Helm chart

The GuardBee MCP security gateway in remote (HTTP) mode on Kubernetes. It uses the multi-arch image `ghcr.io/guardbee/mcp-security-proxy`, which is signed with cosign and ships with an SBOM.

```bash
helm install gateway ./charts/guardbee-gateway \
  --set-file config=./guardbee-proxy.yaml \
  --set secret.values.GUARDBEE_PROXY_KEY=$(openssl rand -hex 32) \
  --set secret.values.GITHUB_TOKEN=$GITHUB_TOKEN
```

**`config`** is your `guardbee-proxy.yaml`, mounted read-only from a ConfigMap.
- `listen` must be `transport: http`, `host: 0.0.0.0`, with `apiKeys` or `oidc`. The gateway refuses to listen on 0.0.0.0 without one.
- Secrets stay out of the ConfigMap: write `${VAR}` in the config and give the values in `secret.values`, or in `secret.existingSecret` (sealed-secrets, external-secrets, Vault). Every key becomes an environment variable.

**Security:**
- the pod runs as non-root with a read-only root filesystem, all capabilities dropped and seccomp `RuntimeDefault`;
- the service account token is not mounted.

The gateway's state (pins, provenance cache) goes to an `emptyDir`. With `interceptors.definitionDrift.persist`, mount a volume on `/home/node/.guardbee` instead.

**Probes:** liveness and readiness use `/healthz`.

**Several replicas:**
- Quotas and LLM budgets must be shared. Set `state: { backend: redis, url: rediss://:${REDIS_PASSWORD}@… }` in `config` (see `examples/proxy/replicas.yaml`).
- MCP sessions live on one pod: route a session to one pod by the `Mcp-Session-Id` header (nginx: `upstream-hash-by: "$http_mcp_session_id"`), or use stateless 2026-07-28 clients.
- `autoscaling.enabled` adds an HPA on CPU, and `podDisruptionBudget.enabled` adds a PDB.

**Verify the image:**

```bash
cosign verify ghcr.io/guardbee/mcp-security-proxy:1 \
  --certificate-identity-regexp '^https://github.com/GuardBee/guardbee-mcp/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
