---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
---

AIBOM and compliance mappings. `guardbee-proxy aibom` writes a CycloneDX 1.6 AI bill of materials of the gateway: MCP servers with package URLs, pinned versions, build-provenance status and sandbox settings; their pinned tools (definition SHA-256, hints); remote servers as services with endpoints; LLM routes as models. It validates against the official schema and holds no environment values, headers or keys. `guardbee-proxy report --framework eu-ai-act|iso42001|soc2|nist-ai-rmf` adds a signed section mapping the period's findings and the gateway's controls to the framework's requirements, each with its citation. guard-core exports the versioned tables (`COMPLIANCE_FRAMEWORKS`, `COMPLIANCE_MAPPING_VERSION`); they are evidence for an assessment, not a certification.
