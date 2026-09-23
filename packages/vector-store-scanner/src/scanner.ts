import { createConnection } from "net";
import { probeWeaviate, probeQdrant, probeChroma, probeElasticsearch } from "./httpProbes.js";
import { probeRedis, probePostgres } from "./tcpProbes.js";
import { mkFinding, type Finding, type ProbeOutcome } from "./types.js";

export type StoreType = "weaviate" | "qdrant" | "chroma" | "elasticsearch" | "redis" | "postgres";

export interface ScanEndpointOptions {
  host: string;
  port?: number;
  type?: "auto" | StoreType;
  tls?: boolean;
  timeoutMs?: number;
}

export interface EndpointScanResult {
  target: string;
  detectedType: string;
  reachable: boolean;
  findings: Finding[];
  durationMs: number;
}

const DEFAULT_PORTS: Record<StoreType, number> = {
  weaviate: 8080,
  qdrant: 6333,
  chroma: 8000,
  elasticsearch: 9200,
  redis: 6379,
  postgres: 5432,
};

const HTTP_PROBES: Record<"weaviate" | "qdrant" | "chroma" | "elasticsearch", (baseUrl: string, timeoutMs: number) => Promise<ProbeOutcome>> = {
  weaviate: probeWeaviate,
  qdrant: probeQdrant,
  chroma: probeChroma,
  elasticsearch: probeElasticsearch,
};

function isTcpReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function scanEndpoint(options: ScanEndpointOptions): Promise<EndpointScanResult> {
  const start = Date.now();
  const { host, type = "auto", tls = false, timeoutMs = 4000 } = options;

  if (type !== "auto") {
    const port = options.port ?? DEFAULT_PORTS[type];
    const target = `${host}:${port}`;

    if (type in HTTP_PROBES) {
      const baseUrl = `${tls ? "https" : "http"}://${host}:${port}`;
      const result = await HTTP_PROBES[type as keyof typeof HTTP_PROBES](baseUrl, timeoutMs);
      if (!result.matched) {
        return {
          target,
          detectedType: "unknown",
          reachable: await isTcpReachable(host, port, timeoutMs),
          findings: [mkFinding("type_mismatch", `Endpoint did not respond like a ${type} instance — the fingerprint check failed`, "info", "Verify the host/port and store type; this endpoint may be a different service or unreachable.")],
          durationMs: Date.now() - start,
        };
      }
      return { target, detectedType: type, reachable: true, findings: result.findings, durationMs: Date.now() - start };
    }

    const tcpProbe = type === "redis" ? probeRedis : probePostgres;
    const result = await tcpProbe(host, port, timeoutMs);
    if (!result.matched) {
      return {
        target,
        detectedType: "unknown",
        reachable: await isTcpReachable(host, port, timeoutMs),
        findings: [mkFinding("type_mismatch", `Endpoint did not respond like a ${type} instance — the fingerprint check failed`, "info", "Verify the host/port and store type; this endpoint may be a different service or unreachable.")],
        durationMs: Date.now() - start,
      };
    }
    return { target, detectedType: type, reachable: true, findings: result.findings, durationMs: Date.now() - start };
  }

  // auto-detect: try each known HTTP-based store's fingerprint in turn
  for (const [name, probe] of Object.entries(HTTP_PROBES) as Array<[keyof typeof HTTP_PROBES, (typeof HTTP_PROBES)[keyof typeof HTTP_PROBES]]>) {
    const port = options.port ?? DEFAULT_PORTS[name];
    const baseUrl = `${tls ? "https" : "http"}://${host}:${port}`;
    const result = await probe(baseUrl, timeoutMs);
    if (result.matched) {
      return { target: `${host}:${port}`, detectedType: name, reachable: true, findings: result.findings, durationMs: Date.now() - start };
    }
  }

  const redisPort = options.port ?? DEFAULT_PORTS.redis;
  const redisResult = await probeRedis(host, redisPort, timeoutMs);
  if (redisResult.matched) {
    return { target: `${host}:${redisPort}`, detectedType: "redis", reachable: true, findings: redisResult.findings, durationMs: Date.now() - start };
  }

  const pgPort = options.port ?? DEFAULT_PORTS.postgres;
  const pgResult = await probePostgres(host, pgPort, timeoutMs);
  if (pgResult.matched) {
    return { target: `${host}:${pgPort}`, detectedType: "postgres", reachable: true, findings: pgResult.findings, durationMs: Date.now() - start };
  }

  const fallbackPort = options.port ?? 80;
  const reachable = await isTcpReachable(host, fallbackPort, timeoutMs);
  return {
    target: `${host}:${fallbackPort}`,
    detectedType: "unknown",
    reachable,
    findings: reachable
      ? [mkFinding("unknown_service", "Port is reachable but didn't match any known vector-store fingerprint", "info", "Specify the store type explicitly with `type` if you know what's running here.")]
      : [],
    durationMs: Date.now() - start,
  };
}
