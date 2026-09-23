import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { probeWeaviate, probeQdrant, probeChroma, probeElasticsearch } from "../httpProbes.js";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  }
});

function serveJson(routes: Record<string, unknown>): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const body = routes[path] ?? routes[req.url ?? "/"];
      if (body === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => {
      resolve((server!.address() as { port: number }).port);
    });
  });
}

describe("probeWeaviate", () => {
  it("eşleşmeyen bir endpoint'te matched:false döner", async () => {
    const port = await serveJson({ "/": { hello: "world" } });
    const result = await probeWeaviate(`http://127.0.0.1:${port}`, 1000);
    expect(result.matched).toBe(false);
  });

  it("auth'suz meta+schema+data'yı escalating severity ile bulur", async () => {
    const port = await serveJson({
      "/v1/meta": { version: "1.24.0" },
      "/v1/schema": { classes: [{ class: "Article" }] },
      "/v1/objects": { objects: [{ id: "abc", properties: { title: "secret doc" } }] },
    });
    const result = await probeWeaviate(`http://127.0.0.1:${port}`, 1000);
    expect(result.matched).toBe(true);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("weaviate_unauthenticated_meta");
    expect(codes).toContain("weaviate_unauthenticated_schema");
    expect(codes).toContain("weaviate_unauthenticated_data");
    expect(result.findings.find((f) => f.code === "weaviate_unauthenticated_data")?.severity).toBe("critical");
  });

  it("schema boşsa data bulgusu üretmez", async () => {
    const port = await serveJson({ "/v1/meta": { version: "1.24.0" }, "/v1/schema": { classes: [] } });
    const result = await probeWeaviate(`http://127.0.0.1:${port}`, 1000);
    expect(result.findings.map((f) => f.code)).not.toContain("weaviate_unauthenticated_data");
  });
});

describe("probeQdrant", () => {
  it("eşleşmeyen bir endpoint'te matched:false döner", async () => {
    const port = await serveJson({ "/": { hello: "world" } });
    const result = await probeQdrant(`http://127.0.0.1:${port}`, 1000);
    expect(result.matched).toBe(false);
  });

  it("auth'suz info+collections+points'i bulur", async () => {
    const port = await serveJson({
      "/": { title: "qdrant - vector search engine", version: "1.9.0" },
      "/collections": { result: { collections: [{ name: "docs" }] } },
      "/collections/docs/points/scroll": { result: { points: [{ id: 1, payload: { text: "secret" } }] } },
    });
    const result = await probeQdrant(`http://127.0.0.1:${port}`, 1000);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("qdrant_unauthenticated_info");
    expect(codes).toContain("qdrant_unauthenticated_collections");
    expect(codes).toContain("qdrant_unauthenticated_data");
  });
});

describe("probeChroma", () => {
  it("eşleşmeyen bir endpoint'te matched:false döner", async () => {
    const port = await serveJson({ "/": { hello: "world" } });
    const result = await probeChroma(`http://127.0.0.1:${port}`, 1000);
    expect(result.matched).toBe(false);
  });

  it("v1 heartbeat+collections'ı bulur", async () => {
    const port = await serveJson({
      "/api/v1/heartbeat": { "nanosecond heartbeat": 123 },
      "/api/v1/collections": [{ id: "a", name: "docs" }],
    });
    const result = await probeChroma(`http://127.0.0.1:${port}`, 1000);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("chroma_unauthenticated_heartbeat");
    expect(codes).toContain("chroma_unauthenticated_collections");
  });
});

describe("probeElasticsearch", () => {
  it("eşleşmeyen bir endpoint'te matched:false döner", async () => {
    const port = await serveJson({ "/": { hello: "world" } });
    const result = await probeElasticsearch(`http://127.0.0.1:${port}`, 1000);
    expect(result.matched).toBe(false);
  });

  it("auth'suz cluster-info+indices+search'ü bulur", async () => {
    const port = await serveJson({
      "/": { cluster_name: "prod-cluster", version: { number: "8.13.0" } },
      "/_cat/indices": [{ index: "rag-docs" }],
      "/rag-docs/_search": { hits: { hits: [{ _source: { text: "secret" } }] } },
    });
    const result = await probeElasticsearch(`http://127.0.0.1:${port}`, 1000);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("es_unauthenticated_info");
    expect(codes).toContain("es_unauthenticated_indices");
    expect(codes).toContain("es_unauthenticated_data");
  });

  it("sadece sistem index'i (.) varsa data bulgusu üretmez", async () => {
    const port = await serveJson({
      "/": { cluster_name: "prod-cluster", version: { number: "8.13.0" } },
      "/_cat/indices": [{ index: ".kibana" }],
    });
    const result = await probeElasticsearch(`http://127.0.0.1:${port}`, 1000);
    expect(result.findings.map((f) => f.code)).not.toContain("es_unauthenticated_data");
  });
});
