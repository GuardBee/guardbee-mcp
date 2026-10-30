import { McpServer } from "@modelcontextprotocol/server";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { suiteToolName, type SuitePackage } from "./catalog.js";

type RegisterTools = (server: McpServer) => void | Promise<void>;

/**
 * `server` as one package sees it: the tools it registers get the package's
 * prefix, and a description that names the package.
 */
function prefixed(server: McpServer, entry: SuitePackage): McpServer {
  const rename = (args: unknown[]) => {
    if (typeof args[0] === "string") args[0] = suiteToolName(entry.prefix, args[0]);
    return args;
  };
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") return (...args: unknown[]) => (target.registerTool as (...a: unknown[]) => unknown)(...rename(args));
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** One MCP server with the tools of every package in `packages`, loaded only when selected. */
export async function buildSuiteServer(packages: SuitePackage[], version: string): Promise<McpServer> {
  const server = new McpServer({ name: "guardbee-security-suite", version });
  instrumentServer(server, "security-suite");
  for (const entry of packages) {
    const mod = (await import(entry.pkg)) as { registerTools?: RegisterTools };
    if (typeof mod.registerTools !== "function") throw new Error(`${entry.pkg} has no registerTools export; update it to a version that has one`);
    await mod.registerTools(prefixed(server, entry));
  }
  return server;
}
