import { describe, expect, it } from "vitest";
import { analyzeNative, assessDotnetNames, detectNativeFormat } from "../native.js";
import { READABLE_DOTNET_NAMES, buildElf64, buildMachO64, buildPe, entitlementsPlist } from "./testFixtures.js";

const ids = (r: { findings: { patternId: string }[] } | null) => (r?.findings ?? []).map((f) => f.patternId).sort();

const N_SECT_LOCAL = 0x0e;
const N_SECT_EXTERN = 0x0f;
const N_OSO = 0x66;
const N_OPT = 0x3c; // the lone "radr://5614542" stab Apple leaves in stripped binaries
const CS_ADHOC = 0x2;
const CS_RUNTIME = 0x10000;

describe("detectNativeFormat", () => {
  it("recognises ELF, Mach-O, fat Mach-O and PE, and not Java classes", () => {
    expect(detectNativeFormat(buildElf64({ type: "pie", sections: [] }))).toBe("elf");
    expect(detectNativeFormat(buildMachO64({}))).toBe("macho");
    expect(detectNativeFormat(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]))).toBe("fat-macho");
    expect(detectNativeFormat(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61]))).toBeNull(); // Java 17 class file
    expect(detectNativeFormat(buildPe({}))).toBe("pe");
    expect(detectNativeFormat(Buffer.from("#!/bin/sh\necho"))).toBeNull();
  });
});

describe("ELF", () => {
  it("flags a debug, non-PIE, exec-stack, no-RELRO, no-canary build", () => {
    const elf = buildElf64({
      type: "exec",
      sections: [{ name: ".debug_info" }, { name: ".debug_line" }, { name: ".symtab", type: 2, size: 24 * 90, entsize: 24 }],
      stackFlags: 7,
      relro: false,
    });
    const r = analyzeNative(elf, "app");
    expect(ids(r)).toEqual(["native_debug_info", "native_no_nx", "native_no_pie", "native_no_relro", "native_no_stack_canary", "native_symbols_not_stripped"]);
    expect(r!.findings.find((f) => f.patternId === "native_symbols_not_stripped")!.match).toBe(".symtab with 90 entries");
  });

  it("passes a stripped, hardened PIE", () => {
    expect(ids(analyzeNative(buildElf64({ type: "pie", sections: [{ name: ".dynstr" }], extra: "__stack_chk_fail" }), "app"))).toEqual([]);
  });

  it("treats a missing PT_GNU_STACK as an executable stack", () => {
    expect(ids(analyzeNative(buildElf64({ type: "pie", sections: [], stackFlags: null, extra: "__stack_chk_fail" }), "app"))).toEqual(["native_no_nx"]);
  });

  it("does not expect a libc canary from Go binaries", () => {
    expect(ids(analyzeNative(buildElf64({ type: "pie", sections: [{ name: ".gopclntab" }] }), "app"))).toEqual([]);
  });
});

describe("Mach-O", () => {
  it("flags a debug map, local symbols and missing signature", () => {
    const r = analyzeNative(buildMachO64({ symbols: [N_OSO, N_OSO, ...Array(12).fill(N_SECT_LOCAL)], signature: null }), "app");
    expect(ids(r)).toEqual(["native_debug_info", "native_symbols_not_stripped", "native_unsigned"]);
  });

  it("ignores Apple's single marker stab and exported symbols", () => {
    const r = analyzeNative(buildMachO64({ symbols: [N_OPT, ...Array(30).fill(N_SECT_EXTERN)], signature: { flags: CS_RUNTIME } }), "app");
    expect(ids(r)).toEqual([]);
  });

  it("reads hardened runtime, ad-hoc and entitlements from the code signature", () => {
    const r = analyzeNative(buildMachO64({
      signature: {
        flags: CS_ADHOC,
        entitlements: entitlementsPlist(["com.apple.security.get-task-allow", "com.apple.security.cs.allow-dyld-environment-variables"]),
      },
    }), "app");
    expect(ids(r)).toEqual(["native_adhoc_signed", "native_debuggable_entitlement", "native_injection_entitlement", "native_no_hardened_runtime"]);
  });

  it("does not ask Apple platform binaries for the hardened runtime flag", () => {
    expect(ids(analyzeNative(buildMachO64({ signature: { flags: 0, platform: 1 } }), "ls"))).toEqual([]);
  });

  it("checks PIE only for executables", () => {
    expect(ids(analyzeNative(buildMachO64({ pie: false, signature: { flags: CS_RUNTIME } }), "app"))).toEqual(["native_no_pie"]);
    expect(ids(analyzeNative(buildMachO64({ filetype: 6, pie: false, signature: { flags: 0 } }), "lib.dylib"))).toEqual([]);
  });
});

