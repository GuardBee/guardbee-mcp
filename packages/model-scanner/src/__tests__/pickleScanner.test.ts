import { describe, it, expect } from "vitest";
import { disassemblePickle, scanPickleBuffer } from "../pickleScanner.js";

const PROTO2 = Buffer.from([0x80, 2]);
const STOP = Buffer.from([0x2e]);

function opGlobal(module: string, name: string): Buffer {
  return Buffer.concat([Buffer.from([0x63]), Buffer.from(module + "\n", "latin1"), Buffer.from(name + "\n", "latin1")]);
}

function opInst(module: string, name: string): Buffer {
  return Buffer.concat([Buffer.from([0x69]), Buffer.from(module + "\n", "latin1"), Buffer.from(name + "\n", "latin1")]);
}

function opShortBinUnicode(s: string): Buffer {
  const utf8 = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from([0x8c, utf8.length]), utf8]);
}

const STACK_GLOBAL = Buffer.from([0x93]);
const MEMOIZE = Buffer.from([0x94]);
const REDUCE = Buffer.from([0x52]);
const EMPTY_TUPLE = Buffer.from([0x29]);

describe("disassemblePickle — GLOBAL opcode", () => {
  it("os.system referansını yakalar", () => {
    const buf = Buffer.concat([PROTO2, opGlobal("os", "system"), STOP]);
    const { globals } = disassemblePickle(buf);
    expect(globals).toEqual([{ module: "os", name: "system", offset: 2, via: "GLOBAL" }]);
  });

  it("birden fazla GLOBAL referansını sırayla yakalar", () => {
    const buf = Buffer.concat([PROTO2, opGlobal("os", "system"), opGlobal("numpy", "ndarray"), STOP]);
    const { globals } = disassemblePickle(buf);
    expect(globals.map((g) => `${g.module}.${g.name}`)).toEqual(["os.system", "numpy.ndarray"]);
  });

  it("REDUCE ile birlikte akışın sonuna kadar doğru ilerler", () => {
    const buf = Buffer.concat([PROTO2, opGlobal("subprocess", "Popen"), EMPTY_TUPLE, REDUCE, STOP]);
    const { globals, truncated } = disassemblePickle(buf);
    expect(truncated).toBe(false);
    expect(globals.map((g) => `${g.module}.${g.name}`)).toEqual(["subprocess.Popen"]);
  });
});

describe("disassemblePickle — INST opcode", () => {
  it("eski protokoldeki INST'i GLOBAL gibi yakalar", () => {
    const buf = Buffer.concat([opInst("os", "system"), STOP]);
    const { globals } = disassemblePickle(buf);
    expect(globals[0]).toMatchObject({ module: "os", name: "system", via: "INST" });
  });
});

describe("disassemblePickle — STACK_GLOBAL opcode (protokol 4+)", () => {
  it("son iki SHORT_BINUNICODE push'unu module/name olarak çözer", () => {
    const buf = Buffer.concat([
      Buffer.from([0x80, 4]),
      opShortBinUnicode("os"),
      MEMOIZE,
      opShortBinUnicode("system"),
      MEMOIZE,
      STACK_GLOBAL,
      STOP,
    ]);
    const { globals } = disassemblePickle(buf);
    expect(globals[0]).toMatchObject({ module: "os", name: "system", via: "STACK_GLOBAL" });
  });
});

describe("disassemblePickle — truncation/bozuk akış", () => {
  it("tanınmayan bir opcode'da güvenle durur, atmaz", () => {
    const buf = Buffer.concat([PROTO2, Buffer.from([0xff]), STOP]);
    expect(() => disassemblePickle(buf)).not.toThrow();
    const { truncated } = disassemblePickle(buf);
    expect(truncated).toBe(true);
  });

  it("eksik yarım bırakılmış bir GLOBAL argümanında atmaz", () => {
    const buf = Buffer.concat([PROTO2, Buffer.from([0x63]), Buffer.from("os\n", "latin1")]); // name\n eksik
    expect(() => disassemblePickle(buf)).not.toThrow();
    const { truncated } = disassemblePickle(buf);
    expect(truncated).toBe(true);
  });

  it("iddia edilen uzunluk dosya boyutunu aşan bir BINUNICODE'da atmaz", () => {
    const buf = Buffer.concat([PROTO2, Buffer.from([0x58]), Buffer.from([0xff, 0xff, 0xff, 0x7f])]); // 4-byte length, absürt büyük
    expect(() => disassemblePickle(buf)).not.toThrow();
    const { truncated } = disassemblePickle(buf);
    expect(truncated).toBe(true);
  });
});

describe("scanPickleBuffer — sınıflandırma", () => {
  it("os.system'i critical severity ile bulgu olarak döndürür", () => {
    const buf = Buffer.concat([PROTO2, opGlobal("os", "system"), STOP]);
    const { findings } = scanPickleBuffer(buf, "model.pkl");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "critical", category: "process-execution", file: "model.pkl" });
    expect(findings[0].patternId).toContain("os_system");
  });

  it("builtins.eval'i critical severity ile bulgu olarak döndürür", () => {
    const buf = Buffer.concat([PROTO2, opGlobal("builtins", "eval"), STOP]);
    const { findings } = scanPickleBuffer(buf, undefined);
    expect(findings[0]).toMatchObject({ severity: "critical", category: "code-execution" });
  });

  it("numpy/torch gibi ML global'lerini bulgu olarak döndürmez", () => {
    const buf = Buffer.concat([
      PROTO2,
      opGlobal("numpy.core.multiarray", "_reconstruct"),
      opGlobal("torch._utils", "_rebuild_tensor_v2"),
      opGlobal("collections", "OrderedDict"),
      STOP,
    ]);
    const { findings } = scanPickleBuffer(buf, undefined);
    expect(findings).toHaveLength(0);
  });

  it("bilinmeyen bir modülü medium severity 'unknown' olarak işaretler, critical değil", () => {
    const buf = Buffer.concat([PROTO2, opGlobal("some_custom_pkg", "MyEstimator"), STOP]);
    const { findings } = scanPickleBuffer(buf, undefined);
    expect(findings[0]).toMatchObject({ severity: "medium", patternId: "pickle_unknown_global" });
  });

  it("her bulgu recommendation içerir", () => {
    const buf = Buffer.concat([PROTO2, opGlobal("socket", "socket"), STOP]);
    const { findings } = scanPickleBuffer(buf, undefined);
    expect(findings[0].recommendation.length).toBeGreaterThan(10);
  });
});
