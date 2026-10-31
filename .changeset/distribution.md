---
"@guardbee/mcp-security-proxy": minor
---

More ways to run the gateway:

- `guardbee-hook install --codex | --gemini-cli | --windsurf` puts the GuardBee policy, taint and secret checks on those agents' own tools:
  - Codex PreToolUse/PostToolUse;
  - Gemini CLI BeforeTool/AfterTool, with the hook switches turned on;
  - Windsurf Cascade pre_*/post_* hooks, which block with exit code 2.
- A multi-arch container image, `ghcr.io/guardbee/mcp-security-proxy`, is published after each release with an SBOM, SLSA provenance and a cosign signature. Its base image is pinned by digest.
- A Helm chart in `charts/guardbee-gateway` runs the gateway non-root with a read-only root filesystem, with a config ConfigMap, a secret for `${VAR}`s, `/healthz` probes, and an optional HPA, PDB and Ingress.
- INSTALL.md lists every channel.
