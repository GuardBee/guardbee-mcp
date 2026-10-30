export interface PbField {
  field: number;
  wire: number;
  /** Varint and fixed values. */
  num?: bigint;
  /** Length-delimited payload (sub-message, string or bytes). */
  bytes?: Buffer;
}

/**
 * The fields of one protobuf message, without a schema. Throws on malformed
 * input; callers treat that as "not this format".
 */
export function* pbFields(buf: Buffer): Generator<PbField> {
  let p = 0;
  const varint = (): bigint => {
    let v = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (p >= buf.length) throw new Error("truncated varint");
      const b = buf[p++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
    }
    throw new Error("varint too long");
  };
  while (p < buf.length) {
    const key = varint();
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) throw new Error("field number 0");
    if (wire === 0) yield { field, wire, num: varint() };
    else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      if (p + n > buf.length) throw new Error("truncated fixed field");
      yield { field, wire, num: wire === 1 ? buf.readBigUInt64LE(p) : BigInt(buf.readUInt32LE(p)) };
      p += n;
    } else if (wire === 2) {
      const len = Number(varint());
      if (p + len > buf.length) throw new Error("length past end of message");
      yield { field, wire, bytes: buf.subarray(p, p + len) };
      p += len;
    } else throw new Error(`unsupported wire type ${wire}`);
  }
}

/** Every length-delimited value of `field` in a message. */
export function pbMessages(buf: Buffer, field: number): Buffer[] {
  const out: Buffer[] = [];
  for (const f of pbFields(buf)) if (f.field === field && f.bytes) out.push(f.bytes);
  return out;
}

export function pbString(buf: Buffer, field: number): string | undefined {
  for (const f of pbFields(buf)) if (f.field === field && f.bytes) return f.bytes.toString("utf8");
  return undefined;
}
