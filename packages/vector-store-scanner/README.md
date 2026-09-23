# @guardbee/mcp-vector-store-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that probes a vector-database (or vector-index-capable) endpoint for **unauthenticated exposure** — the same class of misconfiguration behind repeated real-world incidents of open Elasticsearch/MongoDB/Redis instances leaking data, now aimed at the RAG-era stack: Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch, Redis, and Postgres/pgvector.

Every RAG pipeline's embeddings live somewhere. If that vector store is reachable on the network without authentication, anyone who finds it can read (and often write) every document your retrieval pipeline was ever given — including anything sensitive that made it into a chunk.

> This package sends usage telemetry by default (tool name + short parameters, the probed host/response contents are never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► vector-store-scanner ──► Your vector-store endpoint
              │
              ├─ weaviate / qdrant / chroma / elasticsearch  (HTTP fingerprint)
              │     info ──► schema/collections ──► actual stored data
              ├─ redis        (raw RESP: PING, no AUTH sent)
              └─ postgres     (raw wire protocol: SSLRequest + StartupMessage, no password sent)
```

---

## How it escalates

Each HTTP-based probe doesn't stop at "is this thing up" — it walks the same path an attacker would, in increasing order of impact, and only reports what actually succeeded:

1. **Instance info** (medium) — version/build details readable without auth. Low impact alone, but confirms the service is exposed and helps fingerprint known CVEs.
2. **Schema / collection listing** (high) — class or collection names readable without auth. Reveals your data model even before any real data is read.
3. **Actual stored data** (critical) — a real object/point/document comes back without auth. This is the finding that matters: your embeddings (and whatever they were built from) are readable by anyone who can reach this port.

Redis and Postgres get the same treatment via their native wire protocols instead of HTTP — a `PING` (Redis) or a `StartupMessage` (Postgres) is enough to learn whether authentication is enforced, without ever sending a real password. **No credential is ever guessed, brute-forced, or sent** — every check here is read-only fingerprinting, the same category of probing `dns-intelligence` and `ssl-inspector` already do elsewhere in this monorepo.

---

## Features

- **6 target types**: Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch (HTTP), Redis (raw RESP), Postgres/pgvector (raw wire protocol)
- **Auto-detection** — fingerprints the endpoint by trying each known type in turn when `type` isn't specified
- **From-scratch protocol implementations** for Redis and Postgres — no client library dependency, no real credentials ever sent, includes a TLS-upgrade path for Postgres's `SSLRequest` handshake
- Escalating checks (info → schema → data) so a "critical" finding always means real data was actually read, not just that a port responded
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 22 unit tests against local mock HTTP/TCP servers, covering every probe's matched/unmatched fingerprint and each escalation level

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-vector-store-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-vector-store-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-vector-store-scanner scan my-qdrant.internal --type=qdrant --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_endpoint` | Probes a single host/port for unauthenticated exposure |
| `list_patterns` | Lists the supported store types and what each check looks for |

---

## What it catches

| Store | Check | Severity |
|---|---|---|
| Weaviate | `/v1/meta` readable without auth | medium |
| Weaviate | `/v1/schema` readable without auth — reveals class names | high |
| Weaviate | `/v1/objects` returns real data without auth | critical |
| Qdrant | `/` instance info readable without auth | medium |
| Qdrant | `/collections` readable without auth | high |
| Qdrant | `/collections/<name>/points/scroll` returns real data without auth | critical |
| Chroma | heartbeat reachable without auth | medium |
| Chroma | `/collections` readable without auth | high |
| Elasticsearch/OpenSearch | cluster info readable without auth | medium |
| Elasticsearch/OpenSearch | `/_cat/indices` readable without auth | high |
| Elasticsearch/OpenSearch | `/<index>/_search` returns real documents without auth | critical |
| Redis | `PING` accepted without `AUTH` | critical |
| Postgres/pgvector | no TLS offered | medium |
| Postgres/pgvector | `AuthenticationOk` with no password challenge | critical |

---

## Configuration (`guardbee.yml`)

```yaml
vector-store-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  timeout-ms: 4000
```

---

## Limitations (by design)

- Chroma's actual-document read isn't checked — its data-read API varies significantly across versions, so this scanner stops at the collection-listing level for it (still enough to detect the primary "no auth at all" misconfiguration).
- Milvus isn't supported — its primary API is gRPC, which doesn't fingerprint via a lightweight probe the way the others do.
- This checks for **unauthenticated read access**, not authorization bugs behind a working auth layer (e.g. a valid-but-overprivileged API key) — that's out of scope for an external, credential-less probe.

---

## Development

```bash
npm run build
npm test             # 22 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
