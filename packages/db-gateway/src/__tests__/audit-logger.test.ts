import { describe, it, expect } from "vitest";
import { AuditLogger, createAuditEvent } from "../audit/logger";
import type { AuditConfig } from "../config";

function makeLogger(overrides: Partial<AuditConfig> = {}) {
  return new AuditLogger({ enabled: true, sink: "console", bufferSize: 200, ...overrides });
}

async function logEvents(
  logger: AuditLogger,
  events: Array<Partial<Parameters<typeof createAuditEvent>[0]>>
) {
  for (const partial of events) {
    await logger.log(
      createAuditEvent({
        tool: "query_table",
        table: "users",
        params: {},
        rowsReturned: 1,
        truncated: false,
        fieldsRedacted: [],
        durationMs: 1,
        ...partial,
      })
    );
  }
}

describe("AuditLogger — query", () => {
  it("hiç event yoksa boş dizi döner", () => {
    const logger = makeLogger();
    expect(logger.query()).toEqual([]);
  });

  it("audit.enabled=false ise log() buffer'a hiçbir şey eklemez", async () => {
    const logger = makeLogger({ enabled: false });
    await logEvents(logger, [{}]);
    expect(logger.query()).toEqual([]);
  });

  it("en yeni event önce döner", async () => {
    const logger = makeLogger();
    await logEvents(logger, [{ table: "a" }, { table: "b" }, { table: "c" }]);
    const results = logger.query();
    expect(results.map((e) => e.table)).toEqual(["c", "b", "a"]);
  });

  it("table filtresi uygulanır", async () => {
    const logger = makeLogger();
    await logEvents(logger, [{ table: "users" }, { table: "orders" }, { table: "users" }]);
    const results = logger.query({ table: "orders" });
    expect(results).toHaveLength(1);
    expect(results[0].table).toBe("orders");
  });

  it("tool filtresi uygulanır", async () => {
    const logger = makeLogger();
    await logEvents(logger, [{ tool: "query_table" }, { tool: "delete_row" }]);
    const results = logger.query({ tool: "delete_row" });
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe("delete_row");
  });

  it("operation filtresi — belirtilmeyen operation 'read' sayılır", async () => {
    const logger = makeLogger();
    await logEvents(logger, [{ operation: undefined }, { operation: "insert" }, { operation: "delete" }]);
    expect(logger.query({ operation: "read" })).toHaveLength(1);
    expect(logger.query({ operation: "insert" })).toHaveLength(1);
    expect(logger.query({ operation: "delete" })).toHaveLength(1);
  });

  it("deniedOnly filtresi sadece reddedilenleri döner", async () => {
    const logger = makeLogger();
    await logEvents(logger, [
      { denied: undefined },
      { denied: true, denyReason: "Rate limit exceeded" },
    ]);
    const results = logger.query({ deniedOnly: true });
    expect(results).toHaveLength(1);
    expect(results[0].denyReason).toBe("Rate limit exceeded");
  });

  it("since filtresi belirtilen zamandan önceki event'leri eler", async () => {
    const logger = makeLogger();
    await logEvents(logger, [{}]);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(logger.query({ since: future })).toHaveLength(0);

    const past = new Date(Date.now() - 60_000).toISOString();
    expect(logger.query({ since: past })).toHaveLength(1);
  });

  it("limit uygulanır ve bufferSize'ı aşamaz", async () => {
    const logger = makeLogger({ bufferSize: 5 });
    await logEvents(logger, Array.from({ length: 10 }, () => ({})));
    expect(logger.query({ limit: 1000 })).toHaveLength(5);
    expect(logger.query({ limit: 2 })).toHaveLength(2);
  });

  it("bufferSize aşıldığında en eski event'ler düşer (ring buffer)", async () => {
    const logger = makeLogger({ bufferSize: 3 });
    await logEvents(logger, [{ table: "a" }, { table: "b" }, { table: "c" }, { table: "d" }]);
    const results = logger.query({ limit: 10 });
    expect(results.map((e) => e.table)).toEqual(["d", "c", "b"]);
  });
});
