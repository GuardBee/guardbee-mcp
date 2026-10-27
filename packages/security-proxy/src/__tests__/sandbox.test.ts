import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseGatewayYaml } from "../gateway/config.js";
import { sandboxIssues, sandboxLaunch, seatbeltProfile, type SandboxConfig, type SandboxContext } from "../gateway/sandbox.js";
import { connectStdioUpstream, type Upstream } from "../gateway/upstream.js";

const PROBE = fileURLToPath(new URL("./fixtures/probe-server.mjs", import.meta.url));

let root: string;
let home: string;
let work: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guardbee-sandbox-")));
  home = path.join(root, "home");
  work = path.join(root, "work");
  fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(home, ".ssh", "id_rsa"), "PRIVATE KEY");
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, ".env"), "DB_PASSWORD=hunter2");
  fs.writeFileSync(path.join(work, "notes.txt"), "visible");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const sandbox = (overrides: Partial<SandboxConfig> = {}): SandboxConfig => ({
  runtime: "docker",
  fs: { readOnly: [], readWrite: [], deny: [] },
  env: [],
  network: "none",
  ...overrides,
});
const ctx = (overrides: Partial<SandboxContext> = {}): SandboxContext => ({
  name: "probe",
  cwd: work,
  home,
  platform: "linux",
  env: { PATH: "/usr/bin:/bin", HOME: home, SECRET_TOKEN: "s3cr3t", ALLOWED: "yes" },
  uid: 1000,
  gid: 1000,
  ...overrides,
});
const server = { command: "node", args: [PROBE], env: { FROM_CONFIG: "1" } };

describe("sandboxLaunch", () => {
  it("leaves the command alone with runtime none", () => {
    const launch = sandboxLaunch(server, sandbox({ runtime: "none" }), ctx());
    expect(launch).toMatchObject({ command: "node", args: [PROBE] });
    expect(launch.env["SECRET_TOKEN"]).toBe("s3cr3t");
  });

  it("builds a locked-down container: no network, read-only root, limits, host user, masked secrets", () => {
    const launch = sandboxLaunch(server, sandbox({ fs: { readOnly: [work], readWrite: [], deny: [] }, env: ["ALLOWED"], limits: { cpus: 0.5, memory: "256m", pids: 64 } }), ctx());
    const args = launch.args.join(" ");
    expect(launch.command).toBe("docker");
    for (const flag of ["--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--cpus 0.5", "--memory 256m", "--pids-limit 64", "--user 1000:1000"]) {
      expect(args).toContain(flag);
    }
    expect(args).toContain(`-v ${work}:${work}:ro`);
    expect(args).toContain(`-v /dev/null:${path.join(work, ".env")}:ro`);
    expect(args).toContain(`node:22-alpine node ${PROBE}`);
    // Values never in the argument list; only names, read from the client's environment
    expect(launch.args).toEqual(expect.arrayContaining(["-e", "ALLOWED", "-e", "FROM_CONFIG"]));
    expect(args).not.toContain("SECRET_TOKEN");
    expect(args).not.toContain("yes");
    expect(launch.env["ALLOWED"]).toBe("yes");
  });

  it("builds bwrap with a read-only root, the credentials and .env files hidden, and a clean environment", () => {
    const launch = sandboxLaunch(server, sandbox({ runtime: "bwrap", fs: { readOnly: [], readWrite: [work], deny: [] }, env: ["ALLOWED"] }), ctx());
    const args = launch.args.join(" ");
    expect(launch.command).toBe("bwrap");
    expect(args).toContain("--unshare-all");
    expect(args).not.toContain("--share-net");
    expect(args).toContain("--ro-bind / /");
    expect(args).toContain(`--bind ${work} ${work}`);
    expect(args).toContain(`--tmpfs ${path.join(home, ".ssh")}`);
    expect(args).toContain(`--ro-bind /dev/null ${path.join(work, ".env")}`);
    expect(args).toContain("--clearenv");
    expect(args).toContain("--setenv ALLOWED yes");
    expect(args).not.toContain("SECRET_TOKEN");
  });

  it("writes a Seatbelt profile that denies writes, credentials, .env files and the network", () => {
    const profile = seatbeltProfile(sandbox({ runtime: "sandbox-exec", fs: { readOnly: [], readWrite: [work], deny: ["~/private"] } }), ctx({ platform: "darwin" }), path.join(home, ".guardbee/sandbox/probe"));
    expect(profile).toContain(`(subpath "${work}")`);
    expect(profile).toContain(`(subpath "${path.join(home, ".ssh")}")`);
    expect(profile).toContain(`(subpath "${path.join(home, "private")}")`);
    expect(profile).toContain("\\.env");
    expect(profile).toContain("(deny network*)");
  });
});

describe("sandboxIssues", () => {
  it("names what keeps a sandbox from starting on this host", () => {
    const issues = (config: Partial<SandboxConfig>, overrides: Partial<SandboxContext> = {}, command = server) => sandboxIssues(command, sandbox(config), ctx(overrides));
    expect(issues({ runtime: "sandbox-exec" })).toEqual(expect.arrayContaining([expect.stringMatching(/macOS only/)]));
    expect(issues({ runtime: "bwrap", limits: { memory: "1g" } })).toEqual(expect.arrayContaining([expect.stringMatching(/limits need a container/)]));
    expect(issues({ runtime: "docker" }, { env: { PATH: root } })).toEqual(expect.arrayContaining([expect.stringMatching(/not on PATH/)]));
    expect(issues({ fs: { readOnly: [], readWrite: ["~"], deny: [] } })).toEqual(expect.arrayContaining([expect.stringMatching(/home directory/)]));
    expect(issues({ fs: { readOnly: ["~/.ssh"], readWrite: [], deny: [] } })).toEqual(expect.arrayContaining([expect.stringMatching(/never shows/)]));
    expect(issues({ fs: { readOnly: ["./missing"], readWrite: [], deny: [] } })).toEqual(expect.arrayContaining([expect.stringMatching(/does not exist/)]));
    expect(issues({}, {}, { command: "my-server", args: [], env: {} })).toEqual(expect.arrayContaining([expect.stringMatching(/no default image/)]));
  });
});

