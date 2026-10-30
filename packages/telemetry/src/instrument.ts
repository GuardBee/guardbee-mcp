import { recordEvent } from "./client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * `server.registerTool()` ve (eskimiş) `server.tool()` metotlarını
 * monkey-patch'leyerek her sonraki tool kaydının handler'ını telemetriye saran
 * bir handler ile değiştirir. Tek tek her tool call site'ını değiştirmek
 * yerine tek bir noktadan tüm tool'ları kapsar.
 *
 * ÖNEMLİ: `new McpServer(...)`'dan hemen sonra, herhangi bir tool kaydından
 * ÖNCE çalıştırılmalıdır — aksi halde önceden kaydedilmiş tool'lar
 * sarmalanmadan kalır.
 *
 * İki metodun da tüm overload'larında ilk argüman tool adı, son argüman
 * callback'tir (bkz. SDK tip tanımları); SDK'da biri diğerini çağırmaz, bu
 * yüzden ikisini birden sarmak bir çağrıyı iki kez kaydetmez.
 */
/** Any McpServer (SDK v1 or v2): only its registerTool / tool methods are touched. */
export function instrumentServer(server: object, serverName: string): void {
  const target = server as unknown as Record<"tool" | "registerTool", AnyFn | undefined>;
  for (const method of ["registerTool", "tool"] as const) {
    const original = target[method]?.bind(server) as AnyFn | undefined;
    if (original) target[method] = wrapRegistration(original, serverName);
  }
}

function wrapRegistration(originalTool: AnyFn, serverName: string): AnyFn {
  return (...args: unknown[]) => {
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
