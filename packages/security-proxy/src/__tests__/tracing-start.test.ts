import http from "http";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";
import { trace } from "@opentelemetry/api";
import { startTracing } from "../tracing.js";

/** A local OTLP/HTTP collector that records the paths it receives. */
async function collector(): Promise<{ url: string; paths: string[]; close: () => Promise<void> }> {
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      paths.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    paths,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("startTracing", () => {
  it("stays off without an OTLP endpoint, or when disabled", async () => {
    expect(await startTracing({ env: {} })).toBeNull();
    expect(await startTracing({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://x", OTEL_SDK_DISABLED: "true" } })).toBeNull();
    expect(await startTracing({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://x", OTEL_TRACES_EXPORTER: "none" } })).toBeNull();
  });

  it("says how to install the SDK when it is missing", async () => {
    const lines: string[] = [];
    const stop = await startTracing({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://x" },
      load: () => Promise.reject(new Error("Cannot find module")),
      warn: (line) => lines.push(line),
    });
    expect(stop).toBeNull();
    expect(lines[0]).toMatch(/npm i @opentelemetry\/sdk-trace-base/);
  });

  it("exports spans to the OTLP endpoint with the real SDK, and leaves an existing SDK alone", async () => {
    const otlp = await collector();
    try {
      const env = { OTEL_EXPORTER_OTLP_ENDPOINT: otlp.url };
      // The exporter reads its endpoint from the process environment
      process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = otlp.url;
      const stop = await startTracing({ env, version: "9.9.9", warn: () => {} });
      expect(stop).not.toBeNull();

      trace.getTracer("test").startSpan("tools/call demo").end();
      await stop!(); // shutdown flushes the batch
      expect(otlp.paths).toContain("/v1/traces");

      // A provider is already registered now: a second start backs off
      expect(await startTracing({ env, warn: () => {} })).toBeNull();
    } finally {
      delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
      await otlp.close();
    }
  });
});
