#!/usr/bin/env node
import { startStdioServer } from "./server";

startStdioServer().catch((err) => {
  console.error("[guardbee-gateway] Fatal error:", err);
  process.exit(1);
});
