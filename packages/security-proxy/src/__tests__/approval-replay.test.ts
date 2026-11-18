import { afterEach, describe, expect, it } from "vitest";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { InMemoryTransport, Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { AuditLogger } from "../audit/logger.js";
import { clientUpstream, type Upstream } from "../gateway/upstream.js";
import { approvalStateCodec, serveGatewayStdio } from "../proxy.js";
import { MemoryCounters, type CounterBackend } from "../state/counters.js";
import type { ServerContext } from "@modelcontextprotocol/server";
import { gatewayConfig, textOf } from "./fakes.js";

// #309: an approval answered once must not run the call again when the same
// signed requestState and answer are sent a second time (replay).
const MODERN = "2026-07-28";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function dbUpstream(calls: { n: number }): Promise<Upstream> {
  const make = () => {
    const server = new Server({ name: "db", version: "0.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler("tools/list", async () => ({ tools: [{ name: "drop_table", description: "Drop a table", inputSchema: { type: "object" as const } }] }));
    server.setRequestHandler("tools/call", async () => {
      calls.n++;
      return { content: [{ type: "text" as const, text: "dropped" }] };
    });
    return server;
  };
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(make, { transport: serverSide });
  const client = new Client({ name: "gw", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(clientSide);
  cleanups.push(async () => {
    await client.close();
    await handle.close();
  });
  return clientUpstream("db", client);
}

describe("approval replay (2026-07-28)", () => {
  it("runs an approved call once; the same state and answer sent again are refused", async () => {
    const calls = { n: 0 };
    const db = await dbUpstream(calls);
    const config = gatewayConfig({ rules: [{ id: "ask", match: { tool: "db__drop_table" }, action: "approve" }] });
    const [proxySide, agentSide] = InMemoryTransport.createLinkedPair();
    const { gateway, stdio } = serveGatewayStdio([db], config, new AuditLogger({ enabled: false }), { transport: proxySide });

    // Record what the agent sends: the second round carries requestState and the answer
    const sent: JSONRPCMessage[] = [];
    const send = agentSide.send.bind(agentSide);
    agentSide.send = async (message, options) => {
      sent.push(structuredClone(message));
      return send(message, options);
    };
    const agent = new Client({ name: "agent", version: "0.0.0" }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: { pin: MODERN } } });
    agent.setRequestHandler("elicitation/create", async () => ({ action: "accept" as const, content: { approve: true } }));
    await agent.connect(agentSide);
    cleanups.push(async () => {
      await agent.close();
      await stdio.close();
      await gateway.close();
    });

    const first = (await agent.callTool({ name: "db__drop_table", arguments: { table: "users" } })) as CallToolResult;
    expect(textOf(first)).toBe("dropped");
    expect(calls.n).toBe(1);

    const answered = sent.find((m) => "method" in m && m.method === "tools/call" && JSON.stringify(m).includes("requestState"));
    expect(answered).toBeDefined();

    // Send the captured round again under a new id, as a replaying client would
    const replies: JSONRPCMessage[] = [];
    const onmessage = agentSide.onmessage;
    agentSide.onmessage = (message, extra) => {
      if ("id" in message && message.id === "replay") replies.push(message);
      else onmessage?.(message, extra);
    };
    await send({ ...(answered as object), id: "replay" } as JSONRPCMessage);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(calls.n).toBe(1);
    expect(replies).toHaveLength(1);
    expect(JSON.stringify(replies[0])).toMatch(/"error"/);
  });
});

describe("approval state codec", () => {
  const ctx = { mcpReq: { method: "tools/call" }, http: { authInfo: { token: "", clientId: "alice", scopes: [] } } } as unknown as ServerContext;
  const key = "k".repeat(32);

  it("accepts a state once", async () => {
    const codec = approvalStateCodec(gatewayConfig(), key);
    const state = await codec.mint({ answers: [], pending: "p" }, ctx);
    await expect(codec.verify(state, ctx)).resolves.toMatchObject({ pending: "p" });
    await expect(codec.verify(state, ctx)).rejects.toThrow("replayed");
  });

  it("mints a different state each time for the same call", async () => {
    const codec = approvalStateCodec(gatewayConfig(), key);
    const a = await codec.mint({ answers: [], pending: "p" }, ctx);
    const b = await codec.mint({ answers: [], pending: "p" }, ctx);
    expect(a).not.toBe(b);
    await expect(codec.verify(a, ctx)).resolves.toBeDefined();
    await expect(codec.verify(b, ctx)).resolves.toBeDefined();
  });

  it("refuses a state replayed on another replica that shares the key and the counters", async () => {
    const shared = new MemoryCounters();
    const replicaA = approvalStateCodec(gatewayConfig(), key, shared);
    const replicaB = approvalStateCodec(gatewayConfig(), key, shared);
    const state = await replicaA.mint({ answers: [], pending: "p" }, ctx);
    await expect(replicaA.verify(state, ctx)).resolves.toBeDefined();
    await expect(replicaB.verify(state, ctx)).rejects.toThrow("replayed");
  });

  it("refuses when shared counters are down and fail closed", async () => {
    const down: CounterBackend = {
      take: () => Promise.reject(new Error("shared counters unavailable")),
      admit: () => Promise.reject(new Error("down")),
      add: async () => {},
      close: async () => {},
    };
    const codec = approvalStateCodec(gatewayConfig(), key, down);
    const state = await codec.mint({ answers: [], pending: "p" }, ctx);
    await expect(codec.verify(state, ctx)).rejects.toThrow();
  });
});
