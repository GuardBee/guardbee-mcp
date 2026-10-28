// Android App Bundles store AndroidManifest.xml as an aapt2 protobuf XmlNode
// (Resources.proto) instead of binary AXML. Only the element tree is needed:
//   XmlNode      { XmlElement element = 1; string text = 2; }
//   XmlElement   { string namespace_uri = 2; string name = 3; repeated XmlAttribute attribute = 4; repeated XmlNode child = 5; }
//   XmlAttribute { string namespace_uri = 1; string name = 2; string value = 3; uint32 resource_id = 5; Item compiled_item = 6; }
// aapt2 keeps the attribute's source text in `value` ("true", "com.example"),
// so booleans are read from there without decoding compiled_item.
import type { AxmlAttribute, AxmlElement } from "./axml.js";

interface Field {
  no: number;
  wire: number;
  /** varint value for wire type 0 */
  num?: number;
  /** bytes for wire type 2 */
  bytes?: Buffer;
}

function readVarint(buf: Buffer, p: number): { value: number; next: number } {
  let value = 0;
  let mul = 1;
  for (let i = 0; i < 10; i++) {
    if (p >= buf.length) throw new Error("truncated varint");
    const b = buf[p++];
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) return { value, next: p };
    mul *= 128;
  }
  throw new Error("varint too long");
}

export function readFields(buf: Buffer): Field[] {
  const fields: Field[] = [];
  let p = 0;
  while (p < buf.length) {
    const key = readVarint(buf, p);
    p = key.next;
    const no = Math.floor(key.value / 8);
    const wire = key.value & 7;
    if (wire === 0) {
      const v = readVarint(buf, p);
      fields.push({ no, wire, num: v.value });
      p = v.next;
    } else if (wire === 2) {
      const len = readVarint(buf, p);
      p = len.next;
      if (p + len.value > buf.length) throw new Error("truncated field");
      fields.push({ no, wire, bytes: buf.subarray(p, p + len.value) });
      p += len.value;
    } else if (wire === 5) {
      p += 4;
    } else if (wire === 1) {
      p += 8;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return fields;
}

function parseAttribute(buf: Buffer): AxmlAttribute {
  let name = "";
  let raw = "";
  let resourceId: number | null = null;
  for (const f of readFields(buf)) {
    if (f.no === 2 && f.bytes) name = f.bytes.toString("utf8");
    else if (f.no === 3 && f.bytes) raw = f.bytes.toString("utf8");
    else if (f.no === 5 && f.num !== undefined) resourceId = f.num;
  }
  const value: AxmlAttribute["value"] = raw === "true" ? true : raw === "false" ? false : raw;
  return { name, resourceId, value };
}

/** Elements in document order, the same shape parseAxml returns; null when the bytes are not an XmlNode. */
export function parseProtoXml(buf: Buffer): AxmlElement[] | null {
  const out: AxmlElement[] = [];
  const visitNode = (node: Buffer, depth: number): void => {
    if (depth > 64) return;
    for (const f of readFields(node)) {
      if (f.no !== 1 || !f.bytes) continue;
      let name = "";
      const attributes: AxmlAttribute[] = [];
      const children: Buffer[] = [];
      for (const e of readFields(f.bytes)) {
        if (e.no === 3 && e.bytes) name = e.bytes.toString("utf8");
        else if (e.no === 4 && e.bytes) attributes.push(parseAttribute(e.bytes));
        else if (e.no === 5 && e.bytes) children.push(e.bytes);
      }
      out.push({ name, attributes });
      for (const c of children) visitNode(c, depth + 1);
    }
  };
  try {
    visitNode(buf, 0);
  } catch {
    return null;
  }
  return out.length > 0 && out[0].name === "manifest" ? out : null;
}
