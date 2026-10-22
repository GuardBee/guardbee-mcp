---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
"@guardbee/mcp-rug-pull-detector": patch
---

Persistent tool pins (#201): in gateway mode the proxy pins each server's tool definitions (SHA-256 of name, description, input/output schema, annotations) in `~/.guardbee/pins.json` and checks them on every start, so a tool rewritten between two runs is caught, not just one rewritten within a session. `interceptors.definitionDrift.onChange` decides what happens: `approve` (default) keeps showing the approved definition and asks the person before the first call, with the old and new description; `block` refuses; `warn` logs. New CLI: `guardbee-proxy pins list | approve | reset | import` (imports an mcp-rug-pull-detector baseline). guard-core exports the shared `hashToolDefinition`; rug-pull-detector now uses it, with the same hashes as before.
