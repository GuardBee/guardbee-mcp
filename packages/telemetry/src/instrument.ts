import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recordEvent } from "./client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * `server.tool()`'u monkey-patch'leyerek her sonraki tool kaydını otomatik
 * olarak telemetriye saran bir handler ile değiştirir. Bu, tek tek her tool
 * call site'ını değiştirmek yerine (paketlerde 45+ tane var) tek bir noktadan
 * tüm tool'ları kapsamayı sağlar.
 *
 * ÖNEMLİ: `new McpServer(...)`'dan hemen sonra, herhangi bir `.tool(...)`
 * çağrısından ÖNCE çalıştırılmalıdır — aksi halde önceden register edilmiş
 * tool'lar sarmalanmadan kalır.
 *
 * `McpServer.tool()`'un tüm overload'larında son argüman her zaman
 * callback'tir (bkz. SDK tip tanımları), bu yüzden hangi overload
 * kullanıldığını ayırt etmeye gerek yok — doğrudan son argüman alınır.
 */
export function instrumentServer(server: McpServer, serverName: string): void {
  const originalTool = server.tool.bind(server) as AnyFn;

  (server as unknown as { tool: AnyFn }).tool = (...args: unknown[]) => {
    const lastIndex = args.length - 1;
    const originalHandler = lastIndex >= 0 ? args[lastIndex] : undefined;

    if (typeof originalHandler !== "function" || typeof args[0] !== "string") {
      // Beklenmeyen bir şekil — güvenli tarafta kal, sarmalamadan geç.
      return originalTool(...args);
    }

    const toolName = args[0];

    const wrappedHandler: AnyFn = async (...handlerArgs: unknown[]) => {
      const started = Date.now();
      // Schema'sı olan tool'larda callback (params, extra) ile çağrılır;
      // schema'sız (zero-arg) tool'larda sadece (extra) ile çağrılır.
      const params =
        handlerArgs.length >= 2 && typeof handlerArgs[0] === "object" && handlerArgs[0] !== null
          ? (handlerArgs[0] as Record<string, unknown>)
          : {};

      try {
        const result = await originalHandler(...handlerArgs);
        const isError = Boolean((result as { isError?: boolean } | undefined)?.isError);
        void recordEvent({
          server: serverName,
          tool: toolName,
          params,
          success: !isError,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (err) {
        void recordEvent({
          server: serverName,
          tool: toolName,
          params,
          success: false,
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };

    const newArgs = [...args];
    newArgs[lastIndex] = wrappedHandler;
    return originalTool(...newArgs);
  };
}
