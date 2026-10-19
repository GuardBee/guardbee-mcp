import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelDetector } from "@guardbee/guard-core";
import { afterEach, describe, expect, it } from "vitest";
import { verifyModel } from "../model-files.js";
import { createNerServer } from "../server.js";

/** Tags every "Ayşe" as a name; throws on "boom" with the text in its message. */
const fake: ModelDetector = {
  async detect(texts) {
    return texts.map((text) => {
      if (text.includes("boom")) throw new TypeError(`cannot read ${text}`);
      const at = text.indexOf("Ayşe");
      return at < 0 ? [] : [{ start: at, end: at + 4, detector: "person_name" }];
    });
  },
};

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

async function serve(options: Parameters<typeof createNerServer>[1] = {}) {
  const server = createNerServer(fake, options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (path: string, init?: RequestInit) => fetch(url + path, init);
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("sidecar", () => {
  it("answers one span list per text", async () => {
    const call = await serve();
    const response = await call("/v1/detect", post({ texts: ["Ayşe geldi", "kimse yok"] }));
    expect(await response.json()).toEqual({ spans: [[{ start: 0, end: 4, detector: "person_name" }], []] });
  });

  it("requires the bearer token when one is set, but not for /healthz", async () => {
    const call = await serve({ token: "s3cret", model: "test@1" });
    expect((await call("/v1/detect", post({ texts: ["Ayşe"] }))).status).toBe(401);
    expect((await call("/v1/detect", post({ texts: ["Ayşe"] }, { authorization: "Bearer wrong!" }))).status).toBe(401);
    expect((await call("/v1/detect", post({ texts: ["Ayşe"] }, { authorization: "Bearer s3cret" }))).status).toBe(200);
    expect(await (await call("/healthz")).json()).toEqual({ ok: true, model: "test@1" });
  });

  it("rejects a malformed or oversized body", async () => {
    const call = await serve({ maxBodyBytes: 100 });
    expect((await call("/v1/detect", { method: "POST", body: "{not json" })).status).toBe(400);
    expect((await call("/v1/detect", post({ texts: [1, 2] }))).status).toBe(400);
    expect((await call("/v1/detect", post({ texts: ["x".repeat(200)] }))).status).toBe(413);
    expect((await call("/v1/other", post({ texts: [] }))).status).toBe(404);
  });

  it("reports a failed detection without the text", async () => {
    const call = await serve();
    const response = await call("/v1/detect", post({ texts: ["boom: Ayşe Yılmaz 10000000146"] }));
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("TypeError");
    expect(body).not.toContain("Ayşe");
  });
});

describe("verifyModel", () => {
  it("names files that are missing, resized or altered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ner-"));
    const content = "{}";
    writeFileSync(join(dir, "ok.json"), content);
    writeFileSync(join(dir, "altered.json"), "{!}");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const spec = {
      repo: "test",
      revision: "0",
      types: {},
      files: [
        { path: "ok.json", sha256, size: 2 },
        { path: "altered.json", sha256: createHash("sha256").update("{?}").digest("hex"), size: 3 },
        { path: "missing.onnx", sha256, size: 2 },
      ],
    };
    expect(await verifyModel(dir, spec)).toEqual(["altered.json", "missing.onnx"]);
  });
});
