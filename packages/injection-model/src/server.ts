import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { InjectionClassifier } from "@guardbee/guard-core";

export interface ServeOptions {
  port?: number;
  /** Loopback by default: the texts may hold personal data. */
  host?: string;
  /** When set, requests must send `Authorization: Bearer <token>`. */
  token?: string;
  /** Largest request body in bytes. */
  maxBodyBytes?: number;
  /** Shown on /healthz. */
  model?: string;
}

const DEFAULT_MAX_BODY = 8 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, `body over ${limit} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authorized(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * The sidecar: `POST /v1/classify` with `{ "texts": [...] }` answers
 * `{ "scores": [0.97, ...], "model": "..." }`, one score per text.
 * `GET /healthz` answers once the model is loaded. Texts are never logged.
 */
export function createClassifierServer(model: InjectionClassifier, options: ServeOptions = {}): Server {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true, ...(options.model ? { model: options.model } : {}) });
      if (options.token && !authorized(req.headers.authorization, options.token)) throw new HttpError(401, "unauthorized");
      if (req.method !== "POST" || req.url !== "/v1/classify") throw new HttpError(404, "not found");
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, limit));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, "body is not JSON");
      }
      const texts = (body as { texts?: unknown } | null)?.texts;
      if (!Array.isArray(texts) || !texts.every((text) => typeof text === "string")) throw new HttpError(400, '"texts" must be an array of strings');
      send(200, { scores: await model.classify(texts), model: model.model });
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { error: err.message });
      // The error may quote a text: report its class only
      send(500, { error: `classification failed (${err instanceof Error ? err.name : typeof err})` });
    }
  });
}
