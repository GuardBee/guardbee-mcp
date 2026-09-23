import { describe, it, expect } from "vitest";
import { classifyGlobal } from "../dangerousGlobals.js";

describe("classifyGlobal", () => {
  it("os.* wildcard eşleşmesini dangerous olarak işaretler", () => {
    expect(classifyGlobal("os", "system").status).toBe("dangerous");
    expect(classifyGlobal("os", "remove").status).toBe("dangerous");
  });

  it("builtins.eval/exec/compile/__import__/getattr/open'ı dangerous işaretler", () => {
    for (const name of ["eval", "exec", "compile", "__import__", "getattr", "open"]) {
      expect(classifyGlobal("builtins", name).status).toBe("dangerous");
    }
  });

  it("builtins.list/dict/tuple gibi güvenli isimleri safe işaretler", () => {
    for (const name of ["list", "dict", "tuple", "set", "int", "str"]) {
      expect(classifyGlobal("builtins", name).status).toBe("safe");
    }
  });

  it("numpy/torch/collections/sklearn prefix'lerini safe işaretler", () => {
    expect(classifyGlobal("numpy.core.multiarray", "_reconstruct").status).toBe("safe");
    expect(classifyGlobal("torch._utils", "_rebuild_tensor_v2").status).toBe("safe");
    expect(classifyGlobal("collections", "OrderedDict").status).toBe("safe");
    expect(classifyGlobal("sklearn.linear_model._base", "LinearRegression").status).toBe("safe");
  });

  it("tanınmayan bir modülü unknown işaretler (dangerous değil)", () => {
    expect(classifyGlobal("some_random_package", "Thing").status).toBe("unknown");
  });

  it("dangerous sonucun rule alanı severity/recommendation içerir", () => {
    const result = classifyGlobal("subprocess", "Popen");
    expect(result.rule?.severity).toBe("critical");
    expect(result.rule?.recommendation.length).toBeGreaterThan(10);
  });
});
