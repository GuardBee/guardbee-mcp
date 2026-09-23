import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, type Socket } from "net";
import { probeRedis, probePostgres } from "../tcpProbes.js";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  }
});

function listen(handler: (socket: Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as { port: number }).port));
  });
}

describe("probeRedis", () => {
  it("PONG dönen bir sahte Redis'i unauthenticated olarak yakalar", async () => {
    const port = await listen((socket) => {
      socket.on("data", () => socket.write("+PONG\r\n"));
    });
    const result = await probeRedis("127.0.0.1", port, 1000);
    expect(result.matched).toBe(true);
    expect(result.findings[0]).toMatchObject({ code: "redis_unauthenticated", severity: "critical" });
  });

  it("NOAUTH dönen bir sahte Redis'i auth-required olarak işaretler", async () => {
    const port = await listen((socket) => {
      socket.on("data", () => socket.write("-NOAUTH Authentication required.\r\n"));
    });
    const result = await probeRedis("127.0.0.1", port, 1000);
    expect(result.matched).toBe(true);
    expect(result.findings[0]).toMatchObject({ code: "redis_auth_required", severity: "info" });
  });

  it("RESP olmayan rastgele bir servise matched:false döner", async () => {
    const port = await listen((socket) => {
      socket.on("data", () => socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"));
    });
    const result = await probeRedis("127.0.0.1", port, 1000);
    expect(result.matched).toBe(false);
  });

  it("kapalı bir porta atmadan matched:false döner", async () => {
    const result = await probeRedis("127.0.0.1", 1, 300);
    expect(result.matched).toBe(false);
  });
});

describe("probePostgres", () => {
  function respondNoTlsThenAuth(authPayload: Buffer) {
    return (socket: Socket) => {
      let stage: "ssl" | "startup" = "ssl";
      socket.on("data", () => {
        if (stage === "ssl") {
          socket.write("N");
          stage = "startup";
        } else {
          socket.write(authPayload);
        }
      });
    };
  }

  function authOkPayload(): Buffer {
    const buf = Buffer.alloc(9);
    buf.write("R", 0, "latin1");
    buf.writeUInt32BE(8, 1); // length
    buf.writeUInt32BE(0, 5); // auth type 0 = AuthenticationOk
    return buf;
  }

  function authMd5Payload(): Buffer {
    const buf = Buffer.alloc(13);
    buf.write("R", 0, "latin1");
    buf.writeUInt32BE(12, 1);
    buf.writeUInt32BE(5, 5); // auth type 5 = MD5Password
    buf.writeUInt32BE(0, 9); // salt (irrelevant for the test)
    return buf;
  }

  it("AuthenticationOk (trust) dönen sahte bir Postgres'i critical unauthenticated olarak yakalar", async () => {
    const port = await listen(respondNoTlsThenAuth(authOkPayload()));
    const result = await probePostgres("127.0.0.1", port, 1000);
    expect(result.matched).toBe(true);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("postgres_unauthenticated");
    expect(codes).toContain("postgres_no_tls");
    expect(result.findings.find((f) => f.code === "postgres_unauthenticated")?.severity).toBe("critical");
  });

  it("MD5 auth isteyen sahte bir Postgres'i info olarak işaretler, critical değil", async () => {
    const port = await listen(respondNoTlsThenAuth(authMd5Payload()));
    const result = await probePostgres("127.0.0.1", port, 1000);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("postgres_auth_required");
    expect(codes).not.toContain("postgres_unauthenticated");
  });

  it("Postgres protokolü konuşmayan bir servise matched:false döner", async () => {
    const port = await listen((socket) => {
      socket.on("data", () => socket.write("garbage response not pg protocol"));
    });
    const result = await probePostgres("127.0.0.1", port, 1000);
    expect(result.matched).toBe(false);
  });

  it("kapalı bir porta atmadan matched:false döner", async () => {
    const result = await probePostgres("127.0.0.1", 1, 300);
    expect(result.matched).toBe(false);
  });
});
