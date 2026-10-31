import os from "os";
import path from "path";
import { bundleFromJSON } from "@sigstore/bundle";
import { getTrustedRoot } from "@sigstore/tuf";
import { Verifier, toSignedEntity, toTrustMaterial } from "@sigstore/verify";
import type { BundleVerifier } from "@guardbee/guard-core";

/** Sigstore verification against the public-good trust root (TUF), as the gateway does it. */
export function sigstoreVerifier(options: { cachePath?: string } = {}): BundleVerifier {
  let verifier: Promise<Verifier> | undefined;
  const load = async () => {
    const root = await getTrustedRoot({ cachePath: options.cachePath ?? path.join(os.homedir(), ".guardbee", "sigstore") });
    return new Verifier(toTrustMaterial(root), { tlogThreshold: 1, ctlogThreshold: 1 });
  };
  return async (json, artifact) => {
    verifier ??= load();
    const signer = (await verifier).verify(toSignedEntity(bundleFromJSON(json), artifact ? Buffer.from(artifact) : undefined));
    return {
      ...(signer.identity?.subjectAlternativeName ? { subjectAlternativeName: signer.identity.subjectAlternativeName } : {}),
      ...(signer.identity?.extensions?.issuer ? { issuer: signer.identity.extensions.issuer } : {}),
    };
  };
}
