import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardSink } from "../audit/dashboard-sink.js";
import type { AuditEvent } from "../types.js";

const event = (i: number): AuditEvent => ({ ts: `2026-09-30T00:00:${String(i).padStart(2, "0")}Z`, type: "tool_call", tool: `t${i}` });

function fakeFetch(statuses: (number | "offline")[]) {
  const calls: { url: string; auth: string | null; body: { source?: string; events: AuditEvent[]; dropped: number } }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const status = statuses.shift() ?? 200;
    if (status === "offline") throw new Error("ECONNREFUSED");
    calls.push({
      url: String(url),
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(null, { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const config = { url: "https://dash.test/api/v1/gateway/events", apiKey: "gb_key", source: "ci", batchSize: 2, flushIntervalMs: 60_000 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardSink", () => {
  it("sends full batches with the Bearer key and the source name", async () => {
    const { impl, calls } = fakeFetch([]);
    const sink = new DashboardSink(config, impl);
    sink.push(event(1));
    sink.push(event(2));
    sink.push(event(3));
    await sink.close();
    expect(calls.map((c) => c.body.events.map((e) => e.tool))).toEqual([["t1", "t2"], ["t3"]]);
    expect(calls[0]).toMatchObject({ url: config.url, auth: "Bearer gb_key", body: { source: "ci", dropped: 0 } });
  });

  it("keeps events when the dashboard is offline or failing, and sends them later", async () => {
    const { impl, calls } = fakeFetch(["offline", 503]);
    const sink = new DashboardSink({ ...config, batchSize: 10 }, impl);
    sink.push(event(1));
    await sink.flush();
    expect(sink.pending).toBe(1);
    await sink.flush();
    expect(sink.pending).toBe(1);
    await sink.flush();
    expect(sink.pending).toBe(0);
    expect(calls.at(-1)?.body.events.map((e) => e.tool)).toEqual(["t1"]);
    await sink.close();
  });

  it("drops a rejected batch once, warns about the key, and reports the count", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { impl, calls } = fakeFetch([401, 200]);
    const sink = new DashboardSink({ ...config, batchSize: 1 }, impl);
    sink.push(event(1));
    await sink.flush();
    expect(sink.pending).toBe(0);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("gateway.write scope"));
    sink.push(event(2));
    await sink.close();
    expect(calls[1]?.body.dropped).toBe(1);
  });
});
