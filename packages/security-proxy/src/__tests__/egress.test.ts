import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EgressBlockedError } from "@guardbee/guard-core";
import { parseGatewayYaml } from "../gateway/config.js";
import { startEgressProxy, type EgressProxy } from "../gateway/egress.js";
import { egressListen, sandboxLaunch, seatbeltProfile, type SandboxConfig, type SandboxContext } from "../gateway/sandbox.js";
import { connectStdioUpstream, type Upstream } from "../gateway/upstream.js";

const PROBE = fileURLToPath(new URL("./fixtures/probe-server.mjs", import.meta.url));

let target: http.Server;
let targetPort: number;
beforeAll(async () => {
  target = http.createServer((req, res) => res.end(`reached ${req.url}`));
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  targetPort = (target.address() as net.AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => target.close(() => resolve())));

/** A CONNECT through the proxy: the status line it answers with. */
function connectThrough(proxyPort: number, authority: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: authority });
    req.on("connect", (res, socket) => (socket.destroy(), resolve(res.statusCode!)));
    req.on("error", reject);
    req.end();
  });
}

function getThrough(proxyPort: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: proxyPort, path: url }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      })
      .on("error", reject);
  });
}

describe("egress proxy", () => {
  const blocked: EgressBlockedError[] = [];
  let proxy: EgressProxy;
  beforeAll(async () => {
    proxy = await startEgressProxy(
      { mode: "allowlist", allowHosts: ["127.0.0.1", "rebind.test", "169.254.169.254", "*.allowed.test"], blockPrivate: false },
      {
        listen: { tcp: true },
        onBlocked: (error) => blocked.push(error),
        // rebind.test resolves to the metadata address; anything.allowed.test to a private one
        resolve: async (host) => (host === "rebind.test" ? [{ address: "169.254.169.254", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]),
      },
    );
  });
  afterAll(() => proxy.close());

  it("tunnels to an allowed host and forwards plain HTTP", async () => {
    expect(await connectThrough(proxy.port!, `127.0.0.1:${targetPort}`)).toBe(200);
    expect(await getThrough(proxy.port!, `http://127.0.0.1:${targetPort}/x?y=1`)).toEqual({ status: 200, body: "reached /x?y=1" });
    expect(await getThrough(proxy.port!, `http://api.allowed.test:${targetPort}/glob`)).toEqual({ status: 200, body: "reached /glob" });
  });

  it("refuses hosts outside allowHosts, before any lookup", async () => {
    blocked.length = 0;
    expect(await connectThrough(proxy.port!, "example.com:443")).toBe(403);
    expect((await getThrough(proxy.port!, "http://evil.test/")).status).toBe(403);
    expect(blocked.map((e) => [e.rule, e.host])).toEqual([
      ["network:host", "example.com"],
      ["network:host", "evil.test"],
    ]);
  });

  it("refuses the metadata address even when allowlisted, as a literal or behind a name (DNS rebinding)", async () => {
    blocked.length = 0;
    expect(await connectThrough(proxy.port!, "169.254.169.254:80")).toBe(403);
    expect(await connectThrough(proxy.port!, "rebind.test:80")).toBe(403);
    expect(blocked.map((e) => [e.rule, e.host, e.address])).toEqual([
      ["network:metadata", "169.254.169.254", "169.254.169.254"],
      ["network:metadata", "rebind.test", "169.254.169.254"],
    ]);
  });

  it("refuses private addresses with blockPrivate", async () => {
    const strict = await startEgressProxy({ mode: "allowlist", allowHosts: ["127.0.0.1"], blockPrivate: true }, { listen: { tcp: true } });
    try {
      expect(await connectThrough(strict.port!, `127.0.0.1:${targetPort}`)).toBe(403);
    } finally {
      await strict.close();
    }
  });

  it("listens on a unix socket", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-egress-"));
    const socket = path.join(dir, "proxy.sock");
    const onSocket = await startEgressProxy({ mode: "allowlist", allowHosts: ["127.0.0.1"], blockPrivate: false }, { listen: { socket } });
    try {
      expect(fs.statSync(socket).mode & 0o777).toBe(0o600);
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({ socketPath: socket, method: "CONNECT", path: `127.0.0.1:${targetPort}` });
        req.on("connect", (res, s) => (s.destroy(), resolve(res.statusCode!)));
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(200);
    } finally {
      await onSocket.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(fs.existsSync(socket)).toBe(false);
  });
});

describe("network: allowlist config and launch", () => {
  const ctx = (overrides: Partial<SandboxContext> = {}): SandboxContext => ({
    name: "probe",
    cwd: os.tmpdir(),
    home: os.tmpdir(),
    platform: "linux",
    env: { PATH: "/usr/bin:/bin", HTTPS_PROXY: "http://host-proxy:8080" },
    uid: 1000,
    gid: 1000,
    stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "gb-state-")),
    ...overrides,
  });
  const sandbox = (overrides: Partial<SandboxConfig> = {}): SandboxConfig => ({
    runtime: "sandbox-exec",
    fs: { readOnly: [], readWrite: [], deny: [] },
    env: ["HTTPS_PROXY"],
    network: "allowlist",
    allowHosts: ["api.github.com"],
    ...overrides,
  });

  it("needs allowHosts, and allowHosts needs allowlist", () => {
    const yaml = (network: string) => `version: 1\nupstreams:\n  s:\n    command: npx\n    sandbox:\n      runtime: docker\n${network}`;
    expect(() => parseGatewayYaml(yaml("      network: allowlist\n"))).toThrow(/at least one host/);
    expect(() => parseGatewayYaml(yaml("      network: open\n      allowHosts: [a.com]\n"))).toThrow(/apply to network: allowlist/);
    const config = parseGatewayYaml(yaml("      network: allowlist\n      allowHosts: [registry.npmjs.org, '*.github.com']\n"));
    expect((config.upstreams["s"] as { sandbox: SandboxConfig }).sandbox.allowHosts).toEqual(["registry.npmjs.org", "*.github.com"]);
  });

  it("sandbox-exec: only the proxy port, and proxy settings the host cannot override", () => {
    const profile = seatbeltProfile(sandbox(), ctx(), "/h", { port: 41234 });
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(allow network-outbound (remote ip "localhost:41234"))');
    expect(profile).not.toContain("mDNSResponder");
    const launch = sandboxLaunch({ command: "node", args: ["s.js"] }, sandbox(), ctx({ platform: "darwin" }), { port: 41234 });
    expect(launch.env).toMatchObject({ HTTPS_PROXY: "http://127.0.0.1:41234", https_proxy: "http://127.0.0.1:41234", NODE_USE_ENV_PROXY: "1" });
  });

  it("bwrap: own network namespace and the forwarder in front of the command", () => {
    const c = ctx();
    const socket = (egressListen(sandbox({ runtime: "bwrap" }), c) as { socket: string }).socket;
    const launch = sandboxLaunch({ command: "node", args: ["s.js"] }, sandbox({ runtime: "bwrap" }), c, { socket });
    expect(launch.args).toContain("--unshare-all");
    expect(launch.args).not.toContain("--share-net");
    const dash = launch.args.indexOf("--");
    expect(launch.args.slice(dash + 1)).toEqual([process.execPath, path.join(path.dirname(socket), "forward.mjs"), "--listen", "127.0.0.1:3128", "--to", socket, "--", "node", "s.js"]);
    expect(launch.env["HTTPS_PROXY"]).toBe("http://127.0.0.1:3128");
  });

  it("docker: internal network, sidecar over the socket on Linux and host.docker.internal elsewhere", () => {
    const linux = ctx();
    const socket = (egressListen(sandbox({ runtime: "docker" }), linux) as { socket: string }).socket;
    const launch = sandboxLaunch({ command: "node", args: ["s.js"] }, sandbox({ runtime: "docker" }), linux, { socket });
    expect(launch.command).toBe(process.execPath);
    const spec = JSON.parse(fs.readFileSync(launch.args[1]!, "utf8"));
    expect(spec.serverArgs[spec.serverArgs.indexOf("--network") + 1]).toBe(spec.network);
    expect(spec.sidecarArgs).toContain(`/egress/proxy.sock`);
    expect(spec.sidecarArgs).toContain("--user");
    expect(launch.env["HTTPS_PROXY"]).toBe("http://egress:3128");

    const mac = ctx({ platform: "darwin" });
    expect(egressListen(sandbox({ runtime: "docker" }), mac)).toEqual({ tcp: true });
    const macLaunch = sandboxLaunch({ command: "node", args: ["s.js"] }, sandbox({ runtime: "docker" }), mac, { port: 5555 });
    expect(JSON.parse(fs.readFileSync(macLaunch.args[1]!, "utf8")).sidecarArgs).toContain("host.docker.internal:5555");
  });

  it("refuses to launch without the egress proxy", () => {
    expect(() => sandboxLaunch({ command: "node" }, sandbox(), ctx())).toThrow(/egress proxy/);
  });
});