describe("PE", () => {
  it("flags missing ASLR/DEP, an unsigned .exe and a leaked PDB path", () => {
    const r = analyzeNative(buildPe({ dllCharacteristics: 0, pdbPath: "C:\\Users\\builder\\src\\Shop\\obj\\Release\\Shop.pdb" }), "Shop.exe");
    expect(ids(r)).toEqual(["native_build_path_leak", "native_no_nx", "native_no_pie", "native_unsigned"]);
    expect(r!.findings.find((f) => f.patternId === "native_build_path_leak")!.match).toContain("C:\\Users\\builder");
  });

  it("passes a signed, hardened executable with a relative PDB name", () => {
    expect(ids(analyzeNative(buildPe({ signed: true, pdbPath: "Shop.pdb" }), "Shop.exe"))).toEqual([]);
  });

  it("does not require Authenticode for DLLs", () => {
    expect(ids(analyzeNative(buildPe({ dll: true }), "core.dll"))).toEqual([]);
  });
});

describe(".NET", () => {
  it("flags an assembly with readable metadata and an embedded PDB", () => {
    const r = analyzeNative(buildPe({ dll: true, embeddedPdb: true, dotnetNames: READABLE_DOTNET_NAMES }), "Shop.dll");
    expect(r!.flavor).toBe("dotnet");
    expect(ids(r)).toEqual(["dotnet_embedded_pdb", "dotnet_not_obfuscated"]);
  });

  it("accepts renamed metadata", () => {
    const renamed = [...READABLE_DOTNET_NAMES.slice(10), "a", "b", "A", "B", "c", "1", "2", "3"];
    expect(ids(analyzeNative(buildPe({ dll: true, dotnetNames: renamed }), "Shop.dll"))).toEqual([]);
  });

  it("recognises obfuscator markers and non-ASCII renames", () => {
    expect(assessDotnetNames([...READABLE_DOTNET_NAMES, "ConfusedByAttribute"])).toMatchObject({ obfuscated: true, summary: "obfuscator marker found (ConfuserEx)" });
    expect(assessDotnetNames([...READABLE_DOTNET_NAMES.slice(5), "\u206a\u206b\u202e", "\u2029\u206f", "\u200b\u200c\u200d", "\u206e"]).obfuscated).toBe(true);
  });

  it("does not judge tiny assemblies", () => {
    expect(assessDotnetNames(["Resources", "String"]).obfuscated).toBe(true);
  });
});

describe("malformed input", () => {
  it("skips section headers that lie past the end of a truncated file", () => {
    const elf = buildElf64({ type: "pie", sections: [{ name: ".symtab", type: 2, size: 240, entsize: 24 }] }).subarray(0, 70);
    expect(ids(analyzeNative(elf, "truncated"))).not.toContain("native_symbols_not_stripped");
  });

  it("returns a note instead of throwing when the header itself is cut off", () => {
    const r = analyzeNative(buildPe({}).subarray(0, 0x90), "cut.exe");
    expect(r).toMatchObject({ format: "pe", findings: [] });
    expect(r!.notes[0]).toMatch(/^cut\.exe: could not parse pe headers/);
  });
});
