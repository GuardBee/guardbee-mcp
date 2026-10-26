import { randomUUID } from "crypto";
import { parseLaunch, type LaunchTarget } from "@guardbee/guard-core";
import type { GatewayConfig } from "../gateway/config.js";
import type { PinnedUpstream } from "../gateway/pin-store.js";
import { isHttpUpstream, type McpServerConfig, type UpstreamConfig } from "../types.js";

/**
 * An AI bill of materials (CycloneDX 1.6 JSON) of what the gateway puts in
 * front of an agent: the MCP servers behind it (package and version, build
 * provenance, sandbox), the tools each one offers (with the SHA-256 their
 * definition is pinned to), and the models the LLM gateway routes to.
 *
 * Only names, versions, hashes and settings: no environment values, headers,
 * keys or tool arguments.
 */

interface Property {
  name: string;
  value: string;
}

export interface AibomSources {
  version: string;
  /** Pinned tool definitions by upstream (pins.json). */
  pins?: Record<string, PinnedUpstream>;
  /** Provenance results by artifact (`npm:name@1.2.3`), from the provenance cache. */
  provenance?: (artifact: string) => { status: string; sourceRepository?: string; sourceCommit?: string } | undefined;
  now?: Date;
  serialNumber?: string;
}

const prop = (name: string, value: string | undefined): Property[] => (value === undefined || value === "" ? [] : [{ name: `guardbee:${name}`, value }]);

/** `ghcr.io/o/r:tag@sha256:…` → repository with registry (Docker Hub: docker.io/library/…), tag, digest. */
function imageParts(reference: string): { repository: string; name: string; tag?: string; digest?: string } {
  const [named, digest] = reference.split("@") as [string, string | undefined];
  const slash = named.lastIndexOf("/");
  const colon = named.lastIndexOf(":");
  const tag = colon > slash ? named.slice(colon + 1) : undefined;
  const path = (colon > slash ? named.slice(0, colon) : named).split("/");
  const registry = path.length > 1 && /[.:]|^localhost$/.test(path[0]!) ? path.shift()! : "docker.io";
  if (registry === "docker.io" && path.length === 1) path.unshift("library");
  const repository = `${registry}/${path.join("/").toLowerCase()}`;
  return { repository, name: path[path.length - 1]!.toLowerCase(), ...(tag ? { tag } : {}), ...(digest?.startsWith("sha256:") ? { digest } : {}) };
}

/** Package URL of a launch target; the version only when it is exact. */
function purl(target: LaunchTarget): { purl: string; name: string; version?: string; group?: string; artifact?: string } {
  if (target.ecosystem === "npm") {
    const exact = /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(target.spec) ? target.spec : undefined;
    const [scope, bare] = target.name.startsWith("@") ? (target.name.split("/") as [string, string]) : [undefined, target.name];
    return {
      purl: `pkg:npm/${scope ? `${encodeURIComponent(scope)}/` : ""}${encodeURIComponent(bare)}${exact ? `@${encodeURIComponent(exact)}` : ""}`,
      name: bare,
      ...(scope ? { group: scope } : {}),
      ...(exact ? { version: exact, artifact: `npm:${target.name}@${exact}` } : {}),
    };
  }
  if (target.ecosystem === "pypi") {
    const name = target.name.toLowerCase().replace(/[-_.]+/g, "-");
    return { purl: `pkg:pypi/${name}${target.spec ? `@${encodeURIComponent(target.spec)}` : ""}`, name, ...(target.spec ? { version: target.spec, artifact: `pypi:${target.name}==${target.spec}` } : {}) };
  }
  const image = imageParts(target.reference);
  const version = image.digest ?? image.tag;
  return {
    purl: `pkg:oci/${encodeURIComponent(image.name)}${version ? `@${encodeURIComponent(version)}` : ""}?repository_url=${encodeURIComponent(image.repository)}`,
    name: image.name,
    ...(version ? { version } : {}),
    ...(image.digest ? { artifact: `oci:${image.repository}@${image.digest}` } : {}),
  };
}

