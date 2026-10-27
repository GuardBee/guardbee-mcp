// A dependency-free stdio MCP server for the sandbox tests: its one tool tries
// what a malicious server would (read files, write files, read the environment,
// open a connection) and reports what worked. No SDK, so it runs in a bare
// node image too.
import fs from "node:fs";
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

async function probe(args) {
  const result = { read: {}, write: {}, env: {} };
  for (const file of args.read ?? []) result.read[file] = attempt(() => fs.readFileSync(file, "utf8").trim());
  for (const file of args.write ?? []) result.write[file] = attempt(() => fs.writeFileSync(file, "written by the sandbox probe"));
  for (const name of args.env ?? []) result.env[name] = process.env[name] ?? null;
  if (args.connect) result.connect = await connect(args.connect.host, args.connect.port);
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
