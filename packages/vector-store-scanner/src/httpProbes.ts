import { mkFinding, type Finding, type ProbeOutcome } from "./types.js";

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<{ status: number; json: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every probe below is a read-only, unauthenticated request — no credentials are
 * ever sent. Each one first fingerprints the endpoint (so a mismatched target
 * returns `matched: false` instead of a false positive), then, only if the
 * fingerprint succeeds, checks progressively more sensitive endpoints: instance
 * info → schema/collection listing → actual stored data. A finding at the
 * "data" level means anyone who can reach this port can read real embeddings.
 */

export async function probeWeaviate(baseUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  const meta = await fetchJson(`${baseUrl}/v1/meta`, timeoutMs);
  const metaJson = meta?.json as { version?: string } | null;
  if (!meta || meta.status !== 200 || !metaJson?.version) {
    return { matched: false, findings: [] };
  }

  const findings: Finding[] = [
    mkFinding(
      "weaviate_unauthenticated_meta",
      `Weaviate instance metadata (version ${metaJson.version}) is readable without authentication`,
      "medium",
      "Enable AUTHENTICATION_APIKEY_ENABLED or OIDC auth on this Weaviate instance — version/build info helps an attacker pick a known exploit."
    ),
  ];

  const schema = await fetchJson(`${baseUrl}/v1/schema`, timeoutMs);
  const schemaJson = schema?.json as { classes?: Array<{ class: string }> } | null;
  const classes = schemaJson?.classes?.map((c) => c.class) ?? [];

  if (schema && schema.status === 200 && classes.length > 0) {
    findings.push(mkFinding(
      "weaviate_unauthenticated_schema",
      `Schema readable without authentication — ${classes.length} class(es) exposed: ${classes.slice(0, 5).join(", ")}${classes.length > 5 ? ", ..." : ""}`,
      "high",
      "The schema reveals your data model (class/property names) to anyone who can reach this endpoint. Enable authentication before exposing this instance."
    ));

    const objects = await fetchJson(`${baseUrl}/v1/objects?limit=1&class=${encodeURIComponent(classes[0])}`, timeoutMs);
    const objectsJson = objects?.json as { objects?: unknown[] } | null;
    if (objects && objects.status === 200 && Array.isArray(objectsJson?.objects) && objectsJson.objects.length > 0) {
      findings.push(mkFinding(
        "weaviate_unauthenticated_data",
        `Actual object data is readable without authentication (sampled class "${classes[0]}")`,
        "critical",
        "Anyone who can reach this endpoint can read your embedded data and vectors. Enable authentication immediately and restrict network access."
      ));
    }
  }

  return { matched: true, findings, detail: { version: metaJson.version, classes } };
}

export async function probeQdrant(baseUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  const root = await fetchJson(`${baseUrl}/`, timeoutMs);
  const rootJson = root?.json as { title?: string; version?: string } | null;
  if (!root || root.status !== 200 || !rootJson?.title?.toLowerCase().includes("qdrant")) {
    return { matched: false, findings: [] };
  }

  const findings: Finding[] = [
    mkFinding(
      "qdrant_unauthenticated_info",
      `Qdrant instance info (version ${rootJson.version ?? "unknown"}) is readable without authentication`,
      "medium",
      "Set the `api-key` config option (or QDRANT__SERVICE__API_KEY env var) to require authentication."
    ),
  ];

  const collections = await fetchJson(`${baseUrl}/collections`, timeoutMs);
  const collJson = collections?.json as { result?: { collections?: Array<{ name: string }> } } | null;
  const names = collJson?.result?.collections?.map((c) => c.name) ?? [];

  if (collections && collections.status === 200 && names.length > 0) {
    findings.push(mkFinding(
      "qdrant_unauthenticated_collections",
      `Collection list readable without authentication — ${names.length} collection(s): ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""}`,
      "high",
      "Collection names reveal what data this instance holds. Require an API key before exposing this instance."
    ));

    const scroll = await fetchJson(`${baseUrl}/collections/${encodeURIComponent(names[0])}/points/scroll`, timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, with_payload: true, with_vector: false }),
    });
    const scrollJson = scroll?.json as { result?: { points?: unknown[] } } | null;
    if (scroll && scroll.status === 200 && Array.isArray(scrollJson?.result?.points) && scrollJson.result.points.length > 0) {
      findings.push(mkFinding(
        "qdrant_unauthenticated_data",
        `Actual point data is readable without authentication (sampled collection "${names[0]}")`,
        "critical",
        "Anyone who can reach this endpoint can read your stored vectors/payloads. Set an API key immediately and restrict network access."
      ));
    }
  }

  return { matched: true, findings, detail: { collections: names } };
}

