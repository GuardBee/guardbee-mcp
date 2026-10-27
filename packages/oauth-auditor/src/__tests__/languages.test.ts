import { describe, expect, it } from "vitest";
import { join } from "path";
import { scanFile, scanText } from "../scanner.js";

const fixtures = join(__dirname, "fixtures");
const found = (file: string) =>
  scanFile(join(fixtures, file))
    .findings.map((f) => `${f.patternId}@${f.line}`)
    .sort();

describe("Python resource servers", () => {
  it("FastAPI + PyJWT: no audience, token forwarded through a variable", () => {
    expect(found("python/fastapi_pyjwt_vulnerable.py")).toEqual(["python_missing_audience_validation@11", "token_passthrough_via_variable@21"]);
  });

  it("Starlette + authlib: no aud claim option, all request headers forwarded, no PKCE", () => {
    expect(found("python/starlette_authlib_vulnerable.py")).toEqual([
      "missing_pkce_on_auth_request@14",
      "python_missing_audience_validation@20",
      "python_token_passthrough_to_downstream@22",
    ]);
  });

  it("accepts audience=, an authlib aud claim option and a token exchanged before forwarding", () => {
    expect(found("python/fastapi_clean.py")).toEqual([]);
  });

  it("reports verify_aud: False", () => {
    const findings = scanText('jwt.decode(t, k, audience="x", options={"verify_aud": False})', "a.py");
    expect(findings.map((f) => f.patternId)).toEqual(["python_audience_verification_disabled"]);
  });
});

describe("Go resource servers and clients", () => {
  it("finds passthrough, missing audience and PKCE, guessable state, loose redirect, hardcoded secret, discovery SSRF and 0.0.0.0", () => {
    expect(found("go/vulnerable.go")).toEqual(
      [
        "go_hardcoded_oauth_client_secret@18",
        "go_predictable_state_handle@24",
        "missing_pkce_on_auth_request@25",
        "go_loose_redirect_uri_validation@30",
        "go_oauth_discovery_ssrf@35",
        "go_missing_audience_validation@43",
        "go_token_passthrough_to_downstream@48",
        "missing_host_origin_check@59",
        "listen_all_interfaces@64",
      ].sort(),
    );
  });

  it("accepts WithAudience, S256ChallengeOption, crypto/rand, an exchanged token and 127.0.0.1", () => {
    expect(found("go/clean.go")).toEqual([]);
  });

  it("does not run Python rules on Go files or Go rules on Python files", () => {
    const pyOnly = 'state = random.randint(0, 10)\nredirect_uri in allowed';
    expect(scanText(pyOnly, "a.go")).toEqual([]);
    expect(scanText(pyOnly, "a.py").length).toBeGreaterThan(0);
    expect(scanText('ClientSecret: "abcdefghijk"', "a.py")).toEqual([]);
  });

  it("tags findings with the file's language", () => {
    expect(new Set(scanFile(join(fixtures, "go/vulnerable.go")).findings.map((f) => f.language))).toEqual(new Set(["go"]));
  });
});
