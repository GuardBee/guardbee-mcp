// Android's compiled XML (AXML), as found in an APK's AndroidManifest.xml:
// a RES_XML chunk holding a string pool, a resource-id map for attribute
// names, then start/end element chunks whose attributes carry typed values.

const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_TYPE = 0x0003;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const UTF8_FLAG = 0x100;
const TYPE_STRING = 0x03;
const TYPE_INT_BOOLEAN = 0x12;

export interface AxmlAttribute {
  name: string;
  resourceId: number | null;
  /** Booleans as true/false, strings as text, anything else as the raw 32-bit value. */
  value: boolean | string | number;
}

export interface AxmlElement {
  name: string;
  attributes: AxmlAttribute[];
}

function readStringPool(buf: Buffer, start: number): string[] {
  const headerSize = buf.readUInt16LE(start + 2);
  const count = buf.readUInt32LE(start + 8);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = start + buf.readUInt32LE(start + 20);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const strings: string[] = [];

  for (let i = 0; i < count; i++) {
    let p = stringsStart + buf.readUInt32LE(start + headerSize + i * 4);
    if (utf8) {
      // char count, then byte count; each is 1 byte, or 2 when the high bit is set
      p += buf[p] & 0x80 ? 2 : 1;
      let len = buf[p];
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | buf[p + 1];
        p += 2;
      } else {
        p += 1;
      }
      strings.push(buf.toString("utf8", p, p + len));
    } else {
      let len = buf.readUInt16LE(p);
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p + 2);
        p += 4;
      } else {
        p += 2;
      }
      strings.push(buf.toString("utf16le", p, p + len * 2));
    }
  }
  return strings;
}

/** Returns the elements in document order, or null when the buffer is not AXML. */
export function parseAxml(buf: Buffer): AxmlElement[] | null {
  if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML_TYPE) return null;
  const elements: AxmlElement[] = [];
  let strings: string[] = [];
  let resourceIds: number[] = [];

  let p = buf.readUInt16LE(2);
  while (p + 8 <= buf.length) {
    const type = buf.readUInt16LE(p);
    const headerSize = buf.readUInt16LE(p + 2);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8 || p + size > buf.length) break;

    if (type === RES_STRING_POOL_TYPE) {
      strings = readStringPool(buf, p);
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      resourceIds = [];
      for (let o = p + headerSize; o + 4 <= p + size; o += 4) resourceIds.push(buf.readUInt32LE(o));
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      const ext = p + headerSize;
      const name = strings[buf.readUInt32LE(ext + 4)] ?? "";
      const attrStart = buf.readUInt16LE(ext + 8);
      const attrSize = buf.readUInt16LE(ext + 10);
      const attrCount = buf.readUInt16LE(ext + 12);
      const attributes: AxmlAttribute[] = [];
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const nameIdx = buf.readUInt32LE(a + 4);
        const rawValue = buf.readUInt32LE(a + 8);
        const dataType = buf[a + 15];
        const data = buf.readUInt32LE(a + 16);
        let value: AxmlAttribute["value"] = data;
        if (dataType === TYPE_INT_BOOLEAN) value = data !== 0;
        else if (dataType === TYPE_STRING) value = strings[rawValue !== 0xffffffff ? rawValue : data] ?? "";
        attributes.push({ name: strings[nameIdx] ?? "", resourceId: resourceIds[nameIdx] ?? null, value });
      }
      elements.push({ name, attributes });
    }
    p += size;
  }
  return elements;
}

/** android.R.attr ids, which are stable across platform versions. */
export const ATTR = {
  debuggable: 0x0101000f,
  allowBackup: 0x01010280,
  testOnly: 0x01010272,
} as const;

export function attribute(element: AxmlElement | undefined, name: keyof typeof ATTR): AxmlAttribute | undefined {
  return element?.attributes.find((a) => a.resourceId === ATTR[name] || (a.resourceId === null && a.name === name));
}
