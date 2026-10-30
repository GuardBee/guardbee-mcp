import type { ByteSource } from "./byteSource.js";
import type { GlobalRef } from "./pickleScanner.js";

/**
 * A pickle machine that tracks values instead of executing them: enough to
 * read the arguments and state of objects being rebuilt. Formats such as
 * joblib interleave raw array bytes with the pickle opcodes, and only the
 * object's state (shape, dtype) says how many bytes to skip before the
 * next opcode, which a plain disassembler cannot know.
 */

export type PValue =
  | null
  | boolean
  | number
  | string
  | Buffer
  | PValue[]
  | { kind: "tuple"; items: PValue[] }
  | { kind: "dict"; entries: Array<[PValue, PValue]> }
  | { kind: "global"; module: string; name: string }
  | { kind: "obj"; cls: PValue; args: PValue; state?: PValue }
  | { kind: "opaque" };

type StackItem = PValue | typeof MARK;
const MARK = Symbol("mark");

export interface PickleRun {
  globals: GlobalRef[];
  /** Offset just after STOP, or where parsing stopped. */
  end: number;
  stopped: boolean;
  /** Why parsing ended before STOP, if it did. */
  error?: string;
}

export interface PickleHooks {
  /**
   * Called after BUILD sets an object's state, with the offset of the next
   * byte. Returns the offset to continue from, or null to stop.
   */
  onBuild?(obj: Extract<PValue, { kind: "obj" }>, next: number, run: (at: number) => PickleRun): number | null;
}

const MAX_OPCODES = 20_000_000;
const MAX_STRING = 64 * 1024 * 1024;
const MAX_LINE = 64 * 1024;

export function isObj(v: PValue | undefined): v is Extract<PValue, { kind: "obj" }> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !Buffer.isBuffer(v) && v.kind === "obj";
}

export function isGlobal(v: PValue | undefined): v is Extract<PValue, { kind: "global" }> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !Buffer.isBuffer(v) && v.kind === "global";
}

export function tupleItems(v: PValue | undefined): PValue[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && v !== null && !Buffer.isBuffer(v) && v.kind === "tuple") return v.items;
  return null;
}

export function dictGet(v: PValue | undefined, key: string): PValue | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v) || Buffer.isBuffer(v) || v.kind !== "dict") return undefined;
  return v.entries.find(([k]) => k === key)?.[1];
}

function signedLE(b: Buffer): number {
  if (b.length === 0) return 0;
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  if (b[b.length - 1] & 0x80) v -= 1n << BigInt(b.length * 8);
  return Number(v);
}