export async function probeChroma(baseUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  let heartbeat = await fetchJson(`${baseUrl}/api/v1/heartbeat`, timeoutMs);
  let apiBase = `${baseUrl}/api/v1`;

  if (!heartbeat || heartbeat.status !== 200) {
    heartbeat = await fetchJson(`${baseUrl}/api/v2/heartbeat`, timeoutMs);
    apiBase = `${baseUrl}/api/v2`;
  }
  if (!heartbeat || heartbeat.status !== 200) {
    return { matched: false, findings: [] };
  }

  const findings: Finding[] = [
    mkFinding(
      "chroma_unauthenticated_heartbeat",
      "Chroma instance is reachable and responds without authentication",
      "medium",
      "Set CHROMA_SERVER_AUTH_PROVIDER (token or basic auth) so the instance requires credentials."
    ),
  ];

  const collections = await fetchJson(`${apiBase}/collections`, timeoutMs);
  const list = Array.isArray(collections?.json) ? (collections!.json as unknown[]) : [];
  if (collections && collections.status === 200 && list.length > 0) {
    findings.push(mkFinding(
      "chroma_unauthenticated_collections",
      `Collection list readable without authentication — ${list.length} collection(s)`,
      "high",
      "Collection metadata reveals what data this instance holds. Require authentication before exposing this instance."
    ));
  }

  return { matched: true, findings, detail: { collections: list.length } };
}

export async function probeElasticsearch(baseUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  const root = await fetchJson(`${baseUrl}/`, timeoutMs);
  const rootJson = root?.json as { cluster_name?: string; version?: { number?: string } } | null;
  if (!root || root.status !== 200 || !rootJson?.cluster_name || !rootJson?.version?.number) {
    return { matched: false, findings: [] };
  }

  const findings: Finding[] = [
    mkFinding(
      "es_unauthenticated_info",
      `Elasticsearch/OpenSearch cluster info (cluster "${rootJson.cluster_name}", version ${rootJson.version.number}) is readable without authentication`,
      "medium",
      "Enable security features (xpack.security.enabled, or the OpenSearch security plugin) and require authentication."
    ),
  ];

  const indices = await fetchJson(`${baseUrl}/_cat/indices?format=json`, timeoutMs);
  const idxList = Array.isArray(indices?.json) ? (indices!.json as Array<{ index: string }>).map((i) => i.index) : [];

  if (indices && indices.status === 200 && idxList.length > 0) {
    findings.push(mkFinding(
      "es_unauthenticated_indices",
      `Index list readable without authentication — ${idxList.length} index/indices: ${idxList.slice(0, 5).join(", ")}${idxList.length > 5 ? ", ..." : ""}`,
      "high",
      "Index names often reveal what data this cluster holds, including any dense_vector/RAG indices. Require authentication before exposing this cluster."
    ));

    const firstUserIndex = idxList.find((n) => !n.startsWith("."));
    if (firstUserIndex) {
      const search = await fetchJson(`${baseUrl}/${encodeURIComponent(firstUserIndex)}/_search?size=1`, timeoutMs);
      const searchJson = search?.json as { hits?: { hits?: unknown[] } } | null;
      if (search && search.status === 200 && Array.isArray(searchJson?.hits?.hits) && searchJson.hits.hits.length > 0) {
        findings.push(mkFinding(
          "es_unauthenticated_data",
          `Actual document data is readable without authentication (sampled index "${firstUserIndex}")`,
          "critical",
          "Anyone who can reach this endpoint can read your indexed documents/vectors. Enable authentication immediately and restrict network access."
        ));
      }
    }
  }

  return { matched: true, findings, detail: { indices: idxList } };
}
