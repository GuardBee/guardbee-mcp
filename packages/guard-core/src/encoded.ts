/**
 * Personal data inside a base64, base64url or hex run ("token=MTAwMDAwMDAxNDY=",
 * a JWT payload, a hex dump) reads as noise to a regex. A run that decodes to
 * readable text is masked as text and encoded again the way it was written;
 * a run that decodes to binary (a hash, an image, a key) is left alone.
 */

/** Long enough to hold an identifier (ten digits → 14 base64 characters); letters, digits and the base64 punctuation. */
const RUN = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{12,}={0,2}(?![A-Za-z0-9+/_=-])/g;

/** Decoded runs nest (base64 of a JSON with a base64 field); this deep and no deeper. */
export const MAX_ENCODED_DEPTH = 2;

type Encoding = "hex" | "base64" | "base64url";

interface Decoded {
  text: string;
  encoding: Encoding;
  padded: boolean;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Readable: valid UTF-8 with no control characters besides tab and line breaks. */
function readable(bytes: Buffer): string | null {
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text) ? null : text;
}

function decode(run: string): Decoded | null {
  if (/^[0-9a-fA-F]+$/.test(run) && run.length % 2 === 0) {
    const text = readable(Buffer.from(run, "hex"));
    if (text !== null) return { text, encoding: "hex", padded: false };
  }
  // Base64 of text has upper-case letters (most bytes of text start 0x2…0x7, which encode to I…f);
  // a long lower-case word or identifier does not, and is not worth decoding
  if (!/[A-Z]/.test(run)) return null;
  const urlSafe = /[-_]/.test(run);
  if (urlSafe && /[+/]/.test(run)) return null;
  const body = run.replace(/=+$/, "");
  if (body.length % 4 === 1) return null;
  const text = readable(Buffer.from(body, urlSafe ? "base64url" : "base64"));
  // Words and identifiers that happen to be valid base64 decode to short noise: ask for a printable majority
  if (text === null || text.replace(/[^\p{L}\p{N}\p{P}\s]/gu, "").length < text.length * 0.9) return null;
  return { text, encoding: urlSafe ? "base64url" : "base64", padded: run.endsWith("=") };
}

function encode(text: string, { encoding, padded }: Decoded): string {
  const bytes = Buffer.from(text, "utf8");
  if (encoding === "hex") return bytes.toString("hex");
  const out = bytes.toString(encoding);
  if (encoding === "base64url") return out;
  return padded ? out : out.replace(/=+$/, "");
}

/** `text` with every readable encoded run passed through `mask` (decoded) and encoded again when it changed. */
export function maskEncodedRuns(text: string, mask: (decoded: string) => string): string {
  if (text.length < 12) return text;
  return text.replace(RUN, (run) => {
    const decoded = decode(run);
    if (!decoded) return run;
    const masked = mask(decoded.text);
    return masked === decoded.text ? run : encode(masked, decoded);
  });
}
