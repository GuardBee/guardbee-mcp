import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as tls from "tls";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectHost } from "../inspector.js";
import { cipherBits, weakSignature } from "../probes.js";

/**
 * Local TLS servers with certificates made by openssl at test time: a CA, a
 * good leaf, and a 1024-bit leaf signed with SHA-1. No network, no fixtures.
 */
let dir: string;
const pem = (name: string) => readFileSync(join(dir, name));
const servers: tls.Server[] = [];

function openssl(...args: string[]) {
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
}

function leaf(name: string, bits: number, digest: string, host = "localhost") {
  openssl("req", "-newkey", `rsa:${bits}`, "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${host}`);
  writeFileSync(join(dir, `${name}.ext`), `subjectAltName=DNS:${host}\n`);
  openssl("x509", "-req", "-in", `${name}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${name}.crt`, "-days", "30", `-${digest}`, "-extfile", `${name}.ext`);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gb-tls-"));
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "30", "-subj", "/CN=GuardBee Test CA");
  leaf("good", 2048, "sha256");
  leaf("weak", 1024, "sha1");
  leaf("other", 2048, "sha256", "other.example");
  openssl("dhparam", "-out", "dh1024.pem", "1024");
}, 60_000);

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  rmSync(dir, { recursive: true, force: true });
});

async function serve(options: tls.TlsOptions & { leaf: string }): Promise<number> {
  const { leaf: name, ...rest } = options;
  const server = tls.createServer({
    key: pem(`${name}.key`),
    // Send the intermediate (here: the CA) so the chain is complete
    cert: Buffer.concat([pem(`${name}.crt`), pem("ca.crt")]),
    ...rest,
  }, (socket) => socket.end());
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

const codes = (r: Awaited<ReturnType<typeof inspectHost>>) => r.findings.map((f) => f.code);
const inspect = (port: number) => inspectHost("localhost", port, 5000, { caa: false });

describe("probes against local servers", { timeout: 30_000 }, () => {
  it("a modern server: TLS 1.2-1.3 only, forward secrecy only, no legacy findings", async () => {
    const port = await serve({ leaf: "good", minVersion: "TLSv1.2", ciphers: "ECDHE+AESGCM:ECDHE+CHACHA20" });
    const r = await inspect(port);
    expect(r.probes).toMatchObject({ tls10: false, tls11: false, tls13: true, staticRsa: false });
    expect(codes(r)).not.toContain("DEPRECATED_PROTOCOL");
    expect(codes(r)).not.toContain("NO_FORWARD_SECRECY");
    expect(codes(r)).not.toContain("HOSTNAME_MISMATCH");
    expect(r.keyBits).toBe(2048);
  });

  it("finds TLS 1.0/1.1 and RSA key exchange the default handshake never shows", async () => {
    const port = await serve({ leaf: "good", minVersion: "TLSv1", ciphers: "ALL:@SECLEVEL=0" });
    const r = await inspect(port);
    expect(r.protocol).toBe("TLSv1.3"); // what a modern client negotiates
    const legacy = r.findings.filter((f) => f.code === "DEPRECATED_PROTOCOL");
    expect(legacy).toHaveLength(1);
    expect(legacy[0]!.message).toContain("TLS 1.0 and TLS 1.1");
    expect(codes(r)).toContain("NO_FORWARD_SECRECY");
  });

  it("still inspects a server that only speaks TLS 1.0", async () => {
    const port = await serve({ leaf: "good", minVersion: "TLSv1", maxVersion: "TLSv1", ciphers: "ALL:@SECLEVEL=0" });
    const r = await inspect(port);
    expect(r.reachable).toBe(true);
    expect(r.protocol).toBe("TLSv1");
    expect(codes(r).filter((c) => c === "DEPRECATED_PROTOCOL")).toHaveLength(1);
    expect(codes(r)).toContain("NO_TLS13");
  });

  it("flags a 1024-bit key signed with SHA-1", async () => {
    const port = await serve({ leaf: "weak", ciphers: "DEFAULT:@SECLEVEL=0" });
    const r = await inspect(port);
    expect(r.findings).toContainEqual(expect.objectContaining({ code: "WEAK_KEY", severity: "high" }));
    expect(r.findings).toContainEqual(expect.objectContaining({ code: "WEAK_SIGNATURE" }));
    expect(r.weakSignature).toBe("SHA-1 with RSA");
  });

  it("reports a 1024-bit Diffie-Hellman group", async () => {
    const port = await serve({ leaf: "good", maxVersion: "TLSv1.2", ciphers: "DHE-RSA-AES128-GCM-SHA256:@SECLEVEL=0", dhparam: pem("dh1024.pem") });
    const r = await inspect(port);
    expect(r.probes?.dhBits).toBe(1024);
    expect(r.findings).toContainEqual(expect.objectContaining({ code: "WEAK_DH", severity: "high" }));
  });

  it("tells a hostname mismatch and an untrusted chain apart", async () => {
    const port = await serve({ leaf: "other", minVersion: "TLSv1.2" });
    const r = await inspect(port);
    expect(r.findings).toContainEqual(expect.objectContaining({ code: "HOSTNAME_MISMATCH", severity: "critical" }));
    // The test CA is not in the trust store
    expect(codes(r).some((c) => c === "CERT_SELF_SIGNED" || c === "CERT_CHAIN_INVALID" || c === "CERT_CHAIN_INCOMPLETE")).toBe(true);
  });

  it("can skip the probes", async () => {
    const port = await serve({ leaf: "good", minVersion: "TLSv1", ciphers: "ALL:@SECLEVEL=0" });
    const r = await inspectHost("localhost", port, 5000, { probes: false, caa: false });
    expect(r.probes).toBeUndefined();
    expect(codes(r)).not.toContain("DEPRECATED_PROTOCOL");
  });
});

describe("cipher and signature helpers", () => {
  it("knows ChaCha20 is a 256-bit cipher", () => {
    expect(cipherBits("TLS_CHACHA20_POLY1305_SHA256")).toBe(256);
    expect(cipherBits("ECDHE-ECDSA-CHACHA20-POLY1305")).toBe(256);
    expect(cipherBits("TLS_AES_128_GCM_SHA256")).toBe(128);
    expect(cipherBits("ECDHE-RSA-AES256-GCM-SHA384")).toBe(256);
    expect(cipherBits("DES-CBC3-SHA")).toBe(112);
  });

  it("reads a weak signature from the DER", () => {
    expect(weakSignature(Buffer.from("3000" + "06092a864886f70d010105" + "00", "hex"))).toBe("SHA-1 with RSA");
    expect(weakSignature(Buffer.from("3000" + "06092a864886f70d01010b" + "00", "hex"))).toBeNull(); // sha256WithRSA
  });
});
