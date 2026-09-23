import { classifyGlobal } from "./dangerousGlobals.js";
import type { Finding } from "./scanner.js";

const MAX_STRING_ARG = 1_000_000; // guard against a single opcode arg claiming an absurd length

export interface GlobalRef {
  module: string;
  name: string;
  offset: number;
  via: "GLOBAL" | "STACK_GLOBAL" | "INST";
}

export interface DisassemblyResult {
  globals: GlobalRef[];
  truncated: boolean;
  opcodeCount: number;
}

/**
 * Walks a pickle opcode stream (protocols 0-5) just far enough to enumerate every
 * GLOBAL / STACK_GLOBAL / INST reference — the opcodes that name a Python
 * class/function to resolve during unpickling. Every other opcode's argument is
 * skipped using its known fixed/length-prefixed encoding so the offset never
 * drifts. STACK_GLOBAL (protocol 4+) doesn't carry its module/name as an inline
 * argument — it pops the two most recently pushed short strings off the pickle
 * VM stack, so we track a small trailing window of unicode pushes instead of a
 * full stack simulation (this is the same heuristic picklescan/fickling use).
 */
export function disassemblePickle(buf: Buffer): DisassemblyResult {
  const globals: GlobalRef[] = [];
  const recentStrings: string[] = [];
  let offset = 0;
  let truncated = false;
  let opcodeCount = 0;

  function pushRecent(s: string) {
    recentStrings.push(s);
    if (recentStrings.length > 4) recentStrings.shift();
  }

  function readLine(): string | null {
    const nl = buf.indexOf(0x0a, offset);
    if (nl === -1) return null;
    const s = buf.toString("latin1", offset, nl);
    offset = nl + 1;
    return s;
  }

  function fail() {
    truncated = true;
    offset = buf.length;
  }

  while (offset < buf.length) {
    const opStart = offset;
    const op = buf[offset];
    offset += 1;
    opcodeCount++;

    switch (op) {
      // No-argument opcodes
      case 0x28: // ( MARK
      case 0x2e: // . STOP
      case 0x30: // 0 POP
      case 0x31: // 1 POP_MARK
      case 0x32: // 2 DUP
      case 0x4e: // N NONE
      case 0x52: // R REDUCE
      case 0x61: // a APPEND
      case 0x62: // b BUILD
      case 0x64: // d DICT
      case 0x7d: // } EMPTY_DICT
      case 0x65: // e APPENDS
      case 0x6c: // l LIST
      case 0x5d: // ] EMPTY_LIST
      case 0x73: // s SETITEM
      case 0x74: // t TUPLE
      case 0x29: // ) EMPTY_TUPLE
      case 0x75: // u SETITEMS
      case 0x51: // Q BINPERSID
      case 0x81: // NEWOBJ
      case 0x85: // TUPLE1
      case 0x86: // TUPLE2
      case 0x87: // TUPLE3
      case 0x88: // NEWTRUE
      case 0x89: // NEWFALSE
      case 0x8f: // EMPTY_SET
      case 0x90: // ADDITEMS
      case 0x91: // FROZENSET
      case 0x92: // NEWOBJ_EX
      case 0x94: // MEMOIZE
      case 0x97: // NEXT_BUFFER
      case 0x98: // READONLY_BUFFER
        break;

      // Newline-terminated text argument opcodes
      case 0x46: // F FLOAT
      case 0x49: // I INT
      case 0x4c: // L LONG
      case 0x50: // P PERSID
      case 0x53: // S STRING
      case 0x56: // V UNICODE
      case 0x67: // g GET
      case 0x70: // p PUT
        if (readLine() === null) fail();
        break;

      // Fixed-length binary argument opcodes
      case 0x4a: // J BININT
        offset += 4;
        break;
      case 0x4b: // K BININT1
        offset += 1;
        break;
      case 0x4d: // M BININT2
        offset += 2;
        break;
      case 0x47: // G BINFLOAT
        offset += 8;
        break;
      case 0x68: // h BINGET
        offset += 1;
        break;
      case 0x6a: // j LONG_BINGET
        offset += 4;
        break;
      case 0x71: // q BINPUT
        offset += 1;
        break;
      case 0x72: // r LONG_BINPUT
        offset += 4;
        break;
      case 0x80: // PROTO
        offset += 1;
        break;
      case 0x82: // EXT1
        offset += 1;
        break;
      case 0x83: // EXT2
        offset += 2;
        break;
      case 0x84: // EXT4
        offset += 4;
        break;
      case 0x95: // FRAME
        offset += 8;
        break;

      // Length-prefixed binary string/bytes opcodes
      case 0x54: // T BINSTRING (4-byte LE length)
      case 0x42: {
        // B BINBYTES (4-byte LE length)
        if (offset + 4 > buf.length) { fail(); break; }
        const len = buf.readUInt32LE(offset);
        offset += 4;
        if (len > MAX_STRING_ARG || offset + len > buf.length) { fail(); break; }
        offset += len;
        break;
      }
      case 0x55: // U SHORT_BINSTRING (1-byte length)
      case 0x43: {
        // C SHORT_BINBYTES (1-byte length)
        if (offset + 1 > buf.length) { fail(); break; }
        const len = buf[offset];
        offset += 1;
        if (offset + len > buf.length) { fail(); break; }
        offset += len;
        break;
      }
      case 0x8a: {
        // LONG1 (1-byte length)
        if (offset + 1 > buf.length) { fail(); break; }
        const len = buf[offset];
        offset += 1;
        if (offset + len > buf.length) { fail(); break; }
        offset += len;
        break;
      }
      case 0x8b: {
        // LONG4 (4-byte LE length)
        if (offset + 4 > buf.length) { fail(); break; }
        const len = buf.readInt32LE(offset);
        offset += 4;
        if (len < 0 || len > MAX_STRING_ARG || offset + len > buf.length) { fail(); break; }
        offset += len;
        break;
      }

      // Unicode-push opcodes — tracked for STACK_GLOBAL resolution
      case 0x58: {
        // X BINUNICODE (4-byte LE length, UTF-8)
        if (offset + 4 > buf.length) { fail(); break; }
        const len = buf.readUInt32LE(offset);
        offset += 4;
        if (len > MAX_STRING_ARG || offset + len > buf.length) { fail(); break; }
        pushRecent(buf.toString("utf8", offset, offset + len));
        offset += len;
        break;
      }
      case 0x8c: {
        // SHORT_BINUNICODE (1-byte length, UTF-8)
        if (offset + 1 > buf.length) { fail(); break; }
        const len = buf[offset];
        offset += 1;
        if (offset + len > buf.length) { fail(); break; }
        pushRecent(buf.toString("utf8", offset, offset + len));
        offset += len;
        break;
      }
      case 0x8d: {
        // BINUNICODE8 (8-byte LE length, UTF-8)
        if (offset + 8 > buf.length) { fail(); break; }
        const len = Number(buf.readBigUInt64LE(offset));
        offset += 8;
        if (len > MAX_STRING_ARG || offset + len > buf.length) { fail(); break; }
        pushRecent(buf.toString("utf8", offset, offset + len));
        offset += len;
        break;
      }
      case 0x8e: {
        // BINBYTES8 (8-byte LE length)
        if (offset + 8 > buf.length) { fail(); break; }
        const len = Number(buf.readBigUInt64LE(offset));
        offset += 8;
        if (len > MAX_STRING_ARG || offset + len > buf.length) { fail(); break; }
        offset += len;
        break;
      }
      case 0x96: {
        // BYTEARRAY8 (8-byte LE length)
        if (offset + 8 > buf.length) { fail(); break; }
        const len = Number(buf.readBigUInt64LE(offset));
        offset += 8;
        if (len > MAX_STRING_ARG || offset + len > buf.length) { fail(); break; }
        offset += len;
        break;
      }

      // Class/function references — what we're actually here for
      case 0x63: // c GLOBAL
      case 0x69: {
        // i INST
        const mod = readLine();
        const name = mod !== null ? readLine() : null;
        if (mod === null || name === null) { fail(); break; }
        globals.push({ module: mod, name, offset: opStart, via: op === 0x63 ? "GLOBAL" : "INST" });
        break;
      }
      case 0x93: {
        // STACK_GLOBAL — module/name are the two most recent unicode pushes
        if (recentStrings.length >= 2) {
          const name = recentStrings[recentStrings.length - 1];
          const mod = recentStrings[recentStrings.length - 2];
          globals.push({ module: mod, name, offset: opStart, via: "STACK_GLOBAL" });
        }
        break;
      }

      default:
        // Unrecognized opcode — its argument length is unknown, so we can no
        // longer trust our position in the stream. Stop rather than guess.
        fail();
        break;
    }

    if (op === 0x2e) break; // STOP
  }

  return { globals, truncated, opcodeCount };
}

