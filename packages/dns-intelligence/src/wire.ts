import * as dgram from "dgram";
import * as net from "net";

/**
 * Minimal DNS wire format (RFC 1035) for the checks Node's resolver cannot do:
 * asking one specific server, reading its AA/RA flags, and AXFR over TCP.
 */

export const TYPE = { A: 1, NS: 2, SOA: 6, AXFR: 252 } as const;

export interface DnsMessage {
  id: number;
  /** Authoritative answer. */
  aa: boolean;
  /** Recursion available. */
  ra: boolean;
  /** 0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN, 5 REFUSED, … */
  rcode: number;
  answers: Array<{ name: string; type: number; data: Buffer; offset: number }>;
  /** The whole message, for decompressing names inside RDATA. */
  raw: Buffer;
}

export function encodeQuery(name: string, type: number, opts: { id?: number; recursion?: boolean } = {}): Buffer {
  const labels = name.replace(/\.$/, "").split(".").filter(Boolean);
  const qname = Buffer.concat([
    ...labels.map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, "ascii")])),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(opts.id ?? Math.floor(Math.random() * 0xffff), 0);
  header.writeUInt16BE(opts.recursion ? 0x0100 : 0x0000, 2); // RD bit
  header.writeUInt16BE(1, 4); // QDCOUNT
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2); // class IN
  return Buffer.concat([header, qname, tail]);
}

/** Read a (possibly compressed) name at `offset`; returns the name and the offset after it. */
export function readName(buf: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let pos = offset;
  let next = -1;
  for (let hops = 0; hops < 64; hops++) {
    const len = buf[pos];
    if (len === undefined) throw new Error("truncated name");
    if (len === 0) {
      if (next < 0) next = pos + 1;
      return { name: labels.join("."), next };
    }
    if ((len & 0xc0) === 0xc0) {
      if (next < 0) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1]!;
      continue;
    }
    labels.push(buf.toString("ascii", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  throw new Error("name compression loop");
}

export function decodeMessage(buf: Buffer): DnsMessage {
  if (buf.length < 12) throw new Error("short DNS message");
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  let pos = 12;
  for (let i = 0; i < qd; i++) pos = readName(buf, pos).next + 4;
  const answers: DnsMessage["answers"] = [];
  for (let i = 0; i < an; i++) {
    const { name, next } = readName(buf, pos);
    const type = buf.readUInt16BE(next);
    const rdlen = buf.readUInt16BE(next + 8);
    const start = next + 10;
    answers.push({ name, type, data: buf.subarray(start, start + rdlen), offset: start });
    pos = start + rdlen;
  }
  return {
    id: buf.readUInt16BE(0),
    aa: (flags & 0x0400) !== 0,
    ra: (flags & 0x0080) !== 0,
    rcode: flags & 0x000f,
    answers,
    raw: buf,
  };
}

/** Primary server (MNAME) and serial of an SOA answer (MNAME, RNAME, then five 32-bit fields). */
export function soaFields(msg: DnsMessage, answer: DnsMessage["answers"][number]): { mname: string; serial: number } {
  const mname = readName(msg.raw, answer.offset);
  const afterRname = readName(msg.raw, mname.next).next;
  return { mname: mname.name.toLowerCase(), serial: msg.raw.readUInt32BE(afterRname) };
}

export interface DnsTransport {
  udp(server: string, query: Buffer, timeoutMs: number): Promise<Buffer>;
  /** Returns every message the server sends until it closes the connection (AXFR may span several). */
  tcp(server: string, query: Buffer, timeoutMs: number, maxMessages?: number): Promise<Buffer[]>;
}

/** Sockets to port 53 (or another port, for tests against a local server). */
export function socketTransportOn(port = 53): DnsTransport {
  return {
    udp: (server, query, timeoutMs) => udp(server, port, query, timeoutMs),
    tcp: (server, query, timeoutMs, maxMessages) => tcp(server, port, query, timeoutMs, maxMessages),
  };
}

export const socketTransport: DnsTransport = socketTransportOn(53);

const transportImpl = {
  udp(server: string, port: number, query: Buffer, timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket(net.isIPv6(server) ? "udp6" : "udp4");
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error("timeout"));
      }, timeoutMs);
      sock.on("message", (msg) => {
        clearTimeout(timer);
        sock.close();
        resolve(msg);
      });
      sock.on("error", (err) => {
        clearTimeout(timer);
        sock.close();
        reject(err);
      });
      sock.send(query, port, server);
    });
  },
  tcp(server: string, port: number, query: Buffer, timeoutMs: number, maxMessages = 3): Promise<Buffer[]> {
    return new Promise((resolve, reject) => {
      const messages: Buffer[] = [];
      let pending = Buffer.alloc(0);
      const socket = net.connect({ host: server, port });
      const done = (err?: Error) => {
        clearTimeout(timer);
        socket.destroy();
        if (err && messages.length === 0) reject(err);
        else resolve(messages);
      };
      const timer = setTimeout(() => done(new Error("timeout")), timeoutMs);
      socket.on("connect", () => {
        const len = Buffer.alloc(2);
        len.writeUInt16BE(query.length);
        socket.write(Buffer.concat([len, query]));
      });
      socket.on("data", (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 2) {
          const len = pending.readUInt16BE(0);
          if (pending.length < 2 + len) break;
          messages.push(pending.subarray(2, 2 + len));
          pending = pending.subarray(2 + len);
          // Enough to judge a transfer; do not download a whole zone.
          if (messages.length >= maxMessages) return done();
        }
      });
      socket.on("end", () => done());
      socket.on("error", (err) => done(err));
    });
  },
};

const { udp, tcp } = transportImpl;
