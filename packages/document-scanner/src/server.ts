import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { OPT_IN_PII, PERSONAL_DATA_CATEGORIES, PII_PATTERNS } from "@guardbee/guard-core";
import { z } from "zod";
import { formatResults } from "./report.js";
import { scanBytes, scanDirectory } from "./scanner.js";

const common = {
  ocr: z.boolean().optional().describe("OCR images and PDF pages without a text layer (default true; needs tesseract.js)"),
  languages: z.array(z.string()).optional().describe('Tesseract languages, default ["tur", "eng"]'),
  include: z.array(z.enum(OPT_IN_PII)).optional().describe("Opt-in detectors: ip_address, mac_address, plate_tr"),
};

export async function startServer(version = "0.1.0") {
  serveStdio(() => {
    const server = new McpServer({ name: "guardbee-document-scanner", version });
    instrumentServer(server, "document-scanner");
    registerTools(server);
    return server;
  });
}

/** This package's MCP tools on `server`; @guardbee/security-suite serves several packages' tools from one process this way. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "scan_document",
    {
      description: "Find PII (TC Kimlik No, IBAN, card, passport, e-mail, phone, address…) and credentials inside a PDF, an image (screenshot, scanned page) or a text file on disk, before it is given to an LLM. PDFs are read from their text layer; images and scanned pages with OCR (Turkish and English).",
      inputSchema: { path: z.string().describe("Path to a file, or a folder to scan every PDF and image in it"), ...common },
    },
    async ({ path, ocr, languages, include }) => {
      const result = await scanDirectory(path, { ...(ocr !== undefined ? { ocr } : {}), ...(languages ? { languages } : {}), ...(include ? { include } : {}) });
      return { content: [{ type: "text", text: formatResults(result.documents, result.durationMs) }] };
    },
  );

  server.registerTool(
    "scan_base64",
    {
      description: "Scan a document given as base64 (an attachment, an image a tool returned) for PII and credentials. The type is detected from the bytes.",
      inputSchema: { data: z.string().describe("Base64 bytes (a data: URL prefix is allowed)"), label: z.string().optional(), ...common },
    },
    async ({ data, label, ocr, languages, include }) => {
      const bytes = new Uint8Array(Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64"));
      const result = await scanBytes(bytes, label ?? "<base64>", { ...(ocr !== undefined ? { ocr } : {}), ...(languages ? { languages } : {}), ...(include ? { include } : {}) });
      return { content: [{ type: "text", text: formatResults([result]) }] };
    },
  );

  server.registerTool(
    "list_detectors",
    {
      description: "List the PII and credential detectors this scanner runs",
    },
    async () => {
    const personal = PERSONAL_DATA_CATEGORIES.map((c) => `  • ${c}${(OPT_IN_PII as readonly string[]).includes(c) ? " (opt-in)" : ""}`);
    const credentials = PII_PATTERNS.filter((p) => !(PERSONAL_DATA_CATEGORIES as readonly string[]).includes(p.name)).length;
    return {
      content: [{ type: "text", text: [`Personal data:`, ...personal, "", `Credentials: ${credentials} provider key, token, private key and connection-string formats`].join("\n") }],
    };
  }
  );
}
