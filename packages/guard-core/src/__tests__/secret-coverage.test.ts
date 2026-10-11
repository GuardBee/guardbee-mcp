import { describe, expect, it } from "vitest";
import { maskPiiInText } from "../pii.js";
import { SECRET_RULES } from "../secrets.js";

/** Seeded random characters, built at runtime so the repo's own secret scan ignores this file. */
function chars(length: number, alphabet: string, seed = 1): string {
  let state = seed;
  let out = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[Math.floor(state / 65536) % alphabet.length];
  }
  return out;
}
const HEX = "0123456789abcdef";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const B64 = ALNUM + "+/";
const join = (...parts: string[]) => parts.join("");

/** One value in each provider's format. */
const SAMPLES: Record<string, string> = {
  github_fine_grained_pat: join("github_pat_", chars(82, ALNUM + "_")),
  gitlab_runner_token: join("glrt-", chars(20, ALNUM)),
  pypi_token: join("pypi-", "AgEIcHlwaS5vcmc", chars(60, ALNUM)),
  vault_token: join("hvs.", chars(95, ALNUM)),
  terraform_cloud_token: join(chars(14, "abcdefghij0123456789"), ".atlasv1.", chars(65, "abcdefghij0123456789")),
  pulumi_token: join("pul-", chars(40, HEX)),
  doppler_token: join("dp.pt.", chars(43, ALNUM)),
  onepassword_service_token: join("ops_eyJ", chars(260, B64)),
  age_secret_key: join("AGE-SECRET-KEY-1", chars(58, "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L")),
  azure_ad_client_secret: join("abc", "8Q~", chars(34, ALNUM)),
  azure_storage_key: join("AccountKey=", chars(86, B64), "=="),
  digitalocean_token: join("dop_v1_", chars(64, HEX)),
  heroku_api_key: join("HRKU-AA", chars(58, ALNUM)),
  flyio_token: join("fo1_", chars(43, ALNUM)),
  cloudflare_origin_ca_key: join("v1.0-", chars(24, HEX), "-", chars(146, HEX)),
  supabase_access_token: join("sbp_", chars(40, HEX)),
  planetscale_token: join("pscale_tkn_", chars(43, ALNUM)),
  openrouter_key: join("sk-or-v1-", chars(64, HEX)),
  groq_key: join("gsk_", chars(52, ALNUM)),
  perplexity_key: join("pplx-", chars(48, ALNUM)),
  replicate_token: join("r8_", chars(37, ALNUM)),
  huggingface_org_token: join("api_org_", chars(34, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ")),
  stripe_webhook_secret: join("whsec_", chars(32, ALNUM)),
  square_token: join("sq0atp-", chars(22, ALNUM)),
  shopify_token: join("shpat_", chars(32, HEX)),
  twilio_api_key: join("SK", chars(32, HEX)),
  linear_api_key: join("lin_api_", chars(40, ALNUM)),
  notion_token: join("ntn_", chars(11, "0123456789"), chars(35, ALNUM)),
  atlassian_api_token: join("ATATT3", chars(186, ALNUM)),
  sentry_user_token: join("sntryu_", chars(64, HEX)),
  grafana_service_token: join("glsa_", chars(32, ALNUM), "_", chars(8, HEX)),
  postman_api_key: join("PMAK-", chars(24, HEX), "-", chars(34, HEX)),
  discord_webhook: join("https://discord.com/api/webhooks/", chars(18, "0123456789"), "/", chars(68, ALNUM)),
  telegram_bot_token: join(chars(9, "123456789"), ":AA", chars(33, ALNUM)),
  iyzico_key: join("IYZICO_SECRET_KEY=", chars(32, ALNUM)),
  paytr_merchant_key: join("PAYTR_MERCHANT_SALT=", chars(16, ALNUM)),
  netgsm_credentials: join("NETGSM_PASSWORD=", chars(12, ALNUM)),
  iletimerkezi_key: join("ILETIMERKEZI_API_KEY=", chars(32, ALNUM)),
};

const rule = (id: string) => SECRET_RULES.find((r) => r.id === id)!;
const matches = (id: string, text: string) => {
  const r = rule(id);
  const found = [...text.matchAll(new RegExp(r.pattern.source, r.pattern.flags))].map((m) => m[0]);
  return found.filter((m) => !r.allowlist?.some((allow) => allow.test(m)));
};

describe("provider coverage", () => {
  it.each(Object.entries(SAMPLES))("%s finds its own format", (id, sample) => {
    expect(rule(id), `rule ${id} exists`).toBeDefined();
    expect(matches(id, `const value = "${sample}";`)).toHaveLength(1);
  });

  it("each sample is found by its own rule only, among the new rules", () => {
    for (const [id, sample] of Object.entries(SAMPLES)) {
      const others = Object.keys(SAMPLES).filter((other) => other !== id && matches(other, sample).length > 0);
      expect(others, `${id} also matched`).toEqual([]);
    }
  });

  it("no older rule reports the same value as well", () => {
    const newIds = new Set(Object.keys(SAMPLES));
    for (const [id, sample] of Object.entries(SAMPLES)) {
      const older = SECRET_RULES.filter((r) => !newIds.has(r.id) && r.id !== "generic_secret_assignment" && matches(r.id, `x ${sample} x`).length > 0).map((r) => r.id);
      expect(older, `${id} also matched by`).toEqual([]);
    }
  });

  it("does not match near-misses", () => {
    expect(matches("square_token", `data:image/png;base64,iVBORw0KGgo+EAAA${chars(40, ALNUM)}`)).toEqual([]);
    expect(matches("twilio_api_key", `TASK${chars(32, HEX)}`)).toEqual([]);
    expect(matches("telegram_bot_token", "12:30 AA meeting")).toEqual([]);
    expect(matches("iyzico_key", "IYZICO_API_KEY=sandbox-abcdefghijklmnopqrstuvwx")).toEqual([]);
    expect(matches("netgsm_credentials", "NETGSM_PASSWORD=${NETGSM_PASSWORD}")).toEqual([]);
  });

  it("the proxy masks the fixed-format ones but not the name-matched Turkish rules", () => {
    expect(maskPiiInText(`key ${SAMPLES.openrouter_key} end`)).not.toContain(SAMPLES.openrouter_key);
    expect(maskPiiInText(`token ${SAMPLES.azure_ad_client_secret} end`)).not.toContain(SAMPLES.azure_ad_client_secret);
    for (const id of ["iyzico_key", "paytr_merchant_key", "netgsm_credentials", "iletimerkezi_key"]) {
      expect(rule(id).broad, id).toBe(true);
    }
  });
});
