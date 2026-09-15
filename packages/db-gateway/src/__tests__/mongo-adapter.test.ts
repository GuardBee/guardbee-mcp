import { describe, it, expect } from "vitest";
import { createMongoAdapter, type MongoDatabase } from "../adapters/mongo";

function makeMockDb(): {
  db: MongoDatabase;
  calls: Array<{ op: string; table: string; args: unknown[] }>;
} {
  const calls: Array<{ op: string; table: string; args: unknown[] }> = [];

  const collections: Record<string, Record<string, unknown>[]> = {
    users: [
      { _id: "1", email: "a@b.com", status: "active" },
      { _id: "2", email: "c@d.com", status: "inactive" },
    ],
    orders: [],
  };

  function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }

  const db: MongoDatabase = {
    listCollections() {
      return {
        async toArray() {
          return Object.keys(collections).map((name) => ({ name }));
        },
      };
    },
    collection(name: string) {
      return {
        find(filter: Record<string, unknown>) {
          calls.push({ op: "find", table: name, args: [filter] });
          const docs = collections[name] ?? [];
          const filtered = Object.keys(filter).length > 0 ? docs.filter((d) => matches(d, filter)) : docs;
          return {
            limit(n: number) {
              return {
                async toArray() {
                  return filtered.slice(0, n);
                },
              };
            },
          };
        },
        async insertOne(doc: Record<string, unknown>) {
          calls.push({ op: "insertOne", table: name, args: [doc] });
          const rows = (collections[name] ??= []);
          const insertedId = `generated-${rows.length + 1}`;
          rows.push({ _id: insertedId, ...doc });
          return { insertedId };
        },
        async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
          calls.push({ op: "updateMany", table: name, args: [filter, update] });
          const rows = collections[name] ?? [];
          let count = 0;
          for (const row of rows) {
            if (matches(row, filter)) {
              Object.assign(row, (update.$set as Record<string, unknown>) ?? {});
              count++;
            }
          }
          return { modifiedCount: count };
        },
        async deleteMany(filter: Record<string, unknown>) {
          calls.push({ op: "deleteMany", table: name, args: [filter] });
          const rows = collections[name] ?? [];
          const before = rows.length;
          collections[name] = rows.filter((r) => !matches(r, filter));
          return { deletedCount: before - collections[name].length };
        },
      };
    },
  };

  return { db, calls };
}

describe("createMongoAdapter — tables()", () => {
  it("collection adlarını döner", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    expect(await adapter.tables()).toEqual(["users", "orders"]);
  });
});

describe("createMongoAdapter — query()", () => {
  it("filtresiz sorguda tüm dokümanları döner", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    const rows = await adapter.query("users", {}, 50);
    expect(rows.length).toBe(2);
  });

  it("filtreyi doğrudan find'a geçirir", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    const rows = await adapter.query("users", { status: "active" }, 50);
    expect(rows).toEqual([{ _id: "1", email: "a@b.com", status: "active" }]);

    const finalCall = calls.at(-1);
    expect(finalCall?.args[0]).toEqual({ status: "active" });
  });

  it("limit'i uygular", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await adapter.query("users", {}, 1);
    expect(calls.length).toBe(1); // limit find sonrası zincirde uygulanıyor, ekstra çağrı yok
  });

  it("geçersiz limit'i reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.query("users", {}, -1)).rejects.toThrow("Invalid limit");
  });

  it("$ ile başlayan operatör key'ini reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.query("users", { $where: "1==1" }, 10)).rejects.toThrow("operator keys");
    expect(calls.length).toBe(0);
  });

  it("noktalı path key'ini reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.query("users", { "address.city": "X" }, 10)).rejects.toThrow("dotted paths");
    expect(calls.length).toBe(0);
  });

  it("operatör objesi değeri reddeder ($ne bypass denemesi)", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.query("users", { status: { $ne: "active" } }, 10)).rejects.toThrow(
      "only exact scalar values"
    );
    expect(calls.length).toBe(0);
  });

  it("array değeri reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.query("users", { status: ["active", "inactive"] }, 10)).rejects.toThrow(
      "only exact scalar values"
    );
  });
});

describe("createMongoAdapter — insert()", () => {
  it("insertOne çağırır, insertedId'yi _id olarak satıra ekler", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    const row = await adapter.insert!("orders", { amount: 100, status: "new" });
    expect(row).toEqual({ amount: 100, status: "new", _id: "generated-1" });

    const insertCall = calls.at(-1);
    expect(insertCall?.op).toBe("insertOne");
    expect(insertCall?.args[0]).toEqual({ amount: 100, status: "new" });
  });

  it("$ ile başlayan data key'ini reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.insert!("orders", { $set: { x: 1 } })).rejects.toThrow("operator keys");
    expect(calls.length).toBe(0);
  });

  it("noktalı data key'ini reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.insert!("orders", { "address.city": "X" })).rejects.toThrow("dotted paths");
  });
});

describe("createMongoAdapter — update()", () => {
  it("$set ile updateMany çağırır, modifiedCount döner", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    const count = await adapter.update!("users", { status: "active" }, { email: "changed@x.com" });
    expect(count).toBe(1);

    const updateCall = calls.at(-1);
    expect(updateCall?.args[0]).toEqual({ status: "active" });
    expect(updateCall?.args[1]).toEqual({ $set: { email: "changed@x.com" } });
  });

  it("boş filtre ile reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.update!("users", {}, { email: "x" })).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("boş data ile reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.update!("users", { status: "active" }, {})).rejects.toThrow("at least one field");
  });

  it("noktalı data key'ini reddeder (field koruma bypass denemesi)", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.update!("users", { status: "active" }, { "passwordHash.reset": "x" })).rejects.toThrow(
      "dotted paths"
    );
  });
});

describe("createMongoAdapter — delete()", () => {
  it("deleteMany çağırır, deletedCount döner", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    const count = await adapter.delete!("users", { status: "inactive" });
    expect(count).toBe(1);

    const deleteCall = calls.at(-1);
    expect(deleteCall?.op).toBe("deleteMany");
    expect(deleteCall?.args[0]).toEqual({ status: "inactive" });
  });

  it("boş filtre ile reddeder", async () => {
    const { db, calls } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.delete!("users", {})).rejects.toThrow("non-empty filter");
    expect(calls.length).toBe(0);
  });

  it("operatör objesi değeri reddeder", async () => {
    const { db } = makeMockDb();
    const adapter = createMongoAdapter(db);
    await expect(adapter.delete!("users", { status: { $exists: true } })).rejects.toThrow(
      "only exact scalar values"
    );
  });
});
