import { AsyncLocalStorage } from "async_hooks";
import { trace, type Span, type Tracer, type TracerProvider } from "@opentelemetry/api";

/**
 * OpenTelemetry for the gateway. Only @opentelemetry/api (no dependencies) is
 * required: without an SDK every span is a no-op. Exporting is opt-in through
 * the standard OTEL_* environment, with the SDK installed next to the proxy
 * (optional peer dependencies; the Docker image has them). A process that
 * already registered its own SDK (zero-code instrumentation) keeps it.
 */

const NAME = "@guardbee/mcp-security-proxy";
const SDK_PACKAGES = ["@opentelemetry/sdk-trace-base", "@opentelemetry/exporter-trace-otlp-http", "@opentelemetry/resources"];

export function tracer(): Tracer {
  return trace.getTracer(NAME);
}

/** The span of the tool call being handled, so audit events can become its span events. */
const callSpan = new AsyncLocalStorage<Span>();

export function activeCallSpan(): Span | undefined {
  return callSpan.getStore();
}

export function withCallSpan<T>(span: Span, run: () => Promise<T>): Promise<T> {
  return callSpan.run(span, run);
}

interface Sdk {
  BasicTracerProvider: new (config: { resource?: unknown; spanProcessors?: unknown[] }) => TracerProvider & {
    shutdown(): Promise<void>;
  };
  BatchSpanProcessor: new (exporter: unknown) => unknown;
  OTLPTraceExporter: new () => unknown;
  resourceFromAttributes: (attributes: Record<string, string>) => unknown;
}

async function loadSdk(): Promise<Sdk> {
  const [base, exporter, resources] = await Promise.all(SDK_PACKAGES.map((name) => import(name)));
  return {
    BasicTracerProvider: base.BasicTracerProvider,
    BatchSpanProcessor: base.BatchSpanProcessor,
    OTLPTraceExporter: exporter.OTLPTraceExporter,
    resourceFromAttributes: resources.resourceFromAttributes,
  };
}

/**
 * Start exporting spans over OTLP/HTTP when OTEL_EXPORTER_OTLP_ENDPOINT (or
 * the _TRACES_ variant) is set. Returns a shutdown function that flushes, or
 * null when tracing stays off.
 */
export async function startTracing(
  options: { env?: NodeJS.ProcessEnv; load?: () => Promise<Sdk>; version?: string; warn?: (line: string) => void } = {},
): Promise<(() => Promise<void>) | null> {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((line) => process.stderr.write(`[guardbee-proxy] ${line}\n`));
  const endpoint = env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] ?? env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (!endpoint || env["OTEL_SDK_DISABLED"] === "true" || env["OTEL_TRACES_EXPORTER"] === "none") return null;

  let sdk: Sdk;
  try {
    sdk = await (options.load ?? loadSdk)();
  } catch {
    warn(`OTEL_EXPORTER_OTLP_ENDPOINT is set but the OpenTelemetry SDK is not installed; spans are not exported. Install: npm i ${SDK_PACKAGES.join(" ")}`);
    return null;
  }

  const provider = new sdk.BasicTracerProvider({
    resource: sdk.resourceFromAttributes({
      "service.name": env["OTEL_SERVICE_NAME"] ?? "guardbee-security-proxy",
      ...(options.version ? { "service.version": options.version } : {}),
    }),
    // The exporter reads OTEL_EXPORTER_OTLP_* (endpoint, headers, timeout) itself
    spanProcessors: [new sdk.BatchSpanProcessor(new sdk.OTLPTraceExporter())],
  });
  if (!trace.setGlobalTracerProvider(provider)) {
    // Someone (zero-code instrumentation) registered an SDK first: use theirs
    await provider.shutdown();
    return null;
  }
  warn(`exporting OpenTelemetry spans to ${endpoint}`);
  return () => provider.shutdown();
}