/** The probe server in a real sandbox with network: allowlist. */
async function probeAllowlisted(runtime: SandboxConfig["runtime"], request: Record<string, unknown>, extra: Partial<SandboxConfig> = {}) {
  const blocked: EgressBlockedError[] = [];
  const stateHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gb-allowlist-")));
  const previousHome = process.env["HOME"];
  process.env["HOME"] = stateHome;
  let upstream: Upstream | undefined;
  try {
    upstream = await connectStdioUpstream(
      "allowlisted",
      {
        command: "node",
        args: [PROBE],
        sandbox: { runtime, fs: { readOnly: [path.dirname(PROBE)], readWrite: [], deny: [] }, env: [], network: "allowlist", allowHosts: ["127.0.0.1"], blockPrivate: false, ...extra },
      },
      { onEgressBlocked: (error) => blocked.push(error) },
    );
    const result = (await upstream.callTool("probe", request)) as { content: { text: string }[] };
    return { report: JSON.parse(result.content[0]!.text) as { connect?: { ok: boolean }; fetch?: { ok: boolean; status?: number; body?: string }; proxied: { ok: boolean; status?: number; body?: string; error?: string }[] }, blocked };
  } finally {
    await upstream?.close();
    process.env["HOME"] = previousHome;
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
}

const dockerUp = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(process.platform === "darwin")("network: allowlist under sandbox-exec (macOS)", () => {
  it("reaches allowed hosts through the proxy only", async () => {
    const { report, blocked } = await probeAllowlisted("sandbox-exec", {
      connect: { host: "127.0.0.1", port: targetPort },
      proxied: [{ url: `http://127.0.0.1:${targetPort}/ok` }, { connect: `127.0.0.1:${targetPort}` }, { url: "http://example.com/" }, { connect: "1.1.1.1:443" }],
    });
    expect(report.connect?.ok).toBe(false); // straight to the target, past the proxy: Seatbelt refuses
    expect(report.proxied.map((p) => p.status)).toEqual([200, 200, 403, 403]);
    expect(report.proxied[0]!.body).toBe("reached /ok");
    expect(blocked.map((e) => e.host)).toEqual(["example.com", "1.1.1.1"]);
  }, 30_000);
});

describe.runIf(dockerUp)("network: allowlist under docker", () => {
  it("reaches allowed hosts through the sidecar and the proxy only", async () => {
    const { report, blocked } = await probeAllowlisted("docker", {
      connect: { host: "1.1.1.1", port: 443 },
      proxied: [{ url: `http://127.0.0.1:${targetPort}/ok` }, { url: "http://example.com/" }],
      fetch: `http://127.0.0.1:${targetPort}/fetched`,
    });
    // Node in the image (22.21+) honors NODE_USE_ENV_PROXY: an unmodified fetch() goes through the proxy
    expect(report.fetch).toMatchObject({ status: 200, body: "reached /fetched" });
    expect(report.connect?.ok).toBe(false); // internal network: no route out
    expect(report.proxied, JSON.stringify(report.proxied)).toMatchObject([{ status: 200 }, { status: 403 }]);
    expect(report.proxied[0]!.body).toBe("reached /ok");
    expect(blocked.map((e) => e.host)).toEqual(["example.com"]);
    // The launcher removed the sidecar and the network
    const leftovers = execFileSync("docker", ["ps", "-a", "--filter", "name=guardbee-egress-allowlisted", "--format", "{{.Names}}"], { encoding: "utf8" });
    expect(leftovers.trim()).toBe("");
  }, 180_000);
});
