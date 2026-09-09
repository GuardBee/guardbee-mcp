import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ProxyConfig } from "./types.js";
import { scanForPromptInjection } from "./interceptors/prompt-injection.js";
import { maskPiiInValue } from "./interceptors/pii-masker.js";
import { AuditLogger } from "./audit/logger.js";

export async function startProxy(config: ProxyConfig): Promise<void> {
  const audit = new AuditLogger(
    config.audit ?? { enabled: true, sink: "console" }
  );

  // --- Connect to target MCP server (downstream) ---
  const downstream = new Client(
    { name: "guardbee-proxy-client", version: "0.1.0" },
    { capabilities: {} }
  );

  const transport = new StdioClientTransport({
    command: config.server.command,
    args: config.server.args ?? [],
    env: { ...process.env, ...(config.server.env ?? {}) } as Record<string, string>,
  });

  await downstream.connect(transport);

  const serverInfo = downstream.getServerVersion();

  // --- Start proxy MCP server (upstream, for Claude) ---
  const server = new Server(
    { name: "guardbee-security-proxy", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // List tools → pass through from downstream
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await downstream.listTools();
    return result;
  });

  // Call tool → intercept, scan, forward, mask response
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const toolInput = req.params.arguments ?? {};

    // 1. Prompt injection scan on input
    if (config.interceptors?.promptInjection?.enabled !== false) {
      const scan = scanForPromptInjection(toolInput);
      if (scan.action === "block") {
        audit.log({
          ts: new Date().toISOString(),
          type: "blocked",
          tool: toolName,
          server: serverInfo?.name,
          input: toolInput,
          reason: scan.reason,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `[GuardBee Security Proxy] Tool call blocked: ${scan.reason}`,
            },
          ],
          isError: true,
        };
      }
      if (scan.action === "warn") {
        audit.log({
          ts: new Date().toISOString(),
          type: "warn",
          tool: toolName,
          server: serverInfo?.name,
          input: toolInput,
          reason: scan.reason,
        });
      }
    }

    // 2. Log the call
    audit.log({
      ts: new Date().toISOString(),
      type: "tool_call",
      tool: toolName,
      server: serverInfo?.name,
      input: toolInput,
    });

    // 3. Forward to downstream
    const result = await downstream.callTool({
      name: toolName,
      arguments: toolInput,
    });

    // 4. PII masking on response
    let content = result.content;
    if (config.interceptors?.piiMasking?.enabled !== false) {
      content = (maskPiiInValue(content) as typeof content);
    }

    // 5. Log response
    audit.log({
      ts: new Date().toISOString(),
      type: "tool_response",
      tool: toolName,
      server: serverInfo?.name,
      output: content,
    });

    return { ...result, content };
  });

  // Resources pass-through
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return await downstream.listResources();
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    return await downstream.readResource({ uri: req.params.uri });
  });

  // Prompts pass-through
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return await downstream.listPrompts();
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    return await downstream.getPrompt({
      name: req.params.name,
      arguments: req.params.arguments,
    });
  });

  // Start upstream server
  const upstreamTransport = new StdioServerTransport();
  await server.connect(upstreamTransport);

  process.on("SIGINT", async () => {
    audit.close();
    await server.close();
    await downstream.close();
    process.exit(0);
  });
}
