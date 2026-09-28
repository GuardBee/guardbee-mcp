import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseNpmDirectDependencies } from "../parsers/npm.js";
import { parsePipDirectDependencies } from "../parsers/pip.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `slopsquat-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("parseNpmDirectDependencies", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });

  it("hiç package.json yoksa boş dizi döner", () => {
    expect(parseNpmDirectDependencies(dir)).toEqual([]);
  });

  it("dependencies ve devDependencies'i ayrı isDev bayrağıyla toplar", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { express: "^4.18.2" },
        devDependencies: { vitest: "^2.0.0" },
      })
    );
    const deps = parseNpmDirectDependencies(dir);
    expect(deps.find((d) => d.name === "express")?.isDev).toBe(false);
    expect(deps.find((d) => d.name === "vitest")?.isDev).toBe(true);
  });

  it("peerDependencies ve optionalDependencies'i de toplar", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        peerDependencies: { react: "^18.0.0" },
        optionalDependencies: { fsevents: "^2.3.0" },
      })
    );
    const names = parseNpmDirectDependencies(dir).map((d) => d.name);
    expect(names).toContain("react");
    expect(names).toContain("fsevents");
  });

  it("scoped paket adlarını olduğu gibi korur", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { "@babel/core": "^7.0.0" } }));
    expect(parseNpmDirectDependencies(dir)[0]?.name).toBe("@babel/core");
  });

  it("lockfile'daki transitive bağımlılıkları DAHİL ETMEZ (sadece direkt bağımlılıklar)", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { express: "^4.18.2" } }));
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({
        packages: {
          "": {},
          "node_modules/express": { version: "4.18.2" },
          "node_modules/some-transitive-dep": { version: "1.0.0" },
        },
      })
    );
    const names = parseNpmDirectDependencies(dir).map((d) => d.name);
    expect(names).toEqual(["express"]);
    expect(names).not.toContain("some-transitive-dep");
  });
});

describe("parsePipDirectDependencies", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });

  it("hiç manifest dosyası yoksa boş dizi döner", () => {
    expect(parsePipDirectDependencies(dir)).toEqual([]);
  });

  it("requirements.txt'i ayrıştırır (yorum ve boş satırlar hariç)", () => {
    writeFileSync(join(dir, "requirements.txt"), "requests==2.31.0\n# a comment\n\nflask>=2.0\n");
    const names = parsePipDirectDependencies(dir).map((d) => d.name);
    expect(names).toEqual(["requests", "flask"]);
  });

  it("extras'lı bir requirement'ı da doğru ayrıştırır", () => {
    writeFileSync(join(dir, "requirements.txt"), "requests[security]==2.31.0\n");
    expect(parsePipDirectDependencies(dir)[0]?.name).toBe("requests");
  });

  it("PEP 621 pyproject.toml [project] dependencies'i ayrıştırır", () => {
    writeFileSync(
      join(dir, "pyproject.toml"),
      `[project]\nname = "myapp"\ndependencies = [\n  "requests==2.31.0",\n  "flask>=2.0",\n]\n`
    );
    const names = parsePipDirectDependencies(dir).map((d) => d.name);
    expect(names).toEqual(["requests", "flask"]);
  });

  it("Poetry [tool.poetry.dependencies] tablosunu ayrıştırır, python anahtarını atlar", () => {
    writeFileSync(
      join(dir, "pyproject.toml"),
      `[tool.poetry.dependencies]\npython = "^3.11"\nrequests = "^2.31.0"\n`
    );
    const names = parsePipDirectDependencies(dir).map((d) => d.name);
    expect(names).toEqual(["requests"]);
  });
});
