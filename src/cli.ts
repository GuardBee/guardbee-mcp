import { startServer } from "./server.js";

startServer().catch((err) => {
  process.stderr.write(
    `[guardbee-secret-scanner] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
