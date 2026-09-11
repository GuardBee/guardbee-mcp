import { loadProxyConfig } from "./config.js";
import { startProxy } from "./proxy.js";

async function main() {
  const config = loadProxyConfig();
  await startProxy(config);
}

main().catch((err) => {
  process.stderr.write(
    `[guardbee-proxy] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
