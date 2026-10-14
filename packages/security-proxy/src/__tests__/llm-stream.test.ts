import { describe, expect, it } from "vitest";
import { maskPiiInText } from "@guardbee/guard-core";
import { HeldText, SseRewriter, type TextRewrite } from "../llm/stream.js";

const mask: TextRewrite = (text) => {
  const hits: Record<string, number> = {};
  const out = maskPiiInText(text, (name) => ((hits[name] = (hits[name] ?? 0) + 1), `[${name}]`));
  return { text: out, hits };
};

const SAMPLE =
  "Müşteri kaydı: TC 10000000146, IBAN TR33 0006 1005 1978 6457 8413 26, kart 4111 1111 1111 1111.\n" +
  "Pasaport No: U12345678 ve Doğum tarihi: 12.05.1990. Telefon 0532 123 45 67, e-posta ali@example.com.\n" +
  "Adres: Moda Cad. No 5 Kadıköy\nAnahtar ghp_1234567890abcdefghijklmnopqrstuvwxyz12 kullanıldı. Bitti.";

/** Feed `text` to a HeldText in pieces cut at `cuts`, return what it released. */
function stream(text: string, cuts: number[], hits: Record<string, number> = {}): string {
  const held = new HeldText(mask, hits);
  let out = "";
  let at = 0;
  for (const cut of [...cuts, text.length]) {
    out += held.push(text.slice(at, cut));
    at = cut;
  }
  return out + held.flush();
}

/** A small deterministic PRNG so failures can be reproduced. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe("HeldText", () => {
  it("gives the same result as masking the whole text, for any chunking", () => {
    const expected = mask(SAMPLE).text;
    const random = rng(7);
    for (let run = 0; run < 300; run++) {
      const cuts: number[] = [];
      for (let at = 0; at < SAMPLE.length; ) {
        at += 1 + Math.floor(random() * 12);
        if (at < SAMPLE.length) cuts.push(at);
      }
      expect(stream(SAMPLE, cuts)).toBe(expected);
    }
  });

  it("one character at a time, and counts each value once", () => {
    const hits: Record<string, number> = {};
    const cuts = Array.from({ length: SAMPLE.length - 1 }, (_, i) => i + 1);
    expect(stream(SAMPLE, cuts, hits)).toBe(mask(SAMPLE).text);
    expect(hits).toEqual(mask(SAMPLE).hits);
  });

  it("releases text as it goes instead of holding all of it", () => {
    const held = new HeldText(mask, {});
    expect(held.push("Merhaba, bugün hava ")).toBe("Merhaba, bugün ");
    expect(held.push("çok güzel ")).toBe("hava çok ");
  });

  it("holds a private key block until its end line", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow IBAAKCAQ EA0 abc\n-----END RSA PRIVATE KEY-----";
    const held = new HeldText(mask, {});
    expect(held.push(`see ${key.slice(0, 40)} more words `)).toBe("see ");
    expect(held.push(key.slice(40) + " done ") + held.flush()).toBe("[private_key] done ");
  });
});

describe("SseRewriter", () => {
  const encode = (s: string) => new TextEncoder().encode(s);

  it("rewrites OpenAI content and tool-call arguments split across chunks", () => {
    const rewriter = new SseRewriter("openai", mask);
    const chunk = (delta: unknown, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    let out = "";
    for (const piece of ["TC 1000", "0000146 ok ", "bye"]) out += rewriter.push(encode(chunk({ content: piece })));
    out += rewriter.push(encode(chunk({ tool_calls: [{ index: 0, id: "t", function: { name: "save", arguments: "" } }] })));
    for (const piece of ['{"mail":"ali@exa', 'mple.com"}']) out += rewriter.push(encode(chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] })));
    out += rewriter.push(encode(chunk({}, "stop")));
    out += rewriter.push(encode("data: [DONE]\n\n"));
    out += rewriter.end();

    let content = "";
    let args = "";
    for (const line of out.split("\n").filter((l) => l.startsWith("data: {"))) {
      const delta = (JSON.parse(line.slice(6)) as { choices: { delta: { content?: string; tool_calls?: { function: { arguments?: string } }[] } }[] }).choices[0]!.delta;
      content += delta.content ?? "";
      args += delta.tool_calls?.[0]?.function.arguments ?? "";
    }
    expect(content).toBe("TC [tc_kimlik] ok bye");
    expect(args).toBe('{"mail":"[email]"}');
    // Held text goes out before the finish chunk, which goes out before [DONE]
    expect(out.indexOf('"finish_reason":"stop"')).toBeGreaterThan(out.lastIndexOf("bye"));
    expect(out.trim().endsWith("data: [DONE]")).toBe(true);
    expect(rewriter.hits).toEqual({ tc_kimlik: 1, email: 1 });
  });

  it("flushes an Anthropic block before its stop event", () => {
    const rewriter = new SseRewriter("anthropic", mask);
    const ev = (type: string, data: Record<string, unknown>) => encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    let out = rewriter.push(ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
    for (const piece of ["mail ali@", "example.com"]) out += rewriter.push(ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: piece } }));
    out += rewriter.push(ev("content_block_stop", { index: 0 }));
    out += rewriter.end();
    expect(out).toContain('"text":"mail "');
    expect(out).toContain('"text":"[email]"');
    expect(out).not.toContain("example.com");
    expect(out.indexOf("content_block_stop")).toBeGreaterThan(out.indexOf("[email]"));
  });
});