export function runPickle(src: ByteSource, start: number, hooks: PickleHooks = {}, depth = 0): PickleRun {
  const globals: GlobalRef[] = [];
  const stack: StackItem[] = [];
  const memo = new Map<number, PValue>();
  let pos = start;
  let ops = 0;

  const done = (stopped: boolean, error?: string): PickleRun => ({ globals, end: pos, stopped, error });
  if (depth > 16) return done(false, "nesting limit reached");
  const pop = (): PValue => {
    const v = stack.pop();
    return v === undefined || v === MARK ? { kind: "opaque" } : (v as PValue);
  };
  const popMark = (): PValue[] => {
    const i = stack.lastIndexOf(MARK);
    if (i === -1) return [];
    const items = stack.splice(i) as PValue[];
    items.shift();
    return items;
  };
  const top = (): PValue | undefined => {
    const v = stack[stack.length - 1];
    return v === MARK ? undefined : (v as PValue | undefined);
  };
  const take = (n: number): Buffer | null => {
    const b = src.slice(pos, n);
    if (b) pos += n;
    return b;
  };
  const line = (): string | null => {
    const chunk = src.slice(pos, Math.min(MAX_LINE, src.length - pos));
    if (!chunk) return null;
    const nl = chunk.indexOf(0x0a);
    if (nl === -1) return null;
    pos += nl + 1;
    return chunk.toString("latin1", 0, nl);
  };
  const lenPrefixed = (size: 1 | 4 | 8): Buffer | null => {
    const h = take(size);
    if (!h) return null;
    const n = size === 1 ? h[0] : size === 4 ? h.readUInt32LE(0) : Number(h.readBigUInt64LE(0));
    return n > MAX_STRING ? null : take(n);
  };
  const recordGlobal = (module: string, name: string, at: number, via: GlobalRef["via"]): PValue => {
    globals.push({ module, name, offset: at, via });
    return { kind: "global", module, name };
  };

  while (pos < src.length) {
    if (++ops > MAX_OPCODES) return done(false, "opcode limit reached");
    const at = pos;
    const op = take(1)?.[0];
    if (op === undefined) break;
    switch (op) {
      case 0x80: // PROTO
      case 0x82: // EXT1
        if (!take(1)) return done(false, "truncated");
        if (op === 0x82) stack.push({ kind: "opaque" });
        break;
      case 0x83: // EXT2
        if (!take(2)) return done(false, "truncated");
        stack.push({ kind: "opaque" });
        break;
      case 0x84: // EXT4
        if (!take(4)) return done(false, "truncated");
        stack.push({ kind: "opaque" });
        break;
      case 0x95: // FRAME
        if (!take(8)) return done(false, "truncated");
        break;
      case 0x2e: // STOP
        return done(true);
      case 0x28: // MARK
        stack.push(MARK);
        break;
      case 0x30: // POP
        if (stack.length) stack.pop();
        break;
      case 0x31: // POP_MARK
        popMark();
        break;
      case 0x32: // DUP
        stack.push(top() ?? { kind: "opaque" });
        break;
      case 0x4e: // NONE
        stack.push(null);
        break;
      case 0x88: // NEWTRUE
      case 0x89: // NEWFALSE
        stack.push(op === 0x88);
        break;
      case 0x4a: { // BININT
        const b = take(4);
        if (!b) return done(false, "truncated");
        stack.push(b.readInt32LE(0));
        break;
      }
      case 0x4b: { // BININT1
        const b = take(1);
        if (!b) return done(false, "truncated");
        stack.push(b[0]);
        break;
      }
      case 0x4d: { // BININT2
        const b = take(2);
        if (!b) return done(false, "truncated");
        stack.push(b.readUInt16LE(0));
        break;
      }
      case 0x8a: // LONG1
      case 0x8b: { // LONG4
        const b = lenPrefixed(op === 0x8a ? 1 : 4);
        if (!b) return done(false, "truncated");
        stack.push(signedLE(b));
        break;
      }
      case 0x47: { // BINFLOAT
        const b = take(8);
        if (!b) return done(false, "truncated");
        stack.push(b.readDoubleBE(0));
        break;
      }
      case 0x46: // FLOAT
      case 0x49: // INT
      case 0x4c: { // LONG
        const s = line();
        if (s === null) return done(false, "truncated");
        if (op === 0x49 && (s === "00" || s === "01")) stack.push(s === "01");
        else stack.push(Number(s.replace(/L$/, "")));
        break;
      }
      case 0x53: { // STRING
        const s = line();
        if (s === null) return done(false, "truncated");
        stack.push(s.replace(/^(['"])(.*)\1$/, "$2"));
        break;
      }
      case 0x56: // UNICODE
      case 0x50: { // PERSID
        const s = line();
        if (s === null) return done(false, "truncated");
        stack.push(op === 0x56 ? s : { kind: "opaque" });
        break;
      }
      case 0x51: // BINPERSID
        pop();
        stack.push({ kind: "opaque" });
        break;
      case 0x54: // BINSTRING
      case 0x55: // SHORT_BINSTRING
      case 0x58: // BINUNICODE
      case 0x8c: // SHORT_BINUNICODE
      case 0x8d: { // BINUNICODE8
        const b = lenPrefixed(op === 0x55 || op === 0x8c ? 1 : op === 0x8d ? 8 : 4);
        if (!b) return done(false, "truncated");
        stack.push(op === 0x54 || op === 0x55 ? b.toString("latin1") : b.toString("utf8"));
        break;
      }
      case 0x42: // BINBYTES
      case 0x43: // SHORT_BINBYTES
      case 0x8e: // BINBYTES8
      case 0x96: { // BYTEARRAY8
        const b = lenPrefixed(op === 0x43 ? 1 : op === 0x42 ? 4 : 8);
        if (!b) return done(false, "truncated");
        stack.push(b);
        break;
      }
      case 0x97: // NEXT_BUFFER
        stack.push({ kind: "opaque" });
        break;
      case 0x98: // READONLY_BUFFER
        break;
      case 0x29: // EMPTY_TUPLE
        stack.push({ kind: "tuple", items: [] });
        break;
      case 0x74: // TUPLE
        stack.push({ kind: "tuple", items: popMark() });
        break;
      case 0x85: // TUPLE1
      case 0x86: // TUPLE2
      case 0x87: { // TUPLE3
        const n = op - 0x84;
        const items: PValue[] = [];
        for (let i = 0; i < n; i++) items.unshift(pop());
        stack.push({ kind: "tuple", items });
        break;
      }
      case 0x5d: // EMPTY_LIST
        stack.push([]);
        break;
      case 0x6c: // LIST
        stack.push(popMark());
        break;
      case 0x61: { // APPEND
        const v = pop();
        const list = top();
        if (Array.isArray(list)) list.push(v);
        break;
      }
      case 0x65: { // APPENDS
        const items = popMark();
        const list = top();
        if (Array.isArray(list)) list.push(...items);
        break;
      }
      case 0x7d: // EMPTY_DICT
        stack.push({ kind: "dict", entries: [] });
        break;
      case 0x64: { // DICT
        const items = popMark();
        const entries: Array<[PValue, PValue]> = [];
        for (let i = 0; i + 1 < items.length; i += 2) entries.push([items[i], items[i + 1]]);
        stack.push({ kind: "dict", entries });
        break;
      }
      case 0x73: { // SETITEM
        const v = pop();
        const k = pop();
        const d = top();
        if (typeof d === "object" && d !== null && !Array.isArray(d) && !Buffer.isBuffer(d) && d.kind === "dict") d.entries.push([k, v]);
        break;
      }
      case 0x75: { // SETITEMS
        const items = popMark();
        const d = top();
        if (typeof d === "object" && d !== null && !Array.isArray(d) && !Buffer.isBuffer(d) && d.kind === "dict") {
          for (let i = 0; i + 1 < items.length; i += 2) d.entries.push([items[i], items[i + 1]]);
        }
        break;
      }
      case 0x8f: // EMPTY_SET
        stack.push({ kind: "opaque" });
        break;
      case 0x90: // ADDITEMS
        popMark();
        break;
      case 0x91: // FROZENSET
        popMark();
        stack.push({ kind: "opaque" });
        break;
      case 0x67: // GET
      case 0x68: // BINGET
      case 0x6a: { // LONG_BINGET
        let idx: number;
        if (op === 0x67) {
          const s = line();
          if (s === null) return done(false, "truncated");
          idx = Number(s);
        } else {
          const b = take(op === 0x68 ? 1 : 4);
          if (!b) return done(false, "truncated");
          idx = op === 0x68 ? b[0] : b.readUInt32LE(0);
        }
        stack.push(memo.get(idx) ?? { kind: "opaque" });
        break;
      }
      case 0x70: // PUT
      case 0x71: // BINPUT
      case 0x72: { // LONG_BINPUT
        let idx: number;
        if (op === 0x70) {
          const s = line();
          if (s === null) return done(false, "truncated");
          idx = Number(s);
        } else {
          const b = take(op === 0x71 ? 1 : 4);
          if (!b) return done(false, "truncated");
          idx = op === 0x71 ? b[0] : b.readUInt32LE(0);
        }
        memo.set(idx, top() ?? { kind: "opaque" });
        break;
      }
      case 0x94: // MEMOIZE
        memo.set(memo.size, top() ?? { kind: "opaque" });
        break;
      case 0x63: { // GLOBAL
        const module = line();
        const name = module === null ? null : line();
        if (module === null || name === null) return done(false, "truncated");
        stack.push(recordGlobal(module, name, at, "GLOBAL"));
        break;
      }
      case 0x93: { // STACK_GLOBAL
        const name = pop();
        const module = pop();
        stack.push(recordGlobal(typeof module === "string" ? module : "?", typeof name === "string" ? name : "?", at, "STACK_GLOBAL"));
        break;
      }
      case 0x69: { // INST
        const module = line();
        const name = module === null ? null : line();
        if (module === null || name === null) return done(false, "truncated");
        const cls = recordGlobal(module, name, at, "INST");
        stack.push({ kind: "obj", cls, args: { kind: "tuple", items: popMark() } });
        break;
      }
      case 0x6f: { // OBJ
        const items = popMark();
        stack.push({ kind: "obj", cls: items[0] ?? null, args: { kind: "tuple", items: items.slice(1) } });
        break;
      }
      case 0x52: // REDUCE
      case 0x81: { // NEWOBJ
        const args = pop();
        const cls = pop();
        stack.push({ kind: "obj", cls, args });
        break;
      }
      case 0x92: { // NEWOBJ_EX
        pop();
        const args = pop();
        const cls = pop();
        stack.push({ kind: "obj", cls, args });
        break;
      }
      case 0x62: { // BUILD
        const state = pop();
        const obj = top();
        if (isObj(obj)) {
          obj.state = state;
          if (hooks.onBuild) {
            const next = hooks.onBuild(obj, pos, (from) => runPickle(src, from, hooks, depth + 1));
            if (next === null) return done(false, "could not follow data embedded after an object");
            pos = next;
          }
        }
        break;
      }
      default:
        return done(false, `unknown opcode 0x${op.toString(16)} at byte ${at}`);
    }
  }
  return done(false, "no STOP opcode");
}
