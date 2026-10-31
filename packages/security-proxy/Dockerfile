# GuardBee MCP gateway as a network service (listen.transport: http).
#
#   docker run -p 8787:8787 -e GUARDBEE_PROXY_KEY=... \
#     -v "$PWD/guardbee-proxy.yaml:/etc/guardbee/guardbee-proxy.yaml:ro" ghcr.io/guardbee/mcp-security-proxy:1
#
# Published multi-arch to GHCR by .github/workflows/image.yml (SBOM, provenance,
# cosign signature). To build it yourself:
#   docker build --build-arg VERSION=1.36.0 -t mcp-security-proxy packages/security-proxy
#
# In a container the proxy must listen on 0.0.0.0, and the config refuses that
# without listen.apiKeys — see README "Remote mode".
# Pinned by digest; Dependabot (docker ecosystem) proposes updates
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

ARG VERSION=1
LABEL org.opencontainers.image.title="GuardBee MCP security proxy" \
      org.opencontainers.image.description="MCP security gateway: policy, PII masking, injection and tool-poisoning checks, audit" \
      org.opencontainers.image.source="https://github.com/GuardBee/guardbee-mcp" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
# The OpenTelemetry SDK is an optional peer of the proxy; the image ships it so
# OTEL_EXPORTER_OTLP_ENDPOINT alone turns span export on.
RUN npm install -g --omit=dev "@guardbee/mcp-security-proxy@${VERSION}" \
      @opentelemetry/sdk-trace-base@^2.12.0 @opentelemetry/exporter-trace-otlp-http@^0.300.0 @opentelemetry/resources@^3.0.0 \
 && npm cache clean --force

USER node
WORKDIR /home/node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1

ENTRYPOINT ["guardbee-proxy"]
CMD ["--config", "/etc/guardbee/guardbee-proxy.yaml"]
