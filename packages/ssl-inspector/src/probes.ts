import * as tls from "tls";

/**
 * What a server accepts, not just what it negotiates with a modern client.
 * One default handshake always lands on the best protocol and cipher both
 * sides share, so a server that still accepts TLS 1.0 or static-RSA key
 * exchange looks fine. Each probe offers only the thing under test.
 */
export interface ProbeResult {
  tls10?: boolean;
  tls11?: boolean;
  tls13?: boolean;
  /** Accepts TLS 1.2 ciphers with RSA key exchange: no forward secrecy. */
  staticRsa?: boolean;
  /** Size of the server's DHE group, when it offers DHE. */
  dhBits?: number;
  /** Weak cipher families the server accepted. */
  weakCiphers: string[];
  /** Probes this runtime cannot make (its OpenSSL has no such ciphers). */
  notTested: string[];
}

type Attempt =
  | { ok: true; protocol: string | null; cipher?: string; ephemeral?: tls.EphemeralKeyInfo | object | null }
  | { ok: false; unsupportedHere?: boolean };

// Security level 0: allow the legacy protocols and small keys under test
const LEGACY = "ALL:@SECLEVEL=0";

export function attempt(host: string, port: number, options: tls.ConnectionOptions, timeoutMs: number): Promise<Attempt> {
  return new Promise((resolve) => {
    let socket: tls.TLSSocket;
    try {
      socket = tls.connect({ host, port, servername: isIpAddress(host) ? undefined : host, rejectUnauthorized: false, ...options }, () => {
        const result: Attempt = {
          ok: true,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher()?.name,
          ephemeral: socket.getEphemeralKeyInfo(),
        };
        socket.end();
        resolve(result);
      });
    } catch (err) {
      // The runtime's OpenSSL does not have these ciphers at all
      resolve({ ok: false, unsupportedHere: (err as { code?: string }).code === "ERR_SSL_NO_CIPHER_MATCH" });
      return;
    }
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ ok: false });
    });
    socket.on("error", () => resolve({ ok: false }));
  });
}

/** SNI is for names, not IP addresses. */
function isIpAddress(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(":");
}

const WEAK_FAMILIES: { name: string; ciphers: string }[] = [
  { name: "3DES", ciphers: "3DES:@SECLEVEL=0" },
  { name: "RC4", ciphers: "RC4:@SECLEVEL=0" },
  { name: "NULL", ciphers: "eNULL:@SECLEVEL=0" },
  { name: "EXPORT", ciphers: "EXPORT:@SECLEVEL=0" },
];

export async function probeHost(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  const result: ProbeResult = { weakCiphers: [], notTested: [] };
  const tls12 = { minVersion: "TLSv1.2" as const, maxVersion: "TLSv1.2" as const };
  const [tls10, tls11, tls13, staticRsa, dhe, ...weak] = await Promise.all([
    attempt(host, port, { minVersion: "TLSv1", maxVersion: "TLSv1", ciphers: LEGACY }, timeoutMs),
    attempt(host, port, { minVersion: "TLSv1.1", maxVersion: "TLSv1.1", ciphers: LEGACY }, timeoutMs),
    attempt(host, port, { minVersion: "TLSv1.3", maxVersion: "TLSv1.3" }, timeoutMs),
    attempt(host, port, { ...tls12, ciphers: "kRSA:@SECLEVEL=0" }, timeoutMs),
    attempt(host, port, { ...tls12, ciphers: "kDHE:@SECLEVEL=0" }, timeoutMs),
    ...WEAK_FAMILIES.map((family) => attempt(host, port, { minVersion: "TLSv1", maxVersion: "TLSv1.2", ciphers: family.ciphers }, timeoutMs)),
  ]);

  result.tls10 = tls10!.ok;
  result.tls11 = tls11!.ok;
  result.tls13 = tls13!.ok;
  if (staticRsa!.ok) result.staticRsa = true;
  else if (staticRsa!.unsupportedHere) result.notTested.push("RSA key exchange");
  else result.staticRsa = false;
  if (dhe!.ok) {
    const info = dhe!.ephemeral as { type?: string; size?: number } | null | undefined;
    if (info?.type === "DH" && info.size) result.dhBits = info.size;
  }
  weak.forEach((outcome, index) => {
    const family = WEAK_FAMILIES[index]!.name;
    if (outcome.ok) result.weakCiphers.push(family);
    else if (outcome.unsupportedHere) result.notTested.push(family);
  });
  return result;
}

/** Cipher key length from its name; ChaCha20 is a 256-bit cipher, not "20". */
export function cipherBits(name: string): number {
  if (/CHACHA20/i.test(name)) return 256;
  const aes = /AES[_-]?(\d{3})/i.exec(name);
  if (aes) return Number(aes[1]);
  if (/3DES|DES-CBC3|DES_EDE/i.test(name)) return 112;
  if (/(?:^|[_-])DES(?:[_-]|$)/i.test(name)) return 56;
  if (/CAMELLIA[_-]?256|ARIA[_-]?256/i.test(name)) return 256;
  if (/CAMELLIA[_-]?128|ARIA[_-]?128|SEED|RC4/i.test(name)) return 128;
  return 128;
}

// Signature algorithm OIDs (DER) that signal a weak hash
const WEAK_SIGNATURE_OIDS: { name: string; der: Buffer }[] = [
  { name: "MD5 with RSA", der: Buffer.from("06092a864886f70d010104", "hex") },
  { name: "SHA-1 with RSA", der: Buffer.from("06092a864886f70d010105", "hex") },
  { name: "ECDSA with SHA-1", der: Buffer.from("06072a8648ce3d0401", "hex") },
  { name: "DSA with SHA-1", der: Buffer.from("06072a8648ce380403", "hex") },
];

/** The weak signature algorithm a certificate is signed with, if any. */
export function weakSignature(raw: Buffer): string | null {
  for (const oid of WEAK_SIGNATURE_OIDS) if (raw.includes(oid.der)) return oid.name;
  return null;
}
