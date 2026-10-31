// A dependency-free stdio MCP server for the sandbox tests: its one tool tries
// what a malicious server would (read files, write files, read the environment,
// open a connection) and reports what worked. No SDK, so it runs in a bare
// node image too.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import readline from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: err.code ?? String(err) };
  }
}

function connect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 2000 });
    socket.on("connect", () => (socket.destroy(), resolve({ ok: true })));
    socket.on("timeout", () => (socket.destroy(), resolve({ ok: false, error: "ETIMEDOUT" })));
    socket.on("error", (err) => resolve({ ok: false, error: err.code ?? String(err) }));
  });
}

/** Through HTTP_PROXY: a plain GET in absolute form, or a CONNECT tunnel; reports the status and body. */
function viaProxy(target) {
  const proxy = process.env.HTTP_PROXY ? new URL(process.env.HTTP_PROXY) : undefined;
  if (!proxy) return Promise.resolve({ ok: false, error: "no HTTP_PROXY" });
  return new Promise((resolve) => {
    // A plain agent: with NODE_USE_ENV_PROXY the default one would send this proxy request through the proxy again
    const agent = new http.Agent();
    const options = target.connect
      ? { host: proxy.hostname, port: proxy.port, method: "CONNECT", path: target.connect, timeout: 5000, agent }
      : { host: proxy.hostname, port: proxy.port, method: "GET", path: target.url, timeout: 5000, agent };
    const req = http.request(options);
    req.on("connect", (res, socket) => (socket.destroy(), resolve({ ok: res.statusCode === 200, status: res.statusCode })));
    req.on("response", (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: body.trim() }));
    });
    req.on("timeout", () => (req.destroy(), resolve({ ok: false, error: "ETIMEDOUT" })));
    req.on("error", (err) => resolve({ ok: false, error: err.code ?? String(err) }));
    req.end();
  });
}

async function probe(args) {
  const result = { read: {}, write: {}, env: {} };
  for (const file of args.read ?? []) result.read[file] = attempt(() => fs.readFileSync(file, "utf8").trim());
  for (const file of args.write ?? []) result.write[file] = attempt(() => fs.writeFileSync(file, "written by the sandbox probe"));
  for (const name of args.env ?? []) result.env[name] = process.env[name] ?? null;
  if (args.connect) result.connect = await connect(args.connect.host, args.connect.port);
  // What a server's own code does: fetch(), which follows HTTP_PROXY when the runtime supports NODE_USE_ENV_PROXY
  if (args.fetch) {
    try {
      const res = await fetch(args.fetch, { signal: AbortSignal.timeout(5000) });
      result.fetch = { ok: res.ok, status: res.status, body: (await res.text()).trim() };
    } catch (err) {
      result.fetch = { ok: false, error: err.cause?.code ?? err.code ?? String(err) };
    }
  }
  if (args.proxied) {
    result.proxied = [];
    for (const target of args.proxied) result.proxied.push(await viaProxy(target));
  }
  return result;
}

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "probe", version: "1.0.0" } } });
  } else if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "probe", description: "Report what this process can reach", inputSchema: { type: "object" } }] } });
  } else if (message.method === "tools/call") {
    const report = await probe(message.params.arguments ?? {});
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(report) }] } });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  }
});
