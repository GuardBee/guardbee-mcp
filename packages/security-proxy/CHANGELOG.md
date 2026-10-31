# @guardbee/mcp-security-proxy

## 1.37.0

### Minor Changes

- [#273](https://github.com/GuardBee/guardbee-mcp/pull/273) [`296c988`](https://github.com/GuardBee/guardbee-mcp/commit/296c988ae110929b40fb81f5606fbe93fd32be8b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - A2A gateway: an `a2a:` section serves Agent2Agent agents at `<path>/<name>`. Callers must authenticate (API key or OIDC, with `allowGroups` per agent). Injection in messages and in returned tasks and artifacts is blocked or warned, including streamed responses event by event. Personal data is masked. Push-notification webhooks to private or metadata addresses are refused. Agent cards are rewritten to point at the gateway, and every call is audited. Covers A2A 1.0 and 0.3 JSON-RPC.

- [#269](https://github.com/GuardBee/guardbee-mcp/pull/269) [`8de1cd1`](https://github.com/GuardBee/guardbee-mcp/commit/8de1cd1497915a4686a41ff4b841e9cd37a25f14) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - More ways to run the gateway:
  
  - `guardbee-hook install --codex | --gemini-cli | --windsurf` puts the GuardBee policy, taint and secret checks on those agents' own tools:
    - Codex PreToolUse/PostToolUse;
    - Gemini CLI BeforeTool/AfterTool, with the hook switches turned on;
    - Windsurf Cascade pre_*/post_* hooks, which block with exit code 2.
  - A multi-arch container image, `ghcr.io/guardbee/mcp-security-proxy`, is published after each release with an SBOM, SLSA provenance and a cosign signature. Its base image is pinned by digest.
  - A Helm chart in `charts/guardbee-gateway` runs the gateway non-root with a read-only root filesystem, with a config ConfigMap, a secret for `${VAR}`s, `/healthz` probes, and an optional HPA, PDB and Ingress.
  - INSTALL.md lists every channel.

- [#266](https://github.com/GuardBee/guardbee-mcp/pull/266) [`ca17dea`](https://github.com/GuardBee/guardbee-mcp/commit/ca17dea9e1167efcbe36ac0c8b73b3fe3ca941ae) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Optional LLM judge (any OpenAI-compatible endpoint, local by default: Ollama, llama.cpp, vLLM).
  
  - guard-core: `Judge` with `classifyInjection` and `checkAlignment`. It returns schema-checked JSON at temperature 0, with a latency budget and a cache, and reports the model and version. It is off unless configured, and a non-local endpoint needs `allowRemote` and https. Alignment behaviors must quote handler code that really exists, and behaviors the description states are dropped. `judgeFromEnv` reads `GUARDBEE_JUDGE_URL` / `GUARDBEE_JUDGE_MODEL`.
  - tool-poisoning-scanner: `--judge` checks each tool's handler against its description (`judge_description_behavior_mismatch`), with the model in findings and SARIF.
  - prompt-injection-scanner: `--judge` finds paraphrased or translated injections (`judge_semantic_injection`).
  - security-proxy: a `judge` config block. A borderline (warn) injection finding on tool arguments or results is raised to a block when the judge is confident it is malicious; with `mayClear` a confident "benign" clears it. `budgetMs` and `onError` (open/closed) apply. `scope: results` also judges every tool result the rules let through. Audit events carry `judge` (model, version, verdict, confidence, latency, outcome); CEF puts the model in `flexString1`.
  - Benchmark in bench/judge: rules alone vs. judge (qwen2.5:3b, qwen2.5:7b) on 50 English and Turkish injection samples and 16 tool alignment cases.

- [#264](https://github.com/GuardBee/guardbee-mcp/pull/264) [`fb81d57`](https://github.com/GuardBee/guardbee-mcp/commit/fb81d57371b9e06a3ff6c05a8877717276e51a89) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - GuardBee MCP Index: A–F trust grades for the servers in the official MCP Registry, rebuilt weekly from their published packages (static scan with the GuardBee scanners, OSV vulnerabilities and malware, Sigstore build provenance, maintenance; rubric in packages/mcp-index/RUBRIC.md).
  
  - guard-core: `loadMcpIndex` (downloads the whole index, cached for a day, so lookups send no names), `lookupMcpGrade` (by what a command launches: npm, PyPI, image), `gradeBelow`, `isMcpGrade`, index types.
  - mcp-config-auditor: `--grades` on `scan <file>` and `discover` shows each server's grade; `--min-grade=<A-F>` reports servers below it (`mcp_index_grade_below_minimum`, MCP04); `--index-url`, `--offline`.
  - security-proxy: `guardbee-proxy init --grades` shows the grades; `--min-grade <A-F>` leaves servers below it out of both the gateway and the client config (they stay in the backup).

- [#267](https://github.com/GuardBee/guardbee-mcp/pull/267) [`04efcf5`](https://github.com/GuardBee/guardbee-mcp/commit/04efcf501876fdf437aa04f924dc1e288fa265cb) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Upstream identity: each caller acts as themselves at HTTP upstreams, and their own token is never forwarded.
  
  - `upstreams.<name>.auth.mode: token-exchange` exchanges the caller's OIDC access token (RFC 8693) for one with the upstream as audience. Tested against Keycloak.
  - `oauth-per-user` lets each user connect their own account at a third-party OAuth server through a consent page the gateway serves (PKCE S256, signed single-use links, CSRF token, exact redirect URI, RFC 9207 `iss`, no framing). Tokens are stored encrypted (AES-256-GCM) and refreshed.
  - Scope minimization: a call asks for `scopes` plus the called tool's `toolScopes`, and steps up on `insufficient_scope`. Elevations and consents are audit events (`auth:step-up`, `auth:consent`).
  - Tool responses record `upstreamIdentity` next to `user`.
  - New top-level `upstreamAuth` (`publicUrl`, `encryptionKeyEnv`, `tokenFile`).

### Patch Changes

- Updated dependencies [[`ca17dea`](https://github.com/GuardBee/guardbee-mcp/commit/ca17dea9e1167efcbe36ac0c8b73b3fe3ca941ae), [`fb81d57`](https://github.com/GuardBee/guardbee-mcp/commit/fb81d57371b9e06a3ff6c05a8877717276e51a89)]:
  - @guardbee/guard-core@1.5.0

## 1.36.0

### Minor Changes

- [#260](https://github.com/GuardBee/guardbee-mcp/pull/260) [`292bf77`](https://github.com/GuardBee/guardbee-mcp/commit/292bf77de4d02e7c47dfd6c2189f882013ab49a7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Sandboxed stdio upstreams can reach a host allowlist: `sandbox.network: allowlist` with `allowHosts` (and `blockPrivate`, default true). The gateway runs an egress proxy per upstream (CONNECT and plain HTTP) that connects only to those hosts, checks the resolved address on the connection (metadata, link-local and private refused, DNS rebinding included) and audits every refusal. The sandbox can reach that proxy and nothing else: Seatbelt allows only its localhost port, bwrap gets its own network namespace with a forwarder to the proxy's unix socket, docker / podman put the server on an `--internal` network with a forwarder sidecar (removed on exit). `HTTP_PROXY` / `HTTPS_PROXY`, `NODE_USE_ENV_PROXY` and `npm_config_*proxy` are set in the sandbox and cannot be overridden by the upstream's env.

## 1.35.0

### Minor Changes

- [#258](https://github.com/GuardBee/guardbee-mcp/pull/258) [`d3e8a52`](https://github.com/GuardBee/guardbee-mcp/commit/d3e8a520fb3b98141a397f8cac2d655c92606fc3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - LLM gateway: transcribe audio in requests ([#239](https://github.com/GuardBee/guardbee-mcp/issues/239)).
  
  With `llm.documents.audio: { url, model, language?, apiKeyEnv? }`, Chat Completions `input_audio` parts (`wav`, `mp3`) are transcribed by your own OpenAI-compatible speech-to-text service (whisper.cpp server, faster-whisper-server, vLLM). The transcript goes through every prompt check, just like PDFs and images.
  
  - Clean audio is forwarded unchanged.
  - Audio in which personal data the proxy would mask is spoken is refused with `403` (`pii:document`).
  - Audio that cannot be transcribed is `415 guardbee_unmaskable_content` while masking applies. This covers another format, wrong data, the service down or erroring, and the time limit.
  - The audit log records the audio's size and hash, never the bytes or the transcript.
  - Off by default: without `audio`, `input_audio` stays `415` as before.

## 1.34.0

### Minor Changes

- [#253](https://github.com/GuardBee/guardbee-mcp/pull/253) [`26f3130`](https://github.com/GuardBee/guardbee-mcp/commit/26f3130b65e42e4bef3ccde5f874d8b858bee1c6) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - LLM gateway: read images in requests with OCR ([#239](https://github.com/GuardBee/guardbee-mcp/issues/239)).
  
  With `llm.documents.images: true`, inline images are read with Tesseract OCR (`tesseract.js`, installed next to the proxy) and their text goes through every prompt check, just like PDFs: injection, credentials, topic rules, sensitive routing and PII. This covers OpenAI `image_url` parts, Responses `input_image` parts and Anthropic base64 `image` blocks.
  
  - A clean image is forwarded unchanged.
  - An image holding personal data the proxy would mask is refused with `403` (`pii:document`).
  - An image that cannot be read (OCR not installed, not an image, size, timeout) is `415 guardbee_unmaskable_content` while masking applies.
  - New options: `llm.documents.languages` (default `[tur, eng]`) and `llm.documents.langPath` for offline language data.
  - Images given by URL are not fetched and pass as before. Off by default: without `images: true`, images are forwarded unchecked as before.

## 1.33.0

### Minor Changes

- [#251](https://github.com/GuardBee/guardbee-mcp/pull/251) [`9381839`](https://github.com/GuardBee/guardbee-mcp/commit/93818390e88597ea4c12e11575390e4d23dde1ac) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - LLM gateway: read PDFs in requests instead of refusing them ([#239](https://github.com/GuardBee/guardbee-mcp/issues/239)).
  
  With `llm.documents.pdf: true`, inline PDFs are read with `@guardbee/mcp-document-scanner` and their text goes through every prompt check: injection, credentials, topic rules, sensitive routing and PII. This covers OpenAI `file` parts, Responses `input_file` parts and Anthropic base64 `document` blocks.
  
  - A clean PDF is forwarded unchanged.
  - A PDF holding personal data the proxy would mask is refused with `403` (`pii:document`), unless the route has masking off or `llm.sensitive` keeps it in-house.
  - A PDF that cannot be read in full (size, pages, encryption, timeout, scanned pages with OCR off) stays `415 guardbee_unmaskable_content`.
  - The audit log records each PDF's name, size, hash, pages and the checks that ran (`documents`), never its bytes.
  - Off by default: without `llm.documents`, PDFs are refused with `415` as before.

## 1.32.1

### Patch Changes

- Updated dependencies [[`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655)]:
  - @guardbee/mcp-document-scanner@0.4.0
  - @guardbee/mcp-telemetry@0.3.1

## 1.32.0

### Minor Changes

- [#243](https://github.com/GuardBee/guardbee-mcp/pull/243) [`d7233af`](https://github.com/GuardBee/guardbee-mcp/commit/d7233af6e4ac04288c6138a50034d3b07465b965) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Speak MCP 2026-07-28 next to 2025-11-25, on the MCP TypeScript SDK v2. Agents and upstreams can be on either revision and are mixed freely. Upstreams negotiate by default (`server/discover`, falling back to `initialize`); pin one with `upstreams.<name>.protocol` (`auto`, `2025-11-25`, `2026-07-28`). Over HTTP, 2026-07-28 requests are served without a session: taint, PII tokens, pins and anomaly counters are kept per user and optional `X-GuardBee-Context` header (`listen.contextIdleSeconds`), and discovery and `subscriptions/listen` requests are routed by their `Mcp-Method` header without taking a context. Approvals for 2026-07-28 clients use `input_required` with a signed `requestState` bound to the user, tool and arguments (`listen.stateKeyEnv` for replicas); approvals after a server answered and sampling go to the dashboard channel or are refused. Upstream lists are always fetched fresh, so a server's cache hint cannot hide a changed definition. `guardbee-proxy init` points SSE entries at `/mcp`.

## 1.31.0

### Minor Changes

- [#221](https://github.com/GuardBee/guardbee-mcp/pull/221) [`f223d34`](https://github.com/GuardBee/guardbee-mcp/commit/f223d34a00dc142167b21bfe2d34ec28c3d8ef2a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - AIBOM and compliance mappings. `guardbee-proxy aibom` writes a CycloneDX 1.6 AI bill of materials of the gateway: MCP servers with package URLs, pinned versions, build-provenance status and sandbox settings; their pinned tools (definition SHA-256, hints); remote servers as services with endpoints; LLM routes as models. It validates against the official schema and holds no environment values, headers or keys. `guardbee-proxy report --framework eu-ai-act|iso42001|soc2|nist-ai-rmf` adds a signed section mapping the period's findings and the gateway's controls to the framework's requirements, each with its citation. guard-core exports the versioned tables (`COMPLIANCE_FRAMEWORKS`, `COMPLIANCE_MAPPING_VERSION`); they are evidence for an assessment, not a certification.

- [#219](https://github.com/GuardBee/guardbee-mcp/pull/219) [`69b9796`](https://github.com/GuardBee/guardbee-mcp/commit/69b9796faea2f324c65d59b49d2a924da064ba93) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Provenance for PyPI packages and container images. `uvx` / `uv tool run` upstreams are checked against PEP 740 attestations (every file of the release, signed by its Trusted Publisher's workflow) and pinned to `pkg==<version>`; `docker run` / `podman run` upstreams resolve the tag to a digest, verify the image's cosign keyless signature (expected signer: the image owner's GitHub account on ghcr.io, or `provenance.signers`) and run pinned to `image@sha256:…`. `guardbee-proxy provenance --format sarif` writes the findings for code scanning. guard-core adds `checkPypiProvenance`, `checkOciProvenance`, `parseImageReference` and `pypiAttestationToBundle`, and `parseLaunch` skips uvx options that take a value. mcp-config-auditor flags `docker run` servers started by tag (`unpinned_container_image`).

- [#220](https://github.com/GuardBee/guardbee-mcp/pull/220) [`a75f23b`](https://github.com/GuardBee/guardbee-mcp/commit/a75f23b12a1d205bafc82fd414840d0de0b12c66) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Shared counters for several replicas: `state.backend: redis` keeps quotas and LLM budgets (requests, tokens, cost) in Redis, so every replica behind a load balancer enforces one combined limit. Check and count run as one Lua script per call (no race between replicas), keys expire with their window, and Redis Cluster works (one hash tag). The proxy has its own small RESP client (redis:// and rediss://, AUTH, database), so nothing new is installed. `state.onError` decides what happens while Redis is down: `local` (default, count per process), `fail-open` or `fail-closed`; outages and recoveries are audit events (`state:unavailable`, `state:recovered`). The memory backend stays the default.

### Patch Changes

- Updated dependencies [[`f223d34`](https://github.com/GuardBee/guardbee-mcp/commit/f223d34a00dc142167b21bfe2d34ec28c3d8ef2a), [`69b9796`](https://github.com/GuardBee/guardbee-mcp/commit/69b9796faea2f324c65d59b49d2a924da064ba93), [`8c801c8`](https://github.com/GuardBee/guardbee-mcp/commit/8c801c8d64b42d4d0608668a4e8f6920f848246a)]:
  - @guardbee/guard-core@1.4.0

## 1.30.0

### Minor Changes

- [#218](https://github.com/GuardBee/guardbee-mcp/pull/218) [`d754b3e`](https://github.com/GuardBee/guardbee-mcp/commit/d754b3e41660eeadfdc3f817ac30e9e7333e466b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Sandbox for stdio upstreams: `upstreams.<name>.sandbox` runs a server in docker, podman, bubblewrap (Linux) or sandbox-exec (macOS) with a read-only disk (writes only to `fs.readWrite` and a private home that holds its package cache), credential stores and `.env` files hidden, no host environment unless listed in `env`, optional `network: none`, and CPU / memory / pid limits in containers. A sandbox that cannot work on the host stops the gateway instead of falling back; `guardbee-proxy validate` reports why, and start failures are audit events (`ruleId: sandbox:*`). `guardbee-proxy init --sandbox [runtime]` sandboxes imported servers. Configs without `sandbox` are unchanged.

### Patch Changes

- [#216](https://github.com/GuardBee/guardbee-mcp/pull/216) [`08c7391`](https://github.com/GuardBee/guardbee-mcp/commit/08c73915cd47eec7c5c0168bae88b77332ac6b6a) Thanks [@dependabot](https://github.com/apps/dependabot)! - Align the optional OpenTelemetry peers on the 3.x line (`@opentelemetry/resources` ^3.0.0, alongside `@opentelemetry/exporter-trace-otlp-http` ^0.300.0), and resolve `@modelcontextprotocol/sdk` from the workspace catalog in db-gateway so the monorepo installs a single SDK copy.

## 1.29.0

### Minor Changes

- [#213](https://github.com/GuardBee/guardbee-mcp/pull/213) [`03ae1d2`](https://github.com/GuardBee/guardbee-mcp/commit/03ae1d212f0b8413c28fa5b994076aeaf0abd5b8) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Build provenance check before a stdio upstream starts. The proxy resolves the npm package `npx` / `pnpm dlx` / `bunx` would run, verifies its Sigstore-signed SLSA provenance (signature against the Sigstore trust root, exact tarball hash, signing workflow of the named repository, matching `repository` field) and runs the command pinned to the checked version. `provenance.mode: warn` (default) logs unverified packages (`ruleId: provenance:*`), `require` refuses them, also per upstream. Results are cached per version (`~/.guardbee/provenance.json`; a changed tarball under a known version counts as tampering), `provenance.offline` works from the cache, and `guardbee-proxy provenance` checks a config without starting anything. PyPI and container images are reported (unpinned images by digest) but not yet verified. The proxy now needs Node.js 22.9 or later (Sigstore libraries). guard-core exports the dependency-free part: `parseLaunch`, `resolveNpmVersion`, `checkNpmProvenance` (signature check passed in), `normalizeRepositoryUrl`.

### Patch Changes

- Updated dependencies [[`03ae1d2`](https://github.com/GuardBee/guardbee-mcp/commit/03ae1d212f0b8413c28fa5b994076aeaf0abd5b8)]:
  - @guardbee/guard-core@1.3.0

## 1.28.0

### Minor Changes

- [#211](https://github.com/GuardBee/guardbee-mcp/pull/211) [`ca38e72`](https://github.com/GuardBee/guardbee-mcp/commit/ca38e720987c386bb3088bb194b83ea23474ef0d) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Network egress control for HTTP upstreams (SSRF guard). Every connection the proxy makes to a Streamable HTTP upstream, including each redirect hop, is checked at connect time with the address pinned (no DNS rebinding window). Link-local (cloud metadata), unspecified and reserved addresses are always refused, in any encoding; `upstreams.<name>.network` adds `blockPrivate` (by default: a server configured on a public address may not reach private ones) and `mode: allowlist` with `allowHosts`. Refused connections are audit events (`ruleId: network:*`) with the destination. guard-core exports the shared guard: `classifyAddress`, `checkHost`, `checkAddress`, `guardedLookup`, `guardedFetch`.

### Patch Changes

- Updated dependencies [[`ca38e72`](https://github.com/GuardBee/guardbee-mcp/commit/ca38e720987c386bb3088bb194b83ea23474ef0d)]:
  - @guardbee/guard-core@1.2.0

## 1.27.0

### Minor Changes

- [#207](https://github.com/GuardBee/guardbee-mcp/pull/207) [`1aac3f9`](https://github.com/GuardBee/guardbee-mcp/commit/1aac3f92917ec078542a73a8a05b57033a6b13d9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Persistent tool pins ([#201](https://github.com/GuardBee/guardbee-mcp/issues/201)): in gateway mode the proxy pins each server's tool definitions (SHA-256 of name, description, input/output schema, annotations) in `~/.guardbee/pins.json` and checks them on every start, so a tool rewritten between two runs is caught, not just one rewritten within a session. `interceptors.definitionDrift.onChange` decides what happens: `approve` (default) keeps showing the approved definition and asks the person before the first call, with the old and new description; `block` refuses; `warn` logs. New CLI: `guardbee-proxy pins list | approve | reset | import` (imports an mcp-rug-pull-detector baseline). guard-core exports the shared `hashToolDefinition`; rug-pull-detector now uses it, with the same hashes as before.

### Patch Changes

- Updated dependencies [[`1aac3f9`](https://github.com/GuardBee/guardbee-mcp/commit/1aac3f92917ec078542a73a8a05b57033a6b13d9)]:
  - @guardbee/guard-core@1.1.0

## 1.26.0

### Minor Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.

### Patch Changes

- Updated dependencies [[`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3)]:
  - @guardbee/mcp-document-scanner@0.3.0

## 1.25.3

### Patch Changes

- [#176](https://github.com/GuardBee/guardbee-mcp/pull/176) [`7224520`](https://github.com/GuardBee/guardbee-mcp/commit/7224520c3ee5c5cf14d6c0f4c20bf06b87f759eb) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - The repository now has an `examples/` folder (proxy policies for a minimal setup, KVKK, a coding agent and the LLM gateway; Claude Desktop, Claude Code, Cursor and VS Code configs; GitHub Actions and GitLab CI templates). The proxy tests check that every example policy parses.

- [#185](https://github.com/GuardBee/guardbee-mcp/pull/185) [`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `mcp-security-proxy` and `mcp-db-gateway` get an `exports` map (the package root, `./dist/*` for existing deep imports, `package.json`); db-gateway also exports `./adapters/*`, so the documented `import { createPrismaAdapter } from "@guardbee/mcp-db-gateway/adapters/prisma"` now resolves. The proxy moves to ldapts 9 (its older uuid had an advisory). The telemetry package description now says opt-in, the suite's starts with "MCP security suite", and document-scanner's homepage is its README.

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-telemetry@0.3.0
  - @guardbee/mcp-document-scanner@0.2.1
  - @guardbee/guard-core@1.0.1

## 1.25.2

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395), [`c3b71f8`](https://github.com/GuardBee/guardbee-mcp/commit/c3b71f8e1305cbabe0fa733b13f6eb9a95d08513), [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947)]:
  - @guardbee/mcp-document-scanner@0.2.0
  - @guardbee/guard-core@1.0.0
  - @guardbee/mcp-telemetry@0.2.0

## 1.25.1

### Patch Changes

- [#167](https://github.com/GuardBee/guardbee-mcp/pull/167) [`9599fb6`](https://github.com/GuardBee/guardbee-mcp/commit/9599fb64249dc38baba3fd4b2d1d7fb82dfd6de3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - PII masking now sees through encodings and disguises ([#166](https://github.com/GuardBee/guardbee-mcp/issues/166)): base64, base64url and hex runs that decode to readable text are masked and encoded again in the same form; HTML entities, JS/JSON `\u` escapes and URL escapes, and Arabic-Indic, Devanagari and other scripts' digits are decoded before detection, with masking mapped back onto the original characters. TC Kimlik numbers written with separators after a TC label, phones grouped with dots and spelled-out e-mail addresses (`[at]`, `(at)`, `at … dot`) are found too. pii-bench's new bypass suite masks 80 of 80 cases (23 before) with no change to 16 encoded-looking clean strings.
- Updated dependencies [[`9599fb6`](https://github.com/GuardBee/guardbee-mcp/commit/9599fb64249dc38baba3fd4b2d1d7fb82dfd6de3)]:
  - @guardbee/guard-core@0.22.0
  - @guardbee/mcp-document-scanner@0.1.10

## 1.25.0

### Minor Changes

- [#164](https://github.com/GuardBee/guardbee-mcp/pull/164) [`00de2c8`](https://github.com/GuardBee/guardbee-mcp/commit/00de2c86bc8a53cfa175fee152b8b2011f930d5d) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Find person names (`ner:`) in model answers and in coding-agent hooks too.
  
  - LLM gateway: with `llm.maskResponses`, names in answers are masked, streamed or not.
    - In a stream, text is not cut next to a capitalised word, so a name reaches the model whole.
    - If the model fails on an answer, the rest of that answer is withheld and the failure is logged once (`pii:ner-failed`).
  - Hooks: `guardbee-hook` counts names in tool output toward the session's taint. If the model fails there, the output counts as personal data.
  - guard-core: a model span that lies wholly inside a KVKK Art. 6 term (`Huntington` in `Huntington geni`) is left to that category when it runs, instead of being masked as `[KİŞİ]`.

### Patch Changes

- Updated dependencies [[`00de2c8`](https://github.com/GuardBee/guardbee-mcp/commit/00de2c86bc8a53cfa175fee152b8b2011f930d5d)]:
  - @guardbee/guard-core@0.21.1

## 1.24.1

### Patch Changes

- Updated dependencies [[`c1a16b9`](https://github.com/GuardBee/guardbee-mcp/commit/c1a16b9c9f588c4d3735fb45a1339b33119a8de0)]:
  - @guardbee/guard-core@0.21.0
  - @guardbee/mcp-document-scanner@0.1.9

## 1.24.0

### Minor Changes

- [#160](https://github.com/GuardBee/guardbee-mcp/pull/160) [`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - KVKK Art. 6 special categories and the `KVKK_SENSITIVE` preset ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).
  
  - guard-core: nine new detectors. `health`, `religion_belief`, `ethnic_origin`, `political_opinion`, `union_membership`, `criminal_record`, `sex_life`, `biometric` and `genetic` mask as `[SAĞLIK]`, `[DİN-İNANÇ]`, `[ETNİK-KÖKEN]`, `[SİYASİ-GÖRÜŞ]`, `[SENDİKA]`, `[SABIKA]`, `[CİNSEL-HAYAT]`, `[BİYOMETRİK]` and `[GENETİK]`.
  - How they work: a Turkish and English term list per category, plus a context rule. A term is masked only when the text is about a person: a name from the NER lookup, a personal identifier, or a word that points at someone. The mask grows over the phrase around the term.
  - They are opt-in. They are in no preset except the new `KVKK_SENSITIVE` (`KVKK` plus these), and can also be turned on by name. New exports: `SPECIAL_CATEGORIES` and `SPECIAL_CATEGORY_REPLACEMENT`.
  - security-proxy: `preset: KVKK_SENSITIVE` and the category names are accepted in config. Findings count as personal data in `piiHits`, taint and hooks.
  - document-scanner: the same categories count as personal data.
  - pii-bench has a new hand-written `tr-special-challenge` set. With the name model, per-category F1 there is 86–100, and its clean lines get no false alarms.

### Patch Changes

- Updated dependencies [[`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16)]:
  - @guardbee/guard-core@0.20.0
  - @guardbee/mcp-document-scanner@0.1.8

## 1.23.0

### Minor Changes

- [#158](https://github.com/GuardBee/guardbee-mcp/pull/158) [`d8bdffe`](https://github.com/GuardBee/guardbee-mcp/commit/d8bdffedeb2e3401ebc8ce6fc5616a17508f24e7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Mask Turkish person names with the optional NER model ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).
  
  - New top-level `ner:` section in the gateway config: a `guardbee-ner serve` sidecar (`url`, `tokenEnv`, `timeoutMs`) or `@guardbee/ner` loaded in-process (`modelDir`). A sidecar on another host must use `https://`. This is deployment config: a dashboard policy cannot set it.
  - With `ner:` set, every string is run through the model once before masking, and names are masked as `[KİŞİ]` (or tokenized as `<pii:person_name:…>`) in the same pass as the regex detectors. This covers tool results, `structuredContent`, resources, prompt templates, sampling answers and LLM gateway requests, including embeddings and `llm.sensitive` routing. `person_name` counts as personal data in `piiHits` and taint.
  - Fails closed: if the model cannot answer, the tool result is withheld and an LLM request is refused with `502 guardbee_masking_failed`, `ruleId: pii:ner-failed`. Masking never falls back to regex alone.
  - Not covered yet: model answers (`maskResponses`) and coding-agent hooks.
  - Fix: `interceptors.documents` failed in the published (CommonJS) proxy because it could not load `@guardbee/mcp-document-scanner`. Fixed by that package's new `default` export condition, which needs Node 20.19+ or 22.12+.

### Patch Changes

- Updated dependencies [[`d8bdffe`](https://github.com/GuardBee/guardbee-mcp/commit/d8bdffedeb2e3401ebc8ce6fc5616a17508f24e7)]:
  - @guardbee/mcp-document-scanner@0.1.7

## 1.22.1

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0
  - @guardbee/mcp-document-scanner@0.1.6

## 1.22.0

### Minor Changes

- [#153](https://github.com/GuardBee/guardbee-mcp/pull/153) [`9f64d9f`](https://github.com/GuardBee/guardbee-mcp/commit/9f64d9fe92ff56abf01e788fa1a924daf5e671ad) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - LLM gateway: `POST /v1/responses` (OpenAI Responses API, streaming included) and `POST /v1/embeddings`. Responses get the same checks and masking as chat (instructions, message items, function call arguments and outputs, stored-prompt variables), tokens are put back and answers masked in streams too, and input files/audio are refused with 415. Embeddings mask every input text deterministically (fixed placeholders, no tokenize, org numbers per text) so the same text always gets the same vector; token-id input is refused with 415, one element over `llm.maxTextChars` refuses the batch with 413, and injection scanning and `llm.sensitive` routing are skipped.

## 1.21.0

### Minor Changes

- [#150](https://github.com/GuardBee/guardbee-mcp/pull/150) [`e49fbc2`](https://github.com/GuardBee/guardbee-mcp/commit/e49fbc2bc1a67a4a32e40c7d221a81fb7bbbd211) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fail-closed contract for the LLM and MCP gateways: any masking or scanning failure refuses the request with 502 `guardbee_masking_failed` (never the original text in the response or audit log), content the proxy cannot read (audio, files, PDF documents, unknown blocks) gets 415 `guardbee_unmaskable_content`, and a single text over `llm.maxTextChars` gets 413 `guardbee_text_too_large`. Codes come back in `error.code` and the `x-guardbee-error` header. Anthropic text documents are now masked. A route can opt out with `masking: off`, which is written to the audit log on every request.

## 1.20.0

### Minor Changes

- [#148](https://github.com/GuardBee/guardbee-mcp/pull/148) [`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Org-level PII patterns. `blockPatterns` mask an organization's own identifiers as numbered placeholders (`<CLIENT_NO_1>`); `allowPatterns` leave a detected value unmasked and are flagged in the audit log. Each pattern runs with a time budget: a block pattern over budget fails closed (result withheld, LLM gateway 502), an allow pattern over budget is skipped. Max 25 patterns of 200 characters; invalid regexes and categories named like built-in detectors fail validation. An LLM gateway request can add block patterns (`guardbee.blockPatterns`) but never allow patterns.

### Patch Changes

- Updated dependencies [[`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548)]:
  - @guardbee/guard-core@0.18.0
  - @guardbee/mcp-document-scanner@0.1.5

## 1.19.0

### Minor Changes

- [#146](https://github.com/GuardBee/guardbee-mcp/pull/146) [`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - PII category presets. guard-core exports `PII_PRESETS` (`ALL`, `KVKK`, `IDENTITY`, `IDENTIFIERS`, `SECRETS`), `piiScope({ preset, enable, disable })` and a config schema that rejects unknown preset or detector names. security-proxy takes `interceptors.piiMasking.preset` / `enable` / `disable`, with `piiMasking.upstreams.<name>` per upstream or LLM provider; detection stays complete (taint, `piiHits`), only masking narrows. db-gateway gets `piiScan`: value-based masking of PII inside text columns no field rule covers, off by default, also set with `GATEWAY_PII_SCAN`.

### Patch Changes

- Updated dependencies [[`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1)]:
  - @guardbee/guard-core@0.17.0
  - @guardbee/mcp-document-scanner@0.1.4

## 1.18.1

### Patch Changes

- [#144](https://github.com/GuardBee/guardbee-mcp/pull/144) [`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - PII and secret masking now sees through Unicode look-alikes: fullwidth digits, mathematical bold letters and zero-width characters inside a TC kimlik, IBAN, e-mail or API key no longer bypass the detectors. Detection runs on an NFKC copy with invisible characters removed and maps back to the original text, so unmasked text keeps its original spelling and every spelling of a value gets the same token.
- Updated dependencies [[`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69)]:
  - @guardbee/guard-core@0.16.0
  - @guardbee/mcp-document-scanner@0.1.3

## 1.18.0

### Minor Changes

- [#132](https://github.com/GuardBee/guardbee-mcp/pull/132) [`1084c93`](https://github.com/GuardBee/guardbee-mcp/commit/1084c930bd7218c04adf981e4f34139015beec21) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `guardbee-hook`: the proxy's policy for coding agents' own tools. `guardbee-hook install --claude-code|--cursor` adds PreToolUse/PostToolUse (Claude Code) or shell/MCP/file-read hooks (Cursor). Built-in tools are labelled (secret files and env dumps `sensitive`, curl/git push/publish `egress`, rm -rf/force push `destructive`, web tools `untrusted` + `egress`); credentials on their way out, policy rules (`upstream: claude-code|cursor`) and the lethal-trifecta check run before each call, with the session's taint kept on disk; PII, injected instructions and topic rules are checked on the output. `uninstall` removes only GuardBee's entries.

- [#123](https://github.com/GuardBee/guardbee-mcp/pull/123) [`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `interceptors.documents` (off by default): images, embedded PDFs and resource blobs in tool results and resource reads are scanned for PII and credentials with the new `@guardbee/mcp-document-scanner` (PDF text layer, optional OCR) and withheld (`block`) or logged (`warn`). The shared policy schema accepts the new interceptor.

- [#135](https://github.com/GuardBee/guardbee-mcp/pull/135) [`30d63ce`](https://github.com/GuardBee/guardbee-mcp/commit/30d63ceb2e5e6ef28a42ccc3d85c1c8d25bb9e36) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `listen.ldap`: add LDAP / Active Directory groups to a known caller (OIDC user or LLM gateway key user) for rules, quotas, `llm.access` and budgets — `memberOf` or a group search, CN or DN names, cached, filter values escaped (RFC 4515), bind password from the environment; an unreachable directory answers 503 unless `onError: token-groups`.

- [#122](https://github.com/GuardBee/guardbee-mcp/pull/122) [`30b68a8`](https://github.com/GuardBee/guardbee-mcp/commit/30b68a81311a982b6d6269946a5efe14f58d710a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - LLM gateway: model access control (`llm.access`, `llm.accessDefault`) per user glob or group, with `/models` listing only the caller's models; and sensitive-data routing (`llm.sensitive`) that sends prompts holding personal data or listed topics to a model you run instead, unmasked by default, failing closed when that model has no route for the request's API. Routed requests are audited with `ruleId: llm:route:sensitive` and `llm.routedFrom`.

- [#133](https://github.com/GuardBee/guardbee-mcp/pull/133) [`0a102ab`](https://github.com/GuardBee/guardbee-mcp/commit/0a102ab28827c4fbdc014d947f6887e0a1078c84) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - SIEM export: `audit.exporters` sends every audit event, batched and off the request path, to Splunk HEC, Elasticsearch/OpenSearch (`_bulk` create, event hash as `_id`) or syslog (RFC 5424 over UDP, TCP or TLS; CEF or JSON). Credentials come from environment variables; each destination has its own bounded retry queue. The dashboard sink now shares the same queue.

- [#136](https://github.com/GuardBee/guardbee-mcp/pull/136) [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Security reports: `guardbee-proxy report` builds a periodic report from the audit log (Markdown, HTML or JSON; English or Turkish) with findings mapped to OWASP Top 10 for LLM Applications (2025) and MITRE ATLAS, tied to the audit hash chain and optionally Ed25519-signed; `guardbee-proxy verify-report` checks it. The mapping (`classifyEvent`, `THREAT_CATEGORIES`) lives in guard-core and is shown by threat-rules' new `framework_map` tool.

### Patch Changes

- Updated dependencies [[`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1), [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232)]:
  - @guardbee/guard-core@0.15.0
  - @guardbee/mcp-document-scanner@0.1.1

## 1.17.0

### Minor Changes

- [#120](https://github.com/GuardBee/guardbee-mcp/pull/120) [`32cc61a`](https://github.com/GuardBee/guardbee-mcp/commit/32cc61ac0ba6c5d76c5225849b1cc725253f2c69) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - LLM gateway: a streamed answer that must be rewritten (PII tokens put back, `maskResponses`) now streams incrementally instead of being fetched whole and replayed. Text is held only until a safe cut and rewritten with the text already sent as context, so values split across events are still masked or restored.

## 1.16.0

### Minor Changes

- [#118](https://github.com/GuardBee/guardbee-mcp/pull/118) [`08cc29e`](https://github.com/GuardBee/guardbee-mcp/commit/08cc29e4ca69af9aaf2bcbbde9f31824c9ada5c7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - More PII detectors: passport, SGK/SSK/Bağ-Kur number, MERSİS number, date of birth and postal address (all label-gated), KEP address, and opt-in IP address, MAC address and Turkish vehicle plate (`piiMasking.include`). guard-core exports `PERSONAL_DATA_CATEGORIES` and `OPT_IN_PII`; every new category is counted in `piiHits`.

### Patch Changes

- Updated dependencies [[`08cc29e`](https://github.com/GuardBee/guardbee-mcp/commit/08cc29e4ca69af9aaf2bcbbde9f31824c9ada5c7)]:
  - @guardbee/guard-core@0.14.0

## 1.15.0

### Minor Changes

- [#116](https://github.com/GuardBee/guardbee-mcp/pull/116) [`13c4c8f`](https://github.com/GuardBee/guardbee-mcp/commit/13c4c8f7afb29c7c373f83b1f64ae518edc08a46) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Topic-based policy rules: a `topics` list (terms in Turkish or English, case- and Turkish-letter-insensitive, suffix-tolerant) and a `match.topic` rule field. The proxy checks topic rules on tool arguments and again on tool results, resources and prompts (`deny` withholds, `mask` forces PII masking, `warn` logs, `approve` asks), and on LLM gateway prompts with `tool: llm:<model>`. guard-core exports `detectTopics`, `topicSchema` and `checkTopicReferences`; dashboard policies validate topics too.

### Patch Changes

- Updated dependencies [[`13c4c8f`](https://github.com/GuardBee/guardbee-mcp/commit/13c4c8f7afb29c7c373f83b1f64ae518edc08a46)]:
  - @guardbee/guard-core@0.13.0

## 1.14.0

### Minor Changes

- [#110](https://github.com/GuardBee/guardbee-mcp/pull/110) [`630c6ed`](https://github.com/GuardBee/guardbee-mcp/commit/630c6eda8ef1c0c5ce3995ed95228cfb59315a50) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - LLM API gateway: OpenAI- and Anthropic-compatible endpoints (`/v1/chat/completions`, `/v1/messages`, `/v1/models`) in HTTP mode. Apps use gateway keys instead of provider keys; prompts get injection, credential and PII checks (masking or tokenize, with tokens put back in the answer); request, token and USD budgets per user or gateway; token usage and cost in the audit log. Streaming is supported for both APIs.

## 1.13.2

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/guard-core@0.12.1
  - @guardbee/mcp-telemetry@0.1.4

## 1.13.1

### Patch Changes

- [#68](https://github.com/GuardBee/guardbee-mcp/pull/68) [`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - 38 more secret rules (76 in all): cloud and hosting (Azure AD client secret and storage key, DigitalOcean, Heroku, Fly.io, Cloudflare Origin CA, Supabase, PlanetScale), AI providers (OpenRouter, Groq, Perplexity, Replicate, Hugging Face org), developer tools (GitHub fine-grained, GitLab runner, PyPI, Vault, Terraform Cloud, Pulumi, Doppler, 1Password, age) and SaaS (Stripe webhook, Square, Shopify, Twilio API key, Linear, Notion, Atlassian, Sentry, Grafana, Postman, Discord webhook, Telegram bot). The fixed-format ones are also masked by security-proxy (66 formats, up from 32). Turkish providers iyzico, PayTR, Netgsm and İleti Merkezi are matched on their variable names and marked broad, so the scanner reports them and the proxy does not mask on them.
- Updated dependencies [[`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7)]:
  - @guardbee/guard-core@0.12.0

## 1.13.0

### Minor Changes

- [#57](https://github.com/GuardBee/guardbee-mcp/pull/57) [`16551ca`](https://github.com/GuardBee/guardbee-mcp/commit/16551ca31c9c591792c4a84713cee2622c79ca62) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - OpenTelemetry: each tool call is a `tools/call <tool>` span with MCP semantic-convention attributes, the upstream call is a child span, and every audit event of the call (blocks, toxic flows, approvals, sampling) is a span event. The proxy depends only on `@opentelemetry/api`; with the SDK installed (optional peers, included in the Docker image) and `OTEL_EXPORTER_OTLP_ENDPOINT` set, spans go out over OTLP/HTTP. An SDK the process registered first is left in place.

- [#59](https://github.com/GuardBee/guardbee-mcp/pull/59) [`64aeffa`](https://github.com/GuardBee/guardbee-mcp/commit/64aeffa43ce641738a9858818aa59d88154bf25a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Quotas (`quotas`): caps on tool calls over a fixed window, counted across sessions per user (OIDC; the session without one), per session or for the whole gateway, matched on tool, upstream, label, user and group. Only calls about to reach the upstream count, a call counts against all matching quotas or none, and a full quota refuses with the time to retry. guard-core's policy schema gains `quotas`.

### Patch Changes

- Updated dependencies [[`64aeffa`](https://github.com/GuardBee/guardbee-mcp/commit/64aeffa43ce641738a9858818aa59d88154bf25a)]:
  - @guardbee/guard-core@0.11.0

## 1.12.0

### Minor Changes

- [#55](https://github.com/GuardBee/guardbee-mcp/pull/55) [`20bbdc4`](https://github.com/GuardBee/guardbee-mcp/commit/20bbdc49affdebbbfce869d85176ab3b38aa23ce) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Sampling (`interceptors.sampling`, off by default): servers can ask the agent's model for a completion through the gateway, with guards. A request is answered only during one of that server's tool calls, by the calling session; `includeContext` is forced to `none`; `maxTokens` and requests per call are capped; what the server sends gets the injection scan; `approval` can ask the person first; and the model's answer is checked like egress (credentials and session data block it, personal data is masked). guard-core's policy schema gains `interceptors.sampling`.

### Patch Changes

- Updated dependencies [[`20bbdc4`](https://github.com/GuardBee/guardbee-mcp/commit/20bbdc49affdebbbfce869d85176ab3b38aa23ce)]:
  - @guardbee/guard-core@0.10.0

## 1.11.0

### Minor Changes

- [#52](https://github.com/GuardBee/guardbee-mcp/pull/52) [`659b893`](https://github.com/GuardBee/guardbee-mcp/commit/659b893a82c92f6c579ea50de50b942448c23bea) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Users over HTTP (`listen.oidc`): the proxy accepts JWTs from an OpenID Connect provider next to or instead of API keys, checking signature (JWKS via discovery), issuer, audience and lifetime. Rules can match `user` (glob) and `group`; audit events carry `user`; a session belongs to the user who opened it. A `401` points MCP clients at `/.well-known/oauth-protected-resource` (RFC 9728). guard-core's rule schema gains `match.user` and `match.group`.

### Patch Changes

- Updated dependencies [[`659b893`](https://github.com/GuardBee/guardbee-mcp/commit/659b893a82c92f6c579ea50de50b942448c23bea)]:
  - @guardbee/guard-core@0.9.0

## 1.10.0

### Minor Changes

- [#49](https://github.com/GuardBee/guardbee-mcp/pull/49) [`34ead6f`](https://github.com/GuardBee/guardbee-mcp/commit/34ead6fb45d6b093c441b28c83d73107ff20d0a3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Credentials leaving (`interceptors.egressSecrets`, on by default): before an `egress` tool runs, the arguments it would actually receive are checked for provider keys, private keys and connection strings with a password (the fixed-format rules PII masking uses). `block` refuses the call, `warn` logs it, and the audit event has the credential masked either way. `allowTools` exempts tools by glob. guard-core's policy schema gains `interceptors.egressSecrets`.

### Patch Changes

- Updated dependencies [[`34ead6f`](https://github.com/GuardBee/guardbee-mcp/commit/34ead6fb45d6b093c441b28c83d73107ff20d0a3)]:
  - @guardbee/guard-core@0.8.0

## 1.9.0

### Minor Changes

- [#47](https://github.com/GuardBee/guardbee-mcp/pull/47) [`aa299d3`](https://github.com/GuardBee/guardbee-mcp/commit/aa299d3d3343bfbf48bc36b78036d7d7cb1565ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool poisoning at `tools/list` (`interceptors.toolPoisoning`, on by default): the gateway scans each tool definition before the agent sees it and, in `block` mode, hides a tool with a critical or high finding and refuses its calls; medium findings warn. The catalog rules move from tool-poisoning-scanner into guard-core (`scanToolCatalog`, `DESCRIPTION_INJECTION_PATTERNS`, …), which tool-poisoning-scanner re-exports unchanged. `mixed_script_in_description` now flags only a word that mixes Latin with Cyrillic or Greek letters, not a description written in another script next to Latin words.

### Patch Changes

- Updated dependencies [[`aa299d3`](https://github.com/GuardBee/guardbee-mcp/commit/aa299d3d3343bfbf48bc36b78036d7d7cb1565ed)]:
  - @guardbee/guard-core@0.7.0

## 1.8.0

### Minor Changes

- [#45](https://github.com/GuardBee/guardbee-mcp/pull/45) [`b8dee60`](https://github.com/GuardBee/guardbee-mcp/commit/b8dee60a6092f16ba1442cafafa60fa842cffd42) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool exposure (`tools`): `expose` (allowlist of globs) and `hide` take tools out of `tools/list`, and calls to a hidden tool are refused and count toward `anomaly.repeatedBlocks`. `descriptions` replaces a tool's description with one you wrote. guard-core's policy schema gains `tools`, so the dashboard can set it too. Also: `interceptors.anomaly` now follows dashboard policy updates in running sessions instead of only at session start.

### Patch Changes

- Updated dependencies [[`b8dee60`](https://github.com/GuardBee/guardbee-mcp/commit/b8dee60a6092f16ba1442cafafa60fa842cffd42)]:
  - @guardbee/guard-core@0.6.0

## 1.7.1

### Patch Changes

- [#42](https://github.com/GuardBee/guardbee-mcp/pull/42) [`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.

## 1.7.0

### Minor Changes

- [#40](https://github.com/GuardBee/guardbee-mcp/pull/40) [`b1de97f`](https://github.com/GuardBee/guardbee-mcp/commit/b1de97f5cbeaf1951798970a56917b8378b45848) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Anomaly checks for the gateway (`interceptors.anomaly`): per-session sliding-window limits on call bursts, sweeps of distinct sensitive reads, bulk destructive calls, and repeated blocked or declined calls. `warn` logs the first trip of each check; `block` refuses calls over the limit, and after repeated blocks locks the session. Events reuse the `warn`/`blocked` types with `ruleId: anomaly:<check>`, so the dashboard ingest accepts them unchanged. guard-core's policy schema gains `interceptors.anomaly`. Off unless configured.

### Patch Changes

- Updated dependencies [[`b1de97f`](https://github.com/GuardBee/guardbee-mcp/commit/b1de97f5cbeaf1951798970a56917b8378b45848)]:
  - @guardbee/guard-core@0.5.0

## 1.6.0

### Minor Changes

- [#24](https://github.com/GuardBee/guardbee-mcp/pull/24) [`75f4bad`](https://github.com/GuardBee/guardbee-mcp/commit/75f4baddd164e252be4f8004e2ec8e0054cbd218) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Data-based taint: `taint.basis: data` treats an egress call as a toxic flow only when its arguments carry sensitive data the session saw (hashed fingerprints of PII, credentials, id-like tokens and 12+ word passages; PII tokens count as their values), not merely because the session touched untrusted and sensitive content. The block message names the tool the data came from. The default `capability` basis keeps today's behaviour and adds the same evidence to its reason when found. guard-core's policy schema gains `taint.basis`.

### Patch Changes

- Updated dependencies [[`75f4bad`](https://github.com/GuardBee/guardbee-mcp/commit/75f4baddd164e252be4f8004e2ec8e0054cbd218)]:
  - @guardbee/guard-core@0.4.0

## 1.5.0

### Minor Changes

- [#21](https://github.com/GuardBee/guardbee-mcp/pull/21) [`9015a52`](https://github.com/GuardBee/guardbee-mcp/commit/9015a52368228a357519a977d3ef7809b082633a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Audit events for tool responses and resource reads that contained personal data now carry `piiHits`: a count per category (`tc_kimlik`, `vkn`, `iban`, `credit_card`, `email`, `phone_tr`, and `secret` for credentials). Counts only, never values; counted even with masking off. The GuardBee dashboard's KVKK report is built from them.

## 1.4.0

### Minor Changes

- [#19](https://github.com/GuardBee/guardbee-mcp/pull/19) [`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Central policy from the GuardBee dashboard.
  
  guard-core: `gatewayPolicySchema`, `policyShape` and `validatePolicy` describe the gateway policy document (labels, rules, taint, approval, defaults, interceptors). security-proxy builds its YAML schema from them, and the dashboard validates an edit with the same schema before saving it. guard-core now depends on zod.
  
  security-proxy: `policy: { source: dashboard, refreshSeconds }` (needs `audit.dashboard`) takes the policy from the workspace policy in the dashboard. Upstreams, listen and audit stay local. The proxy fetches it at start and re-checks it with an ETag; an update applies to the next call in every session. With no dashboard policy, an unreachable dashboard or an invalid document it keeps the local or last good policy. Approval settings are now read per request, so a policy update changes them mid-session too.

### Patch Changes

- Updated dependencies [[`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35)]:
  - @guardbee/guard-core@0.3.0

## 1.3.0

### Minor Changes

- [#17](https://github.com/GuardBee/guardbee-mcp/pull/17) [`dac242d`](https://github.com/GuardBee/guardbee-mcp/commit/dac242dbcf7258039ca4bd7c6d44059e420b6a36) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Approvals in the GuardBee dashboard.
  
  `approval.channels: [elicitation, dashboard]` (with `audit.dashboard` configured) sends an approval request to the dashboard when the client cannot show a prompt. The arguments go PII-masked, the dashboard notifies workspace owners and admins, and the proxy polls until the request is approved, denied or expired, or `timeoutSeconds` passes. Channels are tried in order; a channel that cannot ask (no elicitation support, dashboard unreachable) falls through to the next one. Requires app.guardbee.ai with the gateway approvals endpoint.

## 1.2.0

### Minor Changes

- [#15](https://github.com/GuardBee/guardbee-mcp/pull/15) [`7891f8d`](https://github.com/GuardBee/guardbee-mcp/commit/7891f8d095937d6cb6329b948fbc957772e788b7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Remote mode: the gateway over Streamable HTTP.
  
  - `listen: { transport: http, host, port, path, apiKeys, maxSessions }` serves the proxy over Streamable HTTP. Each MCP session gets its own taint state, PII tokens and tool pins; all sessions share the upstream connections. Listening beyond loopback without `apiKeys` is a config error; keys are checked in constant time. `GET /healthz` reports the session count.
  - Upstreams can be remote Streamable HTTP servers: `url` plus optional `headers` (with `${VAR}` references).
  - `audit.dashboard` sends audit events in batches to the GuardBee dashboard with a workspace API key read from `apiKeyEnv`. Events wait in memory while the dashboard is unreachable; tool calls never wait for it. Events now carry `sessionId` in HTTP mode.
  - `init` also moves Streamable HTTP servers behind the proxy; SSE servers stay and are reported.
  - A shared upstream now fans its `tools/list_changed` notification out to every session; before, only the most recent listener received it.
  - Dockerfile for running the proxy as a service.

## 1.1.1

### Patch Changes

- Docs: add a Simplified Chinese README (`ZH.md`) and link it from the English and Turkish ones. Correct stale counts (secret-scanner: 38 patterns and 39 tests; prompt-injection-scanner: 45 tests) and add a Turkish README for guard-core. No code changes.
- Updated dependencies [`243991e`]:
  - @guardbee/guard-core@0.2.1

## 1.1.0

### Minor Changes

- Shared detectors: one injection rule set, provider secrets, Turkish identifiers.
  
  guard-core
  - `INJECTION_RULES`: the prompt-injection-scanner rules and the security-proxy 0.x phrases in one list (27 rules). New: Turkish instruction override and prompt extraction, `DAN mode`, "bypass safety/guardrails", `<system>` tags, Unicode tag-character smuggling (flag emoji excluded), bidi control characters. `findInjections` also decodes base64 runs that turn into readable text and checks them.
  - Each rule is precise or `broad`. `scanForPromptInjection` blocks only on a precise high/critical rule and warns on the rest.
  - `SECRET_RULES`: the secret-scanner provider formats, moved here.
  - PII masking now covers private key blocks (whole BEGIN…END), connection strings with passwords, 22 provider key and token formats, and VKN (check digit plus a `VKN` / `Vergi No` label). Phone numbers must have a Turkish mobile, landline or 850 code and a +90 / 0 prefix or space/dash grouping, and must not sit inside a URL or id; the generic API-key rule needs a separator and both letters and digits (`tokenization1234567890ab` is no longer masked).
  - New validators: `isValidVkn`, `isValidTrPhone`.
  
  security-proxy
  - Uses the shared rules. A generic phrase alone ("act as", "you are now", "developer mode", "jailbreak", "override policy") now warns instead of blocking; in 1.0 a tool result saying "act as a reverse proxy" was blocked.
  - Masks provider keys, private keys, connection strings and VKN. A 10-digit number that cannot be a Turkish phone number is no longer masked as one, and no longer marks the session as holding sensitive data.
  
  prompt-injection-scanner: 17 rules instead of 10 (the precise ones from guard-core). The HTML-comment and CSS-hidden rules no longer fire on `<!-- prettier-ignore -->`, on a comment that merely mentions "instructions", or on `background-color: white`: they now need instruction-like language ("ignore all/the/previous …", "system prompt", "AI:"). Measured on 1,610 package READMEs, blocking findings went from 20 files to 0.
  
  secret-scanner: rules now come from guard-core; no change in what it reports.

### Patch Changes

- Updated dependencies [`15fb399`]:
  - @guardbee/guard-core@0.2.0

## 1.0.0

### Major Changes

- security-proxy 1.0: gateway mode.
  
  - `guardbee-proxy.yaml` puts several MCP servers behind one proxy. Tools and prompts are exposed as `<upstream>__<tool>`; one failing server no longer hides the others' tools.
  - Policy rules (`allow` / `deny` / `mask` / `warn`) match on tool glob, upstream, label and session taint; the first match wins.
  - Toxic-flow (lethal trifecta) tracking across servers: once a session has read untrusted content and sensitive data, an egress call is blocked (`taint.mode: strict`, the YAML default) or logged (`warn`).
  - `resources/read` is now scanned for injection, PII-masked, and counted as untrusted content.
  - The audit log is hash-chained (`guardbee-proxy verify-audit <file>`). With the YAML config it stores a SHA-256 of the arguments instead of the arguments, and no results, unless `audit.includePayloads: true`.
  - New `guardbee-proxy validate` command.
  
  The single-server `guardbee-proxy -- <command>` form and `guardbee-proxy.json` keep their 0.x behavior: unprefixed tool names, payloads logged, toxic flows only warned.
  
  toxic-flow-auditor: tool names in snake_case are now classified word by word (`read_vault_secret` is sensitive, `drop_table` destructive), and pull requests count as exfiltration. Catalogs may report more findings than before.

### Minor Changes

- Move shared detectors into the new `@guardbee/guard-core` library.
  
  security-proxy now validates PII matches before masking them: a TC Kimlik No must pass the official checksum, an IBAN must pass mod-97, and a card number must pass Luhn. Order numbers and other 11- or 16-digit values are no longer masked by mistake.
  
  toxic-flow-auditor and prompt-leak-scanner now import tool classification and checksum validators from guard-core. prompt-leak-scanner behaves as before; for toxic-flow-auditor see the snake_case classification fix.

- Gateway: approvals, tokenized PII, `init`.
  
  - `approve` action and `taint.mode: approve`: the person answers a yes/no form through MCP elicitation; decline, cancel, a timeout (`approval.timeoutSeconds`, default 120) or a client without elicitation all block the call.
  - `interceptors.piiMasking.mode: tokenize`: the model sees session tokens such as `<pii:tc_kimlik:7f3a9b21>`, and the proxy puts the real value back when the token is passed to another tool — never to an `egress` tool unless `detokenizeForEgress: true`.
  - Rules can match on `args` (dotted path → value, strings are globs), and `mask.fields` blanks named JSON keys in text and `structuredContent`.
  - PII in `structuredContent` is now masked; before, only text content was.
  - `prompts/get` results get the injection scan and PII masking.
  - `definitionDrift.recheck: on-change` re-lists a server's tools only after it sends `tools/list_changed`; the proxy relays that notification to the agent.
  - `guardbee-proxy init --client claude-desktop|cursor|claude-code` (or `--file`) moves stdio servers into `guardbee-proxy.yaml`, backs up the client config and points it at the proxy.

### Patch Changes

- `guardbee-proxy` now starts with a `#!/usr/bin/env node` line. Without it, `npx @guardbee/mcp-security-proxy` (and the installed bin) ran the file as a shell script and failed to start (seen on 0.3.1).

## 0.3.0

### Minor Changes

- [#6](https://github.com/GuardBee/guardbee-mcp/pull/6) [`7f0e01f`](https://github.com/GuardBee/guardbee-mcp/commit/7f0e01f9b15e033928c395ccffbb0118842a604c) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add an MCP client-config auditor, live tool-catalog poisoning checks, cross-server tool shadowing, and proxy guards for tool-result injection and mid-session definition drift. Findings that these checks emit carry OWASP MCP Top 10 tags.

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3

## 0.2.2

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.2

## 0.2.1

### Patch Changes

- Make English the primary `README.md` (what npm and GitHub display by default) for every package, matching the change already made for `db-gateway`. The previous Turkish content moves to `TR.md`, linked via a language switcher at the top of both files. Docs-only change, no code/behavior changes.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.1

## 0.2.0

### Minor Changes

- [`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add usage telemetry via the new `@guardbee/mcp-telemetry` shared package — **on by default**, disable with `GUARDBEE_TELEMETRY=0`. Every tool call reports the tool name, a shape-preserving-redacted version of its parameters, success/failure, and duration to `app.guardbee.ai`.
  
  Redaction (`redactParams`, see `@guardbee/mcp-telemetry`'s README) replaces any string longer than 40 characters, and the value of any `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` key regardless of length, with a `"[redacted: ...]"` placeholder — full file/scan content and real row data are never sent, only short structural parameters like table names or limits. A one-time notice is printed to stderr on first use explaining this and how to opt out. This is a behavior change (these packages now make an outbound network call by default) — previously most of them advertised running entirely offline.

### Patch Changes

- [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add Smithery.ai integration files (`smithery.yaml`, `manifest.json`, `.well-known/mcp/server-card.json`), matching the pattern already used by `@guardbee/mcp-db-gateway`, so these servers are one-click installable from Smithery and discoverable via their MCP server card. No functional/runtime code changes — these files are read from the GitHub repo by Smithery, not from the published npm tarball (`package.json` `files` is unchanged).
