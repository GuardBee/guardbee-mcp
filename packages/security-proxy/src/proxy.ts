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
import { scanToolResult } from "./interceptors/tool-result.js";
import { ToolDefinitionPin, type ToolRecord } from "./interceptors/definition-drift.js";
import { maskPiiInValue } from "./interceptors/pii-masker.js";
import { AuditLogger } from "./audit/logger.js";
import { recordEvent } from "@guardbee/mcp-telemetry";

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
  const driftEnabled = config.interceptors?.definitionDrift?.enabled !== false;
  const driftAction = config.interceptors?.definitionDrift?.action ?? config.interceptors?.promptInjection?.action ?? "block";
  const resultEnabled = config.interceptors?.toolResultInjection?.enabled !== false;
  const resultAction = config.interceptors?.toolResultInjection?.action ?? config.interceptors?.promptInjection?.action ?? "block";
  const pin = new ToolDefinitionPin();

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

  // List tools → pin the first list, and keep serving that pin if the server changes it.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await downstream.listTools();
    if (!driftEnabled) return result;
    const observed = pin.observe(result.tools as ToolRecord[], driftAction);
    for (const finding of observed.findings) {
      audit.log({
        ts: new Date().toISOString(),
        type: driftAction === "block" ? "blocked" : "warn",
        tool: finding.toolName,
        server: serverInfo?.name,
        reason: finding.reason,
      });
    }
    return { ...result, tools: observed.tools as typeof result.tools };
  });

  // Call tool → intercept, scan, forward, mask response
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const toolInput = req.params.arguments ?? {};
    const started = Date.now();

    // 1. Prompt injection scan on input
    if (config.interceptors?.promptInjection?.enabled !== false) {
      const mode = config.interceptors?.promptInjection?.action ?? "block";
      const scan = scanForPromptInjection(toolInput, mode);
      if (scan.action === "block") {
        audit.log({
          ts: new Date().toISOString(),
          type: "blocked",
          tool: toolName,
          server: serverInfo?.name,
          input: toolInput,
          reason: scan.reason,
        });
        void recordEvent({
          server: "security-proxy",
          tool: toolName,
          params: toolInput as Record<string, unknown>,
          success: false,
          durationMs: Date.now() - started,
          error: `blocked: ${scan.reason}`,
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

    // 2. Re-check the live tool definition against the session pin.
    if (driftEnabled) {
      try {
        const listed = await downstream.listTools();
        pin.ensurePinned(listed.tools as ToolRecord[]);
        const drift = pin.drifted(toolName, listed.tools as ToolRecord[]);
        if (drift && driftAction === "block") {
          audit.log({
            ts: new Date().toISOString(),
            type: "blocked",
            tool: toolName,
            server: serverInfo?.name,
            input: toolInput,
            reason: drift.reason,
          });
          return {
            content: [{ type: "text" as const, text: `[GuardBee Security Proxy] Tool call blocked: ${drift.reason}` }],
            isError: true,
          };
        }
        if (drift) {
          audit.log({
            ts: new Date().toISOString(),
            type: "warn",
            tool: toolName,
            server: serverInfo?.name,
            input: toolInput,
            reason: drift.reason,
          });
        }
      } catch (err) {
        audit.log({
          ts: new Date().toISOString(),
          type: "warn",
          tool: toolName,
          server: serverInfo?.name,
          reason: `definition re-check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // 3. Log the call
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

    // 4. Indirect injection in the tool result, then PII masking.
    let content = result.content;
    if (resultEnabled) {
      const scan = scanToolResult(content, resultAction);
      if (scan.action === "block") {
        audit.log({
          ts: new Date().toISOString(),
          type: "blocked",
          tool: toolName,
          server: serverInfo?.name,
          output: content,
          reason: scan.reason,
        });
        void recordEvent({
          server: "security-proxy",
          tool: toolName,
          params: toolInput as Record<string, unknown>,
          success: false,
          durationMs: Date.now() - started,
          error: `blocked: ${scan.reason}`,
        });
        return {
          content: [{ type: "text" as const, text: `[GuardBee Security Proxy] Tool result blocked: ${scan.reason}` }],
          isError: true,
        };
      }
      if (scan.action === "warn") {
        audit.log({
          ts: new Date().toISOString(),
          type: "warn",
          tool: toolName,
          server: serverInfo?.name,
          output: content,
          reason: scan.reason,
        });
        const warning = { type: "text" as const, text: `[GuardBee Security Proxy] Warning: ${scan.reason}` };
        content = [warning, ...(Array.isArray(content) ? content : [])] as typeof content;
      }
    }
    if (config.interceptors?.piiMasking?.enabled !== false) {
      content = maskPiiInValue(content) as typeof content;
    }

    // 5. Log response
    audit.log({
      ts: new Date().toISOString(),
      type: "tool_response",
      tool: toolName,
      server: serverInfo?.name,
      output: content,
    });

    void recordEvent({
      server: "security-proxy",
      tool: toolName,
      params: toolInput as Record<string, unknown>,
      success: !result.isError,
      durationMs: Date.now() - started,
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
