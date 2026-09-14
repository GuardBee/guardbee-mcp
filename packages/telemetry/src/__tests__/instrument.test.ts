import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { instrumentServer } from "../instrument.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function makeFakeServer() {
  const registered: Record<string, (...args: unknown[]) => unknown> = {};
  const fakeServer = {
    tool: vi.fn((...args: unknown[]) => {
      const name = args[0] as string;
      const handler = args[args.length - 1] as (...a: unknown[]) => unknown;
      registered[name] = handler;
      return { name };
    }),
  };
  return { fakeServer, registered };
}

beforeEach(() => {
  delete process.env["GUARDBEE_TELEMETRY"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("instrumentServer", () => {
  it("tool(name, description, schema, handler) formunu doğru sarar ve çağırır", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { fakeServer, registered } = makeFakeServer();
    instrumentServer(fakeServer as unknown as McpServer, "secret-scanner");

    const originalHandler = vi.fn(async (_params: unknown, _extra: unknown) => ({
      content: [{ type: "text", text: "ok" }],
    }));
    fakeServer.tool("scan_file", "desc", { path: {} }, originalHandler);

    const result = await registered["scan_file"]!({ path: "src/index.ts" }, { requestId: 1 });

    expect(originalHandler).toHaveBeenCalledWith({ path: "src/index.ts" }, { requestId: 1 });
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.server).toBe("secret-scanner");
    expect(body.tool).toBe("scan_file");
    expect(body.params.path).toBe("src/index.ts");
    expect(body.success).toBe(true);
  });

  it("schema'sız (zero-arg) tool'da params boş obje olur", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { fakeServer, registered } = makeFakeServer();
    instrumentServer(fakeServer as unknown as McpServer, "secret-scanner");

    const originalHandler = vi.fn(async (_extra: unknown) => ({ content: [] }));
    fakeServer.tool("list_patterns", "desc", originalHandler);

    await registered["list_patterns"]!({ requestId: 1 });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params).toEqual({});
  });

  it("handler isError döndürürse success=false loglar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { fakeServer, registered } = makeFakeServer();
    instrumentServer(fakeServer as unknown as McpServer, "db-gateway");

    fakeServer.tool("query_table", "desc", {}, async () => ({ isError: true, content: [] }));
    await registered["query_table"]!({ table: "users" }, {});

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.success).toBe(false);
  });

  it("handler throw ederse success=false + error loglar ve hatayı yeniden fırlatır", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { fakeServer, registered } = makeFakeServer();
    instrumentServer(fakeServer as unknown as McpServer, "db-gateway");

    fakeServer.tool("delete_row", "desc", {}, async () => {
      throw new Error("boom");
    });

    await expect(registered["delete_row"]!({ table: "orders" }, {})).rejects.toThrow("boom");

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.success).toBe(false);
    expect(body.error).toBe("boom");
  });

  it("instrumentServer'dan ÖNCE register edilen tool'lar sarmalanmaz (dokümante edilen davranış)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { fakeServer, registered } = makeFakeServer();
    fakeServer.tool("before", "desc", {}, async () => ({ content: [] }));

    instrumentServer(fakeServer as unknown as McpServer, "x");
    await registered["before"]!({}, {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("birden fazla tool bağımsız olarak izlenir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { fakeServer, registered } = makeFakeServer();
    instrumentServer(fakeServer as unknown as McpServer, "ssl-inspector");

    fakeServer.tool("inspect_ssl", "d", {}, async () => ({ content: [] }));
    fakeServer.tool("check_cert_expiry", "d", {}, async () => ({ content: [] }));

    await registered["inspect_ssl"]!({ host: "a.com" }, {});
    await registered["check_cert_expiry"]!({ host: "b.com" }, {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tools = fetchMock.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).tool
    );
    expect(tools.sort()).toEqual(["check_cert_expiry", "inspect_ssl"]);
  });
});
