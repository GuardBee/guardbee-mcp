# GuardBee MCP gateway as a network service (listen.transport: http).
#
#   docker build -t guardbee/mcp-security-proxy packages/security-proxy
#   docker run -p 8787:8787 -e GUARDBEE_PROXY_KEY=... \
#     -v "$PWD/guardbee-proxy.yaml:/etc/guardbee/guardbee-proxy.yaml:ro" guardbee/mcp-security-proxy
#
# In a container the proxy must listen on 0.0.0.0, and the config refuses that
# without listen.apiKeys — see README "Remote mode".
FROM node:22-alpine

ARG VERSION=1
RUN npm install -g --omit=dev "@guardbee/mcp-security-proxy@${VERSION}" \
 && npm cache clean --force

USER node
WORKDIR /home/node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1

ENTRYPOINT ["guardbee-proxy"]
CMD ["--config", "/etc/guardbee/guardbee-proxy.yaml"]
