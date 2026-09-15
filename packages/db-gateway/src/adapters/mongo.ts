import type { DbAdapter } from "../types";
import { assertPositiveInteger } from "./sql-utils";

/**
 * MongoDB Node.js driver'ının `Collection`/`Db` tiplerinin ortak kesişimi —
 * gerçek `mongodb` paketini bağımlılık olarak eklemeden yapısal tip uyumu
 * sağlar (bkz. `PgQueryable`/`MysqlQueryable`'daki aynı yaklaşım).
 */
export type MongoCollection = {
  find(filter: Record<string, unknown>): {
    limit(n: number): { toArray(): Promise<Record<string, unknown>[]> };
  };
  insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }>;
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ modifiedCount: number }>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
};

export type MongoDatabase = {
  collection(name: string): MongoCollection;
  listCollections(): { toArray(): Promise<Array<{ name: string }>> };
};

function isScalar(value: unknown): boolean {
  if (value === null) return true;
  if (value instanceof Date) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

/**
 * pg/mysql/sqlite adaptörlerinde risk "SQL identifier injection"dır (tablo/kolon
 * adı SQL'e gömülür). MongoDB'de identifier gömülmez ama farklı bir risk vardır:
 * **operator injection** — `filter`/`data` içindeki bir key `$ne`, `$where` gibi bir
 * Mongo operatörü olursa ya da bir değer `{ $ne: null }` gibi bir operatör objesi
 * olursa, LLM'in gönderdiği "basit eşitlik filtresi" gizlice keyfi bir sorguya
 * dönüşebilir (örn. auth bypass ya da sunucu tarafı JS çalıştırma). Bu adaptör
 * bu yüzden `$`ile başlayan ya da `.` içeren key'leri (nokta = nested path update,
 * field koruma kontrolünü es geçebilir) ve filter değeri olarak skaler olmayan
 * (obje/array) her şeyi baştan reddeder — tool'ların beyan ettiği "key-value
 * eşitlik filtresi" sözleşmesinin ötesine hiçbir şey geçemez.
 */
function assertSafeKeys(obj: Record<string, unknown>, kind: "filter" | "data"): void {
  for (const key of Object.keys(obj)) {
    if (key.startsWith("$")) {
      throw new Error(`[guardbee-gateway] Invalid ${kind} key "${key}": MongoDB operator keys ($...) are not allowed.`);
    }
    if (key.includes(".")) {
      throw new Error(
        `[guardbee-gateway] Invalid ${kind} key "${key}": dotted paths are not allowed — use exact top-level field names.`
      );
    }
  }
}

function assertScalarFilter(filter: Record<string, unknown>): void {
  assertSafeKeys(filter, "filter");
  for (const [key, value] of Object.entries(filter)) {
    if (!isScalar(value)) {
      throw new Error(
        `[guardbee-gateway] Invalid filter value for "${key}": only exact scalar values are allowed (no operator objects/arrays).`
      );
    }
  }
}

/**
 * MongoDB Node.js driver'ının `Db` örneğini (`client.db("mydb")`) kabul eder
 * ve DbAdapter döner. "Tablo" burada bir collection'a karşılık gelir.
 *
 * Kullanım:
 * ```ts
 * import { MongoClient } from "mongodb";
 * import { createServer, createMongoAdapter } from "@guardbee/mcp-db-gateway";
 *
 * const client = new MongoClient(process.env.DATABASE_URL!);
 * await client.connect();
 * const server = createServer({}, createMongoAdapter(client.db("mydb")));
 * ```
 *
 * Güvenlik notu: yukarıdaki `assertSafeKeys`/`assertScalarFilter`'a bakın —
 * operatör anahtarları, noktalı path'ler ve operatör-objesi değerler baştan
 * reddedilir. update/delete ayrıca boş filtreyi reddeder; "tüm collection'ı
 * etkileme" koruması gateway pipeline'ındadır (maxAffectedRowsPerWrite), bu
 * sadece ek bir güvenlik ağı.
 */
export function createMongoAdapter(db: MongoDatabase): DbAdapter {
  return {
    async tables() {
      const collections = await db.listCollections().toArray();
      return collections.map((c) => c.name);
    },

    async query(table, filter, limit) {
      assertPositiveInteger(limit, "limit");
      assertScalarFilter(filter);
      return db.collection(table).find(filter).limit(limit).toArray();
    },

    async insert(table, data) {
      assertSafeKeys(data, "data");
      const result = await db.collection(table).insertOne(data);
      return { ...data, _id: result.insertedId };
    },

    async update(table, filter, data) {
      if (Object.keys(data).length === 0) {
        throw new Error("[guardbee-gateway] update requires at least one field to set.");
      }
      if (Object.keys(filter).length === 0) {
        throw new Error("[guardbee-gateway] update requires a non-empty filter.");
      }
      assertScalarFilter(filter);
      assertSafeKeys(data, "data");

      const result = await db.collection(table).updateMany(filter, { $set: data });
      return result.modifiedCount;
    },

    async delete(table, filter) {
      if (Object.keys(filter).length === 0) {
        throw new Error("[guardbee-gateway] delete requires a non-empty filter.");
      }
      assertScalarFilter(filter);

      const result = await db.collection(table).deleteMany(filter);
      return result.deletedCount;
    },
  };
}
