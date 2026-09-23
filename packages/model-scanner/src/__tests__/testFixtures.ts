import { deflateRawSync } from "zlib";

/** Builds a minimal single-entry ZIP archive (no CRC validation, matches what zip.ts reads). */
export function buildZip(name: string, data: Buffer, method: 0 | 8 = 0): Buffer {
  const content = method === 8 ? deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name, "utf8");

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(method, 8);
  lfh.writeUInt16LE(0, 10);
  lfh.writeUInt16LE(0, 12);
  lfh.writeUInt32LE(0, 14);
  lfh.writeUInt32LE(content.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);

  const localRecord = Buffer.concat([lfh, nameBuf, content]);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(method, 10);
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(0, 16);
  cdh.writeUInt32LE(content.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42); // local header offset — this entry starts at 0

  const centralDirRecord = Buffer.concat([cdh, nameBuf]);
  const centralDirOffset = localRecord.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirRecord.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localRecord, centralDirRecord, eocd]);
}

/** Builds a minimal pickle buffer: PROTO 2 + one or more GLOBAL opcodes + STOP. */
export function buildPickle(...refs: Array<[string, string]>): Buffer {
  const parts = [Buffer.from([0x80, 2])];
  for (const [module, name] of refs) {
    parts.push(Buffer.concat([Buffer.from([0x63]), Buffer.from(module + "\n", "latin1"), Buffer.from(name + "\n", "latin1")]));
  }
  parts.push(Buffer.from([0x2e]));
  return Buffer.concat(parts);
}

/** Builds a minimal valid .safetensors file buffer. */
export function buildSafetensors(tensors: Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>, dataSize: number): Buffer {
  const header = Buffer.from(JSON.stringify(tensors), "utf8");
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(header.length), 0);
  return Buffer.concat([lenBuf, header, Buffer.alloc(dataSize)]);
}

export const HDF5_MAGIC = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
