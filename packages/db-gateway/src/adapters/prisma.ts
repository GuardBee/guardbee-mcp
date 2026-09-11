import type { DbAdapter } from "../types";

/**
 * Prisma model delegate'lerinin findMany metoduna sahip olup olmadığını kontrol eder.
 * $, _ ile başlayan Prisma internal property'lerini dışlar.
 */
function isModelDelegate(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["findMany"] === "function"
  );
}

/**
 * MCP tool'unun gönderdiği tablo adını Prisma model accessor key'ine çevirir.
 *
 * Örnekler:
 *   "users"      → "user"       (plural → singular)
 *   "audit_logs" → "auditLog"   (snake_case → camelCase singular)
 *   "orderItems" → "orderItem"  (camelCase plural → singular)
 *   "user"       → "user"       (zaten doğru)
 */
function resolveModelKey(
  prisma: Record<string, unknown>,
  table: string
): string | null {
  const candidates: string[] = [];

  // 1. Doğrudan eşleşme
  candidates.push(table);

  // 2. snake_case → camelCase: "audit_logs" → "auditLogs"
  const camel = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  candidates.push(camel);

  // 3. Tekil (plural s kaldır): "users" → "user", "auditLogs" → "auditLog"
  if (table.endsWith("s")) candidates.push(table.slice(0, -1));
  if (camel.endsWith("s")) candidates.push(camel.slice(0, -1));

  for (const key of candidates) {
    if (isModelDelegate(prisma[key])) return key;
  }

  return null;
}

/**
 * Prisma'nın `where` clause'u için filter nesnesini hazırlar.
 * Basit eşitlik filtreleri doğrudan geçer.
 * ISO date string'leri Date objesine çevrilir (Prisma DateTime field'ları için).
 */
function buildWhereClause(filter: Record<string, unknown>): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const isoDateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === "string" && isoDateRe.test(value)) {
      where[key] = new Date(value);
    } else {
      where[key] = value;
    }
  }

  return where;
}

/**
 * Kullanıcının PrismaClient instance'ını kabul eder ve DbAdapter döner.
 *
 * Kullanım:
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { createPrismaAdapter } from "@guardbee/mcp-db-gateway/adapters/prisma";
 *
 * const prisma = new PrismaClient();
 * const server = createServer({}, createPrismaAdapter(prisma));
 * ```
 *
 * NOT: @prisma/client bu paketin peer dependency'sidir.
 * Prisma client'ı generate etmek için `npx prisma generate` çalıştırın.
 */
export function createPrismaAdapter(
  // PrismaClient tipini doğrudan import etmiyoruz — kullanıcının generate ettiği
  // client'ı alıyoruz. `unknown` yerine loose bir type kullanıyoruz.
  prisma: object
): DbAdapter {
  const p = prisma as Record<string, unknown>;

  return {
    async query(table, filter, limit) {
      const key = resolveModelKey(p, table);
      if (!key) {
        throw new Error(
          `[guardbee-gateway] Prisma model not found for table "${table}". ` +
          `Available models: ${availableModels(p).join(", ")}`
        );
      }

      const delegate = p[key] as {
        findMany(args: { where: Record<string, unknown>; take: number }): Promise<unknown[]>;
      };

      const where = Object.keys(filter).length > 0 ? buildWhereClause(filter) : {};
      const rows = await delegate.findMany({ where, take: limit });

      return rows as Record<string, unknown>[];
    },

    async tables() {
      return availableModels(p);
    },
  };
}

/** Prisma instance'ından model accessor adlarını listeler. */
function availableModels(p: Record<string, unknown>): string[] {
  return Object.keys(p)
    .filter((k) => !k.startsWith("$") && !k.startsWith("_") && isModelDelegate(p[k]))
    .sort();
}
