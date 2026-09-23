import { createConnection, type Socket } from "net";
import { connect as tlsConnect, type TLSSocket } from "tls";
import { mkFinding, type Finding, type ProbeOutcome } from "./types.js";

function waitForData(socket: Socket | TLSSocket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    socket.once("data", (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(chunk);
    });
    socket.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.once("close", () => {
      clearTimeout(timer);
      reject(new Error("closed"));
    });
  });
}

function waitForConnect(socket: Socket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Speaks the Redis inline command protocol just far enough to send `PING`
 * without ever sending `AUTH`/credentials. A bare `+PONG` means the instance
 * accepts commands from anyone who can reach the port — for a Redis backing a
 * RediSearch/RedisVL vector index, that's full read/write access to the
 * embeddings too, not just a cache.
 */
export async function probeRedis(host: string, port: number, timeoutMs: number): Promise<ProbeOutcome> {
  const socket = createConnection({ host, port });
  try {
    await waitForConnect(socket, timeoutMs);
    socket.write("PING\r\n");
    const resp = await waitForData(socket, timeoutMs);
    const text = resp.toString("latin1");
    socket.destroy();

    if (/^\+PONG/i.test(text)) {
      return {
        matched: true,
        findings: [
          mkFinding(
            "redis_unauthenticated",
            "Redis responds to PING without authentication — the entire keyspace is readable/writable by anyone who can reach this port",
            "critical",
            "Set `requirepass` (or configure Redis ACLs) and bind this instance to a private network only. If this Redis backs a vector index (RediSearch/RedisVL), unauthenticated access exposes those embeddings too."
          ),
        ],
      };
    }
    if (/^-NOAUTH/i.test(text)) {
      return {
        matched: true,
        findings: [mkFinding("redis_auth_required", "Redis requires authentication (NOAUTH) — PING was rejected as expected", "info", "No action needed; authentication is enforced.")],
      };
    }
    if (/^[-+]/.test(text)) {
      // Some other RESP reply — still a Redis-speaking server, just not a plain PONG/NOAUTH.
      return { matched: true, findings: [] };
    }
    return { matched: false, findings: [] };
  } catch {
    try {
      socket.destroy();
    } catch {
      /* already closed */
    }
    return { matched: false, findings: [] };
  }
}

const SSL_REQUEST_CODE = 80877103; // (1234 << 16) | 5679 — PostgreSQL's magic SSLRequest code

function buildSslRequest(): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(8, 0);
  buf.writeUInt32BE(SSL_REQUEST_CODE, 4);
  return buf;
}

function buildStartupMessage(params: Record<string, string>): Buffer {
  const kv = Object.entries(params).map(([k, v]) => Buffer.from(`${k}\0${v}\0`, "utf8"));
  const body = Buffer.concat([Buffer.from([0, 3, 0, 0]), ...kv, Buffer.from([0])]); // protocol 3.0
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length + 4, 0);
  return Buffer.concat([length, body]);
}

/**
 * Speaks just the connection-opening handshake of the PostgreSQL wire protocol
 * — an SSLRequest, then a StartupMessage for a guessed user/database — and reads
 * the server's first Authentication response. No password is ever sent; we only
 * read which auth method (if any) the server demands. AuthenticationOk (type 0)
 * without any challenge means passwordless/"trust" access is configured for
 * whatever pg_hba.conf rule matched our connection, which for a pgvector-backed
 * Postgres means anyone who can reach the port can read/write the embeddings.
 */
export async function probePostgres(host: string, port: number, timeoutMs: number): Promise<ProbeOutcome> {
  const socket = createConnection({ host, port });
  try {
    await waitForConnect(socket, timeoutMs);
    socket.write(buildSslRequest());
    const sslResp = await waitForData(socket, timeoutMs);
    const sslByte = sslResp.toString("latin1", 0, 1);

    let activeSocket: Socket | TLSSocket = socket;
    let tlsSupported = false;

    if (sslByte === "S") {
      tlsSupported = true;
      const tlsSocket = tlsConnect({ socket, rejectUnauthorized: false });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        tlsSocket.once("secureConnect", () => {
          clearTimeout(timer);
          resolve();
        });
        tlsSocket.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      activeSocket = tlsSocket;
    } else if (sslByte !== "N") {
      socket.destroy();
      return { matched: false, findings: [] };
    }

    activeSocket.write(buildStartupMessage({ user: "guardbee_probe", database: "postgres" }));
    const authResp = await waitForData(activeSocket, timeoutMs);
    activeSocket.destroy();

    const findings: Finding[] = [];
    if (!tlsSupported) {
      findings.push(mkFinding(
        "postgres_no_tls",
        "Server does not offer TLS for this connection",
        "medium",
        "Enable SSL (ssl = on plus a valid certificate) so data in transit — including any pgvector embeddings — is encrypted."
      ));
    }

    const msgType = authResp.toString("latin1", 0, 1);
    if (msgType === "R" && authResp.length >= 9) {
      const authType = authResp.readUInt32BE(5);
      if (authType === 0) {
        findings.push(mkFinding(
          "postgres_unauthenticated",
          "Server accepted the connection with no password required (AuthenticationOk) for a guessed user/database",
          "critical",
          "This pg_hba.conf rule allows passwordless (trust) access. Anyone who can reach this port can connect and read/write any data, including pgvector embeddings. Require md5/scram-sha-256 auth for all non-local connections."
        ));
      } else {
        findings.push(mkFinding("postgres_auth_required", `Server requires authentication (auth type ${authType}) as expected`, "info", "No action needed; a password/SASL challenge is enforced."));
      }
    } else if (msgType === "E") {
      findings.push(mkFinding(
        "postgres_probe_inconclusive",
        "Server responded with an error to the probe (e.g. unknown database/role) — could not confirm the configured auth method",
        "low",
        "Manually verify pg_hba.conf requires a password for real client connections."
      ));
    } else {
      return { matched: false, findings: [] };
    }

    return { matched: true, findings, detail: { tlsSupported } };
  } catch {
    try {
      socket.destroy();
    } catch {
      /* already closed */
    }
    return { matched: false, findings: [] };
  }
}