export function scanPickleBuffer(
  buf: Buffer,
  filePath: string | undefined,
  note?: string
): { findings: Finding[]; truncated: boolean; globalsFound: number } {
  const { globals, truncated } = disassemblePickle(buf);
  const findings: Finding[] = [];

  for (const g of globals) {
    const cls = classifyGlobal(g.module, g.name);
    if (cls.status === "safe") continue;

    const context = `byte offset ${g.offset} in pickle stream${note ? ` (${note})` : ""}`;

    if (cls.status === "dangerous" && cls.rule) {
      findings.push({
        patternId: `pickle_dangerous_global_${g.module.replace(/\./g, "_")}_${g.name === "*" ? "any" : g.name}`,
        patternName: `Dangerous global reference: ${g.module}.${g.name}`,
        category: cls.rule.category,
        severity: cls.rule.severity,
        recommendation: cls.rule.recommendation,
        file: filePath,
        line: 1,
        column: 1,
        match: `${g.via} ${g.module}.${g.name}`,
        context,
      });
    } else {
      findings.push({
        patternId: "pickle_unknown_global",
        patternName: `Unrecognized global reference: ${g.module}.${g.name}`,
        category: "unknown",
        severity: "medium",
        recommendation:
          "Not in GuardBee's known-safe ML deserialization allowlist or its known-dangerous list. May be a legitimate but uncommon dependency, or a hand-crafted payload — review manually before trusting this file.",
        file: filePath,
        line: 1,
        column: 1,
        match: `${g.via} ${g.module}.${g.name}`,
        context,
      });
    }
  }

  return { findings, truncated, globalsFound: globals.length };
}
