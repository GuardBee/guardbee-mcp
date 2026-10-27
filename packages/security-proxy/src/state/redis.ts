import net from "net";
import tls from "tls";

/**
 * A small Redis client (RESP2) for the shared counters: commands in order on
 * one connection, `redis://` and `rediss://` (TLS, certificates verified),
 * AUTH with the URL's user and password, SELECT with its path (`/2`). It
 * reconnects on the next command after a failure. Enough for EVAL and a few
 * plain commands; no dependency to install.
 */
export type RedisReply = string | number | null | RedisReply[];

export class RedisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisError";
  }
}

interface Pending {
  resolve: (reply: RedisReply) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RedisOptions {
  /** Per command, from send to reply. */
  timeoutMs?: number;
  /** Extra TLS options (a private CA). */
  tls?: tls.ConnectionOptions;
}

function encode(args: (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const value = Buffer.from(String(arg));
    parts.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

/** Parse one reply at `offset`; undefined when the buffer does not hold all of it yet. */
function parse(buffer: Buffer, offset: number): { reply: RedisReply | RedisError; next: number } | undefined {
  const end = buffer.indexOf("\r\n", offset);
  if (end === -1) return undefined;
  const type = String.fromCharCode(buffer[offset]!);
  const line = buffer.toString("utf8", offset + 1, end);
  switch (type) {
    case "+":
      return { reply: line, next: end + 2 };
    case "-":
      return { reply: new RedisError(line), next: end + 2 };
    case ":":
      return { reply: Number(line), next: end + 2 };
    case "$": {
      const length = Number(line);
      if (length === -1) return { reply: null, next: end + 2 };
      if (buffer.length < end + 2 + length + 2) return undefined;
      return { reply: buffer.toString("utf8", end + 2, end + 2 + length), next: end + 2 + length + 2 };
    }
    case "*": {
      const count = Number(line);
      if (count === -1) return { reply: null, next: end + 2 };
      const items: RedisReply[] = [];
      let next = end + 2;
      for (let i = 0; i < count; i++) {
        const item = parse(buffer, next);
        if (!item) return undefined;
        if (item.reply instanceof RedisError) return { reply: item.reply, next: item.next };
        items.push(item.reply);
        next = item.next;
      }
      return { reply: items, next };
    }
    default:
      throw new RedisError(`unexpected reply type ${JSON.stringify(type)}`);
  }
}

export class RedisClient {
  private socket: net.Socket | undefined;
  private connecting: Promise<net.Socket> | undefined;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly queue: Pending[] = [];
  private readonly url: URL;
  private readonly timeoutMs: number;

  constructor(
    url: string,
    private readonly options: RedisOptions = {},
  ) {
    this.url = new URL(url);
    if (this.url.protocol !== "redis:" && this.url.protocol !== "rediss:") throw new Error(`state.url must be redis:// or rediss://, not ${this.url.protocol}`);
    this.timeoutMs = options.timeoutMs ?? 1000;
  }

  /** Where it connects, without the password. */
  get target(): string {
    return `${this.url.protocol}//${this.url.host}${this.url.pathname}`;
  }

  private fail(err: Error): void {
    for (const pending of this.queue.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.socket?.destroy();
    this.socket = undefined;
    this.connecting = undefined;
    this.buffer = Buffer.alloc(0);
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    let offset = 0;
    for (;;) {
      let parsed: ReturnType<typeof parse>;
      try {
        parsed = parse(this.buffer, offset);
      } catch (err) {
        this.fail(err as Error);
        return;
      }
      if (!parsed) break;
      offset = parsed.next;
      const pending = this.queue.shift();
      if (!pending) continue;
      clearTimeout(pending.timer);
      if (parsed.reply instanceof RedisError) pending.reject(parsed.reply);
      else pending.resolve(parsed.reply);
    }
    this.buffer = this.buffer.subarray(offset);
  }

  private connect(): Promise<net.Socket> {
    if (this.socket) return Promise.resolve(this.socket);
    this.connecting ??= new Promise<net.Socket>((resolve, reject) => {
      const port = Number(this.url.port || 6379);
      const host = this.url.hostname.replace(/^\[|\]$/g, "");
      const socket =
        this.url.protocol === "rediss:" ? tls.connect({ host, port, servername: host, ...this.options.tls }) : net.connect({ host, port });
      const ready = this.url.protocol === "rediss:" ? "secureConnect" : "connect";
      const timer = setTimeout(() => socket.destroy(new RedisError(`no connection to ${this.target} within ${this.timeoutMs} ms`)), this.timeoutMs);
      socket.setNoDelay(true);
      socket.on("data", (chunk: Buffer) => this.onData(chunk));
      socket.on("error", (err) => {
        clearTimeout(timer);
        this.fail(err);
        reject(err);
      });
      socket.on("close", () => this.fail(new RedisError(`connection to ${this.target} closed`)));
      socket.once(ready, () => {
        clearTimeout(timer);
        this.socket = socket;
        const setup: Promise<RedisReply>[] = [];
        const password = decodeURIComponent(this.url.password);
        const user = decodeURIComponent(this.url.username);
        if (password) setup.push(this.send(user ? ["AUTH", user, password] : ["AUTH", password]));
        const db = this.url.pathname.replace(/^\//, "");
        if (db) setup.push(this.send(["SELECT", db]));
        Promise.all(setup).then(
          () => resolve(socket),
          (err: Error) => {
            this.fail(err);
            reject(err);
          },
        );
      });
    });
    return this.connecting;
  }

  private send(args: (string | number)[]): Promise<RedisReply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new RedisError(`no reply from ${this.target} within ${this.timeoutMs} ms`)), this.timeoutMs);
      this.queue.push({ resolve, reject, timer });
      this.socket!.write(encode(args));
    });
  }

  async command(...args: (string | number)[]): Promise<RedisReply> {
    await this.connect();
    return this.send(args);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connecting = undefined;
    if (socket) await new Promise<void>((resolve) => socket.end(resolve));
  }
}
