// Property lists as iOS bundles ship them: binary (bplist00) for Info.plist,
// XML inside embedded.mobileprovision and entitlements. Only what the checks
// need: dictionaries, arrays, strings, booleans and integers.

export type PlistValue = string | number | boolean | null | Buffer | PlistValue[] | { [key: string]: PlistValue };

export function parsePlist(buf: Buffer): PlistValue | null {
  if (buf.length >= 8 && buf.toString("latin1", 0, 8) === "bplist00") return parseBinary(buf);
  const text = buf.toString("utf8");
  const start = text.indexOf("<plist");
  return start === -1 ? null : parseXml(text.slice(start));
}

/** The XML plist inside a CMS-signed blob such as embedded.mobileprovision. */
export function plistInside(buf: Buffer): PlistValue | null {
  const text = buf.toString("latin1");
  const start = text.indexOf("<?xml");
  const end = text.indexOf("</plist>", start);
  if (start === -1 || end === -1) return null;
  return parseXml(Buffer.from(text.slice(start, end + 8), "latin1").toString("utf8"));
}

function parseBinary(buf: Buffer): PlistValue | null {
  if (buf.length < 40) return null;
  const t = buf.length - 32;
  const offsetSize = buf[t + 6];
  const refSize = buf[t + 7];
  const numObjects = Number(buf.readBigUInt64BE(t + 8));
  const top = Number(buf.readBigUInt64BE(t + 16));
  const tableOffset = Number(buf.readBigUInt64BE(t + 24));
  const readUInt = (p: number, size: number) => {
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + buf[p + i];
    return v;
  };
  const offsetOf = (ref: number) => readUInt(tableOffset + ref * offsetSize, offsetSize);

  const parse = (ref: number, depth: number): PlistValue => {
    if (depth > 32 || ref >= numObjects) return null;
    let p = offsetOf(ref);
    const marker = buf[p];
    const kind = marker >> 4;
    let len = marker & 0x0f;
    p++;
    if (kind === 0x0) return marker === 0x09 ? true : marker === 0x08 ? false : null;
    if (kind === 0x1) return readUInt(p, 1 << len);
    if ((kind === 0x4 || kind === 0x5 || kind === 0x6 || kind === 0xa || kind === 0xd) && len === 0x0f) {
      const intSize = 1 << (buf[p] & 0x0f);
      len = readUInt(p + 1, intSize);
      p += 1 + intSize;
    }
    switch (kind) {
      case 0x4:
        return buf.subarray(p, p + len);
      case 0x5:
        return buf.toString("latin1", p, p + len);
      case 0x6: {
        const chars: string[] = [];
        for (let i = 0; i < len; i++) chars.push(String.fromCharCode(buf.readUInt16BE(p + i * 2)));
        return chars.join("");
      }
      case 0xa:
        return Array.from({ length: len }, (_, i) => parse(readUInt(p + i * refSize, refSize), depth + 1));
      case 0xd: {
        const out: { [key: string]: PlistValue } = {};
        for (let i = 0; i < len; i++) {
          const key = parse(readUInt(p + i * refSize, refSize), depth + 1);
          out[String(key)] = parse(readUInt(p + (len + i) * refSize, refSize), depth + 1);
        }
        return out;
      }
      default:
        return null; // reals, dates, uids: not needed
    }
  };

  try {
    return parse(top, 0);
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** A small tokenizer over plist XML tags; plists from Xcode are well-formed and shallow. */
function parseXml(text: string): PlistValue | null {
  const tokens: Array<{ tag: string; close: boolean; self: boolean; text: string }> = [];
  let p = 0;
  while (p < text.length) {
    const lt = text.indexOf("<", p);
    if (lt === -1) break;
    const gt = text.indexOf(">", lt);
    if (gt === -1) break;
    const raw = text.slice(lt + 1, gt);
    const nextLt = text.indexOf("<", gt);
    const body = nextLt === -1 ? "" : text.slice(gt + 1, nextLt);
    p = gt + 1;
    if (raw.startsWith("?") || raw.startsWith("!")) continue;
    const close = raw.startsWith("/");
    const self = raw.endsWith("/");
    const tag = raw.replace(/^\//, "").replace(/\/$/, "").trim().split(/\s/)[0];
    tokens.push({ tag, close, self, text: body });
  }

  let i = 0;
  const value = (depth: number): PlistValue => {
    if (depth > 32 || i >= tokens.length) return null;
    const t = tokens[i++];
    if (t.self) return t.tag === "true" ? true : t.tag === "false" ? false : t.tag === "dict" ? {} : t.tag === "array" ? [] : null;
    if (t.tag === "string" || t.tag === "key" || t.tag === "date") {
      i++; // closing tag
      return decodeEntities(t.text);
    }
    if (t.tag === "integer" || t.tag === "real") {
      i++;
      return Number(t.text.trim());
    }
    if (t.tag === "data") {
      i++;
      return Buffer.from(t.text.replace(/\s+/g, ""), "base64");
    }
    if (t.tag === "array") {
      const out: PlistValue[] = [];
      while (i < tokens.length && !(tokens[i].close && tokens[i].tag === "array")) out.push(value(depth + 1));
      i++;
      return out;
    }
    if (t.tag === "dict") {
      const out: { [key: string]: PlistValue } = {};
      while (i < tokens.length && !(tokens[i].close && tokens[i].tag === "dict")) {
        const key = value(depth + 1);
        out[String(key)] = value(depth + 1);
      }
      i++;
      return out;
    }
    if (t.tag === "plist") return value(depth + 1);
    return null;
  };

  try {
    return value(0);
  } catch {
    return null;
  }
}
