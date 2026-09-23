import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { scanEndpoint } from "../scanner.js";

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
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as { port: number }).port));
  });
}

describe("scanEndpoint", () => {
  it("auto modda bir weaviate fingerprint'ini doğru tespit eder", async () => {
    const port = await serveJson({ "/v1/meta": { version: "1.24.0" }, "/v1/schema": { classes: [] } });
    const result = await scanEndpoint({ host: "127.0.0.1", port, type: "auto", timeoutMs: 1000 });
    expect(result.detectedType).toBe("weaviate");
    expect(result.reachable).toBe(true);
  });

  it("explicit type belirtilip fingerprint eşleşmezse type_mismatch bulgusu döner", async () => {
    const port = await serveJson({ "/v1/meta": { version: "1.24.0" }, "/v1/schema": { classes: [] } });
    const result = await scanEndpoint({ host: "127.0.0.1", port, type: "qdrant", timeoutMs: 1000 });
    expect(result.detectedType).toBe("unknown");
    expect(result.findings[0].code).toBe("type_mismatch");
  });

  it("hiçbir şey dinlemeyen bir portta unreachable döner", async () => {
    const result = await scanEndpoint({ host: "127.0.0.1", port: 39217, type: "auto", timeoutMs: 300 });
    expect(result.detectedType).toBe("unknown");
    expect(result.reachable).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it("target alanı host:port formatında olur", async () => {
    const port = await serveJson({ "/v1/meta": { version: "1.0.0" }, "/v1/schema": { classes: [] } });
    const result = await scanEndpoint({ host: "127.0.0.1", port, type: "weaviate", timeoutMs: 1000 });
    expect(result.target).toBe(`127.0.0.1:${port}`);
  });
});
