import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type GatewayConfig } from "./config";
import { registerDbTools } from "./tools/db-tools";
import type { DbAdapter } from "./types";

export function createServer(
  configOverrides?: Partial<GatewayConfig>,
  dbAdapter?: DbAdapter
): McpServer {
  const config = loadConfig(configOverrides);

  // Varsayılan adapter: gerçek projede Prisma ile değiştirilir
  const db: DbAdapter = dbAdapter ?? createDemoAdapter();

  const server = new McpServer({
    name: config.serverName,
    version: "0.1.0",
  });

  registerDbTools(server, config, db);

  return server;
}

export async function startStdioServer(
  configOverrides?: Partial<GatewayConfig>,
  dbAdapter?: DbAdapter
): Promise<void> {
  const server = createServer(configOverrides, dbAdapter);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[guardbee-gateway] MCP server started (stdio)`);
}

/**
 * Demo adapter — gerçek DB olmadan test amaçlı.
 * TC kimlik ve IBAN gibi hassas veri içeren sahte kayıtlar döner.
 */
function createDemoAdapter(): DbAdapter {
  const demoData: Record<string, Record<string, unknown>[]> = {
    users: [
      {
        id: "user-1",
        email: "ahmet@example.com",
        tcKimlik: "12345678901",
        firstName: "Ahmet",
        lastName: "Yılmaz",
        phone: "5301234567",
        passwordHash: "$2b$10$abcdefghijklmnop",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "user-2",
        email: "ayse@example.com",
        tcKimlik: "98765432100",
        firstName: "Ayşe",
        lastName: "Demir",
        phone: "5399876543",
        passwordHash: "$2b$10$qrstuvwxyz123456",
        createdAt: "2024-02-15T00:00:00Z",
      },
    ],
    orders: [
      {
        id: "ord-1",
        userId: "user-1",
        amount: 299.99,
        iban: "TR320010009999901234567890",
        status: "completed",
        createdAt: "2024-03-10T00:00:00Z",
      },
    ],
    products: [
      { id: "prod-1", name: "Security Audit", price: 499, category: "service" },
      { id: "prod-2", name: "KVKK Report", price: 299, category: "report" },
    ],
    audit_logs: [
      { id: "log-1", action: "login", userId: "user-1", ip: "192.168.1.1" },
    ],
  };

  return {
    async query(table, filter, limit) {
      const rows = demoData[table] ?? [];
      let result = rows;
      // Basit eşleşme filtresi
      if (Object.keys(filter).length > 0) {
        result = rows.filter((row) =>
          Object.entries(filter).every(([k, v]) => row[k] === v)
        );
      }
      return result.slice(0, limit);
    },
    async tables() {
      return Object.keys(demoData);
    },
  };
}