function stdioComponent(name: string, server: McpServerConfig, sources: AibomSources): Record<string, unknown> {
  const target = parseLaunch(server.command, server.args ?? []);
  const ref = `server:${name}`;
  // The sandbox block, when this proxy version has one
  const configured = (server as { sandbox?: { runtime: string; network?: string } }).sandbox;
  const sandbox = configured && configured.runtime !== "none" ? configured : undefined;
  const settings = [
    ...prop("upstream", name),
    ...prop("mcp:transport", "stdio"),
    ...prop("command", [server.command, ...(target ? [] : (server.args ?? []).filter((a) => !a.startsWith("-")).slice(0, 1))].join(" ")),
    ...prop("sandbox:runtime", sandbox?.runtime ?? "none"),
    ...prop("sandbox:network", sandbox?.network),
    ...prop("provenance:mode", server.provenance),
  ];
  if (!target) return { "bom-ref": ref, type: "application", name, properties: settings };
  const id = purl(target);
  const checked = id.artifact ? sources.provenance?.(id.artifact) : undefined;
  return {
    "bom-ref": ref,
    type: target.ecosystem === "oci" ? "container" : "application",
    name: id.name,
    ...(id.group ? { group: id.group } : {}),
    ...(id.version ? { version: id.version } : {}),
    purl: id.purl,
    ...(checked?.sourceRepository ? { externalReferences: [{ type: "vcs", url: checked.sourceRepository, ...(checked.sourceCommit ? { comment: `commit ${checked.sourceCommit}` } : {}) }] } : {}),
    properties: [
      ...settings,
      ...prop("ecosystem", target.ecosystem),
      ...prop("pinned", id.version ? "true" : "false"),
      ...prop("provenance:status", checked?.status ?? (id.artifact ? "not checked" : "not pinned")),
    ],
  };
}

/** Tools of one upstream, as nested services: name, description, pinned hash and declared hints. */
function toolServices(upstream: string, pins: PinnedUpstream | undefined): Record<string, unknown>[] {
  return Object.entries(pins?.tools ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, pin]) => {
      const annotations = (pin.snapshot.annotations ?? {}) as Record<string, unknown>;
      return {
        "bom-ref": `tool:${upstream}:${tool}`,
        name: tool,
        ...(typeof pin.snapshot.description === "string" && pin.snapshot.description ? { description: pin.snapshot.description.slice(0, 1000) } : {}),
        properties: [
          ...prop("tool:sha256", pin.hash),
          ...prop("tool:pinnedSince", pin.firstSeen),
          ...Object.entries(annotations)
            .filter(([key, value]) => key.endsWith("Hint") && typeof value === "boolean")
            .map(([key, value]) => ({ name: `guardbee:tool:${key}`, value: String(value) })),
        ],
      };
    });
}

function upstreamService(name: string, server: UpstreamConfig, sources: AibomSources): Record<string, unknown> {
  const pins = sources.pins?.[name];
  const tools = toolServices(name, pins);
  const http = isHttpUpstream(server);
  return {
    "bom-ref": `upstream:${name}`,
    name,
    ...(pins?.serverInfo ? { version: pins.serverInfo.version, description: `MCP server ${pins.serverInfo.name}` } : {}),
    ...(http ? { endpoints: [server.url], authenticated: Object.keys(server.headers ?? {}).some((h) => /^(authorization|x-api-key|api-key)$/i.test(h)), "x-trust-boundary": true } : {}),
    properties: [
      ...prop("mcp:transport", http ? "streamable-http" : "stdio"),
      ...(http ? prop("network:mode", server.network?.mode ?? "open") : []),
      ...prop("tools:pinned", String(tools.length)),
    ],
    ...(tools.length ? { services: tools } : {}),
  };
}

export function buildAibom(config: GatewayConfig, sources: AibomSources): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  const services: Record<string, unknown>[] = [];
  const dependencies: { ref: string; dependsOn: string[] }[] = [];
  const gatewayRef = "guardbee-gateway";
  const direct: string[] = [];

  for (const [name, server] of Object.entries(config.upstreams).sort(([a], [b]) => a.localeCompare(b))) {
    const service = upstreamService(name, server, sources);
    services.push(service);
    direct.push(service["bom-ref"] as string);
    if (!isHttpUpstream(server)) {
      const component = stdioComponent(name, server, sources);
      components.push(component);
      dependencies.push({ ref: service["bom-ref"] as string, dependsOn: [component["bom-ref"] as string] });
    }
  }

  for (const [index, route] of (config.llm?.routes ?? []).entries()) {
    const provider = config.llm!.providers[route.provider];
    const ref = `model:${index}:${route.model}`;
    components.push({
      "bom-ref": ref,
      type: "machine-learning-model",
      name: route.model,
      ...(provider ? { supplier: { name: provider.name, url: [provider.baseUrl] } } : {}),
      properties: [...prop("llm:provider", route.provider), ...prop("llm:api", provider?.api), ...prop("llm:piiMasking", route.masking ?? "on")],
    });
    direct.push(ref);
  }
  dependencies.unshift({ ref: gatewayRef, dependsOn: direct });

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: sources.serialNumber ?? `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: (sources.now ?? new Date()).toISOString(),
      tools: { components: [{ type: "application", group: "@guardbee", name: "mcp-security-proxy", version: sources.version }] },
      component: {
        "bom-ref": gatewayRef,
        type: "application",
        group: "@guardbee",
        name: "mcp-security-proxy",
        version: sources.version,
        description: "GuardBee MCP security gateway and the AI stack behind it",
      },
      properties: [...prop("aibom:scope", "MCP servers, tools and LLM routes behind one GuardBee gateway"), ...prop("provenance:mode", config.provenance.mode)],
    },
    components,
    services,
    dependencies,
  };
}
