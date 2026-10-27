/**
 * Several lockfiles (pnpm v9, yarn, bun, uv) do not mark packages as dev or
 * production. We recover it by walking the dependency graph from the
 * project's production and dev roots: a package is dev only if it is
 * reachable from a dev root and not from any production root. Packages
 * reachable from neither are kept as production, so an incomplete graph
 * never hides a finding.
 */
export interface GraphNode {
  name: string;
  version: string;
  deps: string[];
}

export function devOnly(
  nodes: Map<string, GraphNode>,
  prodRoots: string[],
  devRoots: string[]
): Set<string> {
  const reach = (roots: string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = roots.filter((r) => nodes.has(r));
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const d of nodes.get(id)?.deps ?? []) {
        if (!seen.has(d) && nodes.has(d)) stack.push(d);
      }
    }
    return seen;
  };
  const prod = reach(prodRoots);
  const dev = reach(devRoots);
  return new Set([...dev].filter((id) => !prod.has(id)));
}

/** `name@version` → [name, version], keeping the leading `@` of scoped names. */
export function splitNameVersion(spec: string): [string, string] | null {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null;
  return [spec.slice(0, at), spec.slice(at + 1)];
}

/**
 * Shortest chain of node IDs from any root to each reachable node (the root
 * first, the node last). Roots are tried in order, so pass production roots
 * before dev roots to prefer a production path.
 */
export function shortestPaths(nodes: Map<string, GraphNode>, roots: string[]): Map<string, string[]> {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const r of roots) {
    if (nodes.has(r) && !parent.has(r)) {
      parent.set(r, null);
      queue.push(r);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const d of nodes.get(id)?.deps ?? []) {
      if (nodes.has(d) && !parent.has(d)) {
        parent.set(d, id);
        queue.push(d);
      }
    }
  }
  const paths = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const chain: string[] = [];
    for (let cur: string | null = id; cur !== null; cur = parent.get(cur) ?? null) chain.unshift(cur);
    paths.set(id, chain);
  }
  return paths;
}

/** `name@version` labels for a chain of node IDs. */
export function pathLabels(nodes: Map<string, GraphNode>, ids: string[] | undefined): string[] | undefined {
  return ids?.map((id) => {
    const n = nodes.get(id)!;
    return `${n.name}@${n.version}`;
  });
}
