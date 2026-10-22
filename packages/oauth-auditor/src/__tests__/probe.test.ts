import { createServer, type IncomingMessage, type Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { isPrivateAddress, probeEndpoint } from "../probe.js";

let server: Server | undefined;
const seen: { method?: string; host?: string; origin?: string; auth?: string }[] = [];

/** A local stand-in MCP endpoint; `check` decides which requests it answers. */
async function serve(check: (req: IncomingMessage) => boolean): Promise<string> {
  seen.length = 0;
  server = createServer((req, res) => {
    seen.push({ method: req.method, host: req.headers.host, origin: req.headers.origin, auth: req.headers.authorization });
    req.resume();
    if (req.method === "DELETE") return void res.writeHead(200).end();
    if (!check(req)) return void res.writeHead(403).end();
    res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s-1" }).end("{}");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;
}

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

describe("probe", () => {
  it("reports an open server: no auth, foreign Host and Origin accepted; closes its sessions", async () => {
    const url = await serve(() => true);
    const ids = (await probeEndpoint(url)).map((f) => f.patternId);
    expect(ids).toEqual(["probe_unauthenticated_access", "probe_dns_rebinding_host_accepted", "probe_foreign_origin_accepted"]);
    expect(seen.filter((r) => r.method === "DELETE")).toHaveLength(3);
  });

  it("reports nothing for a server that requires auth and checks Host and Origin", async () => {
    const url = await serve((req) => Boolean(req.headers.authorization) && req.headers.host?.startsWith("127.0.0.1") === true && !req.headers.origin);
    expect(await probeEndpoint(url)).toEqual([]);
    // It never sends credentials of its own
    expect(seen.every((r) => r.auth === undefined)).toBe(true);
  });

  it("refuses a public address unless allowed", async () => {
    await expect(probeEndpoint("http://8.8.8.8/mcp", { timeoutMs: 500 })).rejects.toThrow(/public address/);
  });

  it.each([
    ["127.0.0.1", true], ["10.1.2.3", true], ["172.20.0.1", true], ["192.168.1.5", true], ["::1", true], ["fd12::1", true],
    ["8.8.8.8", false], ["172.32.0.1", false], ["2606:4700::1111", false],
  ])("%s is private: %s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});