describe("sandbox config", () => {
  it("takes a sandbox on a stdio upstream with its defaults, and refuses one on an HTTP upstream", () => {
    const config = parseGatewayYaml("version: 1\nupstreams:\n  fs:\n    command: npx\n    args: [-y, pkg]\n    sandbox:\n      runtime: docker\n      limits: { memory: 512m }\n");
    expect(config.upstreams["fs"]).toMatchObject({ sandbox: { runtime: "docker", network: "open", env: [], fs: { readOnly: [], readWrite: [], deny: [] }, limits: { memory: "512m" } } });
    expect(() => parseGatewayYaml("version: 1\nupstreams:\n  web:\n    url: https://x.example/mcp\n    sandbox: { runtime: docker }\n")).toThrow(/sandbox applies to stdio upstreams/);
  });

  it("leaves configs without a sandbox as they were", () => {
    const config = parseGatewayYaml("version: 1\nupstreams:\n  fs:\n    command: npx\n    args: [-y, pkg]\n");
    expect(config.upstreams["fs"]).toEqual({ command: "npx", args: ["-y", "pkg"] });
  });
});

/** Run the probe server in a real sandbox and ask it what it can reach. */
async function probeIn(config: SandboxConfig, request: Record<string, unknown>) {
  const previousHome = process.env["HOME"];
  process.env["HOME"] = home; // os.homedir(): the credential paths and the private home live under the fake home
  process.env["ALLOWED"] = "yes";
  process.env["SECRET_TOKEN"] = "s3cr3t";
  let upstream: Upstream | undefined;
  try {
    upstream = await connectStdioUpstream("probe", { command: "node", args: [PROBE], sandbox: config });
    const result = (await upstream.callTool("probe", request)) as { content: { text: string }[] };
    return JSON.parse(result.content[0]!.text) as {
      read: Record<string, { ok: boolean; value?: string; error?: string }>;
      write: Record<string, { ok: boolean; error?: string }>;
      env: Record<string, string | null>;
      connect?: { ok: boolean; error?: string };
    };
  } finally {
    await upstream?.close();
    process.env["HOME"] = previousHome;
    delete process.env["ALLOWED"];
    delete process.env["SECRET_TOKEN"];
  }
}

const has = (binary: string) => {
  try {
    execFileSync("which", [binary], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const dockerUp = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(process.platform === "darwin" && has("sandbox-exec"))("sandbox-exec (macOS)", () => {
  it("keeps the server from credentials, .env files, writes outside readWrite, the host environment and the network", async () => {
    const report = await probeIn(sandbox({ runtime: "sandbox-exec", fs: { readOnly: [], readWrite: [work], deny: [] }, env: ["ALLOWED"] }), {
      read: [path.join(home, ".ssh", "id_rsa"), path.join(work, ".env"), path.join(work, "notes.txt")],
      write: [path.join(work, "out.txt"), path.join(home, "planted.txt")],
      env: ["ALLOWED", "SECRET_TOKEN"],
      connect: { host: "1.1.1.1", port: 443 },
    });
    expect(report.read[path.join(home, ".ssh", "id_rsa")]).toMatchObject({ ok: false, error: "EPERM" });
    expect(report.read[path.join(work, ".env")]).toMatchObject({ ok: false });
    expect(report.read[path.join(work, "notes.txt")]).toEqual({ ok: true, value: "visible" });
    expect(report.write[path.join(work, "out.txt")]?.ok).toBe(true);
    expect(report.write[path.join(home, "planted.txt")]).toMatchObject({ ok: false, error: "EPERM" });
    expect(report.env).toEqual({ ALLOWED: "yes", SECRET_TOKEN: null });
    expect(report.connect?.ok).toBe(false);
  }, 20_000);
});

describe.runIf(dockerUp)("docker", () => {
  it("shows only the mounted paths, hides credentials and .env inside them, and passes only allowlisted variables", async () => {
    const report = await probeIn(
      sandbox({ fs: { readOnly: [path.dirname(PROBE), home], readWrite: [work], deny: [] }, env: ["ALLOWED"], limits: { memory: "256m", pids: 64 } }),
      {
        read: [path.join(home, ".ssh", "id_rsa"), path.join(work, ".env"), path.join(work, "notes.txt"), "/etc/hostname"],
        write: [path.join(work, "out.txt"), path.join(home, "planted.txt")],
        env: ["ALLOWED", "SECRET_TOKEN"],
        connect: { host: "1.1.1.1", port: 443 },
      },
    );
    expect(report.read[path.join(home, ".ssh", "id_rsa")]?.ok).toBe(false);
    expect(report.read[path.join(work, ".env")]).toEqual({ ok: true, value: "" }); // /dev/null over it
    expect(report.read[path.join(work, "notes.txt")]).toEqual({ ok: true, value: "visible" });
    expect(report.write[path.join(work, "out.txt")]?.ok).toBe(true);
    expect(report.write[path.join(home, "planted.txt")]?.ok).toBe(false);
    expect(report.env).toEqual({ ALLOWED: "yes", SECRET_TOKEN: null });
    expect(report.connect?.ok).toBe(false);
  }, 120_000);
});
