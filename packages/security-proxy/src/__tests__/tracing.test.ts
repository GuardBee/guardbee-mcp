import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { trace, SpanKind } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { CallToolResult, CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
import { AuditLogger } from "../audit/logger.js";
import type { GatewayConfig } from "../gateway/config.js";
import { Gateway, type Sampler } from "../gateway/gateway.js";
import type { Upstream } from "../gateway/upstream.js";
import { fakeUpstream, gatewayConfig } from "./fakes.js";

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  // One provider per test file (vitest isolates files): the global can be set only once
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
});
beforeEach(() => exporter.reset());

const audit = () => new AuditLogger({ enabled: false, sink: "console" });
const spans = (): ReadableSpan[] => exporter.getFinishedSpans();
const named = (name: string) => spans().find((span) => span.name === name);

function gateway(upstreams: Upstream[], overrides: Partial<GatewayConfig> = {}, options: ConstructorParameters<typeof Gateway>[4] = {}) {
  return new Gateway(upstreams, gatewayConfig(overrides), audit(), undefined, options);
}

describe("OpenTelemetry spans", () => {
  it("gives each tool call a server span with MCP attributes and a child span for the upstream", async () => {
    const crm = fakeUpstream("crm", [{ name: "get_customer", returns: "Ayşe, TC 10000000146" }]);
    const gw = gateway([crm], { labels: { crm__get_customer: ["sensitive"] } }, { sessionId: "s-1", identity: { user: "ayse@acme.test", groups: [] } });
    await gw.callTool("crm__get_customer", { id: 1 });

    const call = named("tools/call crm__get_customer")!;
    expect(call.kind).toBe(SpanKind.SERVER);
    expect(call.attributes).toMatchObject({
      "mcp.method.name": "tools/call",
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "crm__get_customer",
      "mcp.session.id": "s-1",
      "enduser.id": "ayse@acme.test",
      "guardbee.upstream": "crm",
      "guardbee.labels": ["sensitive"],
      "guardbee.pii_hits": 1,
    });
    expect(call.events.map((event) => event.name)).toEqual(["guardbee.tool_call", "guardbee.tool_response"]);

    const upstream = named("tools/call get_customer")!;
    expect(upstream.kind).toBe(SpanKind.CLIENT);
    expect(upstream.attributes).toMatchObject({ "server.address": "crm", "gen_ai.tool.name": "get_customer" });
    expect(upstream.parentSpanContext?.spanId).toBe(call.spanContext().spanId);
    expect(upstream.spanContext().traceId).toBe(call.spanContext().traceId);
  });

  it("records a block as a span event and attribute, with no upstream span", async () => {
    const crm = fakeUpstream("crm", [{ name: "delete_all" }]);
    const gw = gateway([crm], { rules: [{ id: "no-deletes", match: { tool: "crm__delete_*" }, action: "deny" }] });
    const result = await gw.callTool("crm__delete_all", {});
    expect(result.isError).toBe(true);

    const call = named("tools/call crm__delete_all")!;
    expect(call.attributes).toMatchObject({ "guardbee.blocked": true, "error.type": "tool_error" });
    expect(call.events).toContainEqual(
      expect.objectContaining({ name: "guardbee.blocked", attributes: expect.objectContaining({ "guardbee.rule_id": "no-deletes" }) }),
    );
    expect(named("tools/call delete_all")).toBeUndefined();
  });

  it("marks an upstream failure as an error on both spans", async () => {
    const broken: Upstream = {
      ...fakeUpstream("crm", [{ name: "get_customer" }]),
      async callTool(): Promise<CallToolResult> {
        throw new Error("connection reset");
      },
    };
    const gw = gateway([broken]);
    await expect(gw.callTool("crm__get_customer", {})).rejects.toThrow("connection reset");
    expect(named("tools/call crm__get_customer")?.status).toMatchObject({ code: 2, message: "connection reset" });
    expect(named("tools/call get_customer")?.status).toMatchObject({ code: 2 });
  });

  it("puts a sampling request's events on the span of the call that caused it", async () => {
    // Over stdio or HTTP the server's request arrives from a socket event, outside the
    // call's async context. Reproduce that: a poller started before the call delivers it.
    const inbox: (() => void)[] = [];
    const poller = setInterval(() => inbox.shift()?.(), 1);
    const docs: Upstream = {
      ...fakeUpstream("docs", [{ name: "summarize" }]),
      async callTool(_tool, _args, options): Promise<CallToolResult> {
        const answer = await new Promise<CreateMessageResult>((resolve, reject) =>
          inbox.push(() =>
            options!.sampling!.handler({ messages: [{ role: "user", content: { type: "text", text: "Summarize." } }], maxTokens: 100 }).then(resolve, reject),
          ),
        );
        return { content: [{ type: "text", text: answer.content.type === "text" ? answer.content.text : "" }] };
      },
    };
    const sampler: Sampler = {
      available: () => true,
      create: async () => ({ role: "assistant", model: "m", content: { type: "text", text: "Short." } }),
    };
    const gw = gateway([docs], { interceptors: { sampling: { enabled: true, action: "block" } } }, { sampler });
    try {
      await gw.callTool("docs__summarize", {});
    } finally {
      clearInterval(poller);
    }

    const call = named("tools/call docs__summarize")!;
    const sampled = call.events.filter((event) => event.attributes?.["gen_ai.tool.name"] === "sampling:docs");
    expect(sampled.map((event) => event.name)).toEqual(["guardbee.tool_call", "guardbee.tool_response"]);
  });
});
