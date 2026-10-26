---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
"@guardbee/mcp-config-auditor": minor
---

Provenance for PyPI packages and container images. `uvx` / `uv tool run` upstreams are checked against PEP 740 attestations (every file of the release, signed by its Trusted Publisher's workflow) and pinned to `pkg==<version>`; `docker run` / `podman run` upstreams resolve the tag to a digest, verify the image's cosign keyless signature (expected signer: the image owner's GitHub account on ghcr.io, or `provenance.signers`) and run pinned to `image@sha256:…`. `guardbee-proxy provenance --format sarif` writes the findings for code scanning. guard-core adds `checkPypiProvenance`, `checkOciProvenance`, `parseImageReference` and `pypiAttestationToBundle`, and `parseLaunch` skips uvx options that take a value. mcp-config-auditor flags `docker run` servers started by tag (`unpinned_container_image`).
