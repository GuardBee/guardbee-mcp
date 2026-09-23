import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanEndpoint } from "./scanner.js";
import type { EndpointScanResult } from "./scanner.js";

function formatResult(result: EndpointScanResult): string {
  const lines: string[] = [
    `Target: ${result.target}  (detected: ${result.detectedType}, reachable: ${result.reachable ? "yes" : "no"}, ${result.durationMs}ms)`,
    "",
  ];

  const issues = result.findings.filter((f) => f.severity !== "info");
  if (issues.length === 0) {
    lines.push("✅ No unauthenticated-access findings.");
  } else {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of issues) if (f.severity in counts) counts[f.severity as keyof typeof counts]++;
    lines.push(`⚠️  ${issues.length} finding(s) — Critical: ${counts.critical}  High: ${counts.high}  Medium: ${counts.medium}  Low: ${counts.low}`);
  }
  lines.push("");

  for (const f of result.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.code}`);
    lines.push(`  ${f.message}`);
    lines.push(`  Recommendation: ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-vector-store-scanner",
    version: "0.1.0",
  });
  instrumentServer(server, "vector-store-scanner");

  server.tool(
    "scan_endpoint",
    "Probe a vector-database (or vector-index-capable) endpoint for unauthenticated exposure — Weaviate, Qdrant, Chroma, Elasticsearch/OpenSearch (HTTP fingerprinting, escalating from instance info → collection/schema listing → actual stored data), Redis (RESP PING without AUTH), and Postgres/pgvector (wire-protocol SSLRequest + StartupMessage handshake, no real credentials sent). Read-only — never writes or authenticates with real credentials.",
    {
      host: z.string().describe("Hostname or IP of the endpoint to probe"),
      port: z.number().optional().describe("Port to probe (defaults to the store type's conventional port, e.g. 6333 for Qdrant)"),
      type: z.enum(["auto", "weaviate", "qdrant", "chroma", "elasticsearch", "redis", "postgres"]).optional().describe("Store type to probe for. 'auto' (default) fingerprints the endpoint by trying each known type in turn."),
      tls: z.boolean().optional().describe("Use https:// for HTTP-based probes (Weaviate/Qdrant/Chroma/Elasticsearch). Default: false"),
      timeoutMs: z.number().optional().describe("Per-request timeout in milliseconds (default: 4000)"),
    },
    async ({ host, port, type, tls, timeoutMs }) => {
      const result = await scanEndpoint({ host, port, type, tls, timeoutMs });
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "list_patterns",
    "List the vector-store types this scanner can fingerprint, and what unauthenticated-access checks it runs for each",
    {},
    async () => {
      const lines = [
        "Supported store types and checks:\n",
        "[weaviate] (default port 8080, HTTP)",
        "  • /v1/meta readable without auth (medium)",
        "  • /v1/schema readable without auth — reveals class names (high)",
        "  • /v1/objects returns real data without auth (critical)",
        "",
        "[qdrant] (default port 6333, HTTP)",
        "  • / instance info readable without auth (medium)",
        "  • /collections readable without auth — reveals collection names (high)",
        "  • /collections/<name>/points/scroll returns real data without auth (critical)",
        "",
        "[chroma] (default port 8000, HTTP)",
        "  • heartbeat reachable without auth (medium)",
        "  • /collections readable without auth (high)",
        "",
        "[elasticsearch] (Elasticsearch/OpenSearch, default port 9200, HTTP)",
        "  • cluster info readable without auth (medium)",
        "  • /_cat/indices readable without auth — reveals index names (high)",
        "  • /<index>/_search returns real documents without auth (critical)",
        "",
        "[redis] (default port 6379, raw RESP TCP)",
        "  • PING accepted without AUTH — full keyspace read/write, including any RediSearch/RedisVL vector index (critical)",
        "",
        "[postgres] (pgvector-capable Postgres, default port 5432, raw wire-protocol TCP)",
        "  • SSLRequest handshake — checks whether TLS is offered (medium if not)",
        "  • StartupMessage — checks whether AuthenticationOk is returned with no password challenge (critical)",
        "",
        "All checks are read-only probes; no real credentials or write operations are ever sent.",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
