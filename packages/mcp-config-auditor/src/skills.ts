import { basename, dirname } from "path";
import { findSecretTokens } from "./secrets.js";
import type { ConfigFinding } from "./types.js";

export interface ParsedSkill {
  name: string;
  allowedTools: string[];
  body: string;
  /** Absolute offset of the markdown body, after the closing frontmatter fence. */
  bodyOffset: number;
}

interface BodyRule {
  id: string;
  name: string;
  pattern: RegExp;
  severity: ConfigFinding["severity"];
  owasp: string;
  recommendation: string;
}

const BODY_RULES: BodyRule[] = [
  {
    id: "skill_instruction_override",
    name: "Skill tells the model to ignore prior instructions",
    pattern: /\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/i,
    severity: "critical",
    owasp: "MCP06:2025",
    recommendation:
      "A skill's body is loaded as trusted instructions. Telling the model to ignore the user's or the system's prior instructions is the skill overriding the person who installed it. Remove that sentence.",
  },
  {
    id: "skill_covert_instruction",
    name: "Skill tells the model to hide its behavior from the user",
    pattern: /\bdo\s+not\s+(?:tell|inform|mention\s+(?:this\s+)?to)\s+the\s+user\b/i,
    severity: "critical",
    owasp: "MCP06:2025",
    recommendation:
      "A skill that asks the model not to tell the user what it is doing hides its own behavior from the person it acts for. Do not install it.",
  },
  {
    id: "skill_secret_file_read",
    name: "Skill instructs the model to read a credential file",
    pattern: /\b(?:read|cat|include|attach|open)\b[^.\n]{0,80}(?:\.ssh\b|\bid_rsa\b|\.env\b|\.aws[\\/]credentials\b|\.npmrc\b)/i,
    severity: "critical",
    owasp: "MCP01:2025",
    recommendation:
      "The skill asks the model to read a key or environment file. Those contents would enter the model context and any tool the skill is allowed to call. Delete the instruction.",
  },
  {
    id: "skill_at_secret_ref",
    name: "Skill inlines a credential path with an @ reference",
    pattern: /@(?:~\/\.ssh\/|\.env\b|id_rsa\b|\.aws\/credentials\b|\.npmrc\b)/i,
    severity: "critical",
    owasp: "MCP01:2025",
    recommendation:
      "An @ reference pastes a file into the skill prompt. Pointing it at .env, .npmrc, or an SSH key loads that secret into the model. Reference a non-secret path, or drop the reference.",
  },
];

const SHELL_TOOLS = new Set(["bash", "shell", "exec", "execute", "runterminal", "terminal", "computer"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

function locate(text: string, index: number): { line: number; column: number } {
  if (index < 0) return { line: 1, column: 1 };
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  return { line, column: index - (lastNl === -1 ? 0 : lastNl + 1) + 1 };
}

function findingAt(text: string, index: number, partial: Omit<ConfigFinding, "line" | "column">): ConfigFinding {
  const loc = locate(text, index);
  return { ...partial, line: loc.line, column: loc.column };
}

/**
 * Reads a SKILL.md frontmatter block. Without an opening fence, the whole
 * file is the skill body and the name falls back to the parent directory.
 */
export function parseSkillMarkdown(text: string, fallbackName: string): ParsedSkill {
  const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!fence) {
    return { name: fallbackName, allowedTools: [], body: text, bodyOffset: 0 };
  }
  const fields = parseFields(fence[1] ?? "");
  const nameField = fields.name;
  const name = typeof nameField === "string" && nameField.trim() ? nameField.trim() : fallbackName;
  return {
    name,
    allowedTools: toolList(fields["allowed-tools"] ?? fields.allowed_tools ?? fields.tools),
    body: text.slice(fence[0].length),
    bodyOffset: fence[0].length,
  };
}

function parseFields(frontmatter: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of frontmatter.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && listKey) {
      const current = fields[listKey];
      const value = stripQuotes(item[1] ?? "");
      if (Array.isArray(current)) current.push(value);
      else fields[listKey] = [value];
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] ?? "";
    const value = stripQuotes(kv[2] ?? "");
    if (value === "" || value === "|" || value === ">") {
      listKey = key;
      fields[key] = [];
    } else {
      listKey = null;
      fields[key] = value;
    }
  }
  return fields;
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function toolList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : [value];
  return parts.flatMap((item) => item.split(/[\s,]+/)).map((item) => item.trim()).filter(Boolean);
}

/** Bare Bash/Shell/* is unrestricted. Bash(git:*) is a command allowlist and is not. */
export function unrestrictedTool(tool: string): "shell" | "write" | null {
  const match = /^([A-Za-z*][\w-]*)(?:\(([^)]*)\))?$/.exec(tool.trim());
  if (!match) return null;
  const name = (match[1] ?? "").toLowerCase();
  const inner = match[2];
  const open = inner === undefined || inner.trim() === "" || inner.trim() === "*";
  if (!open) return null;
  if (name === "*" || name === "all" || SHELL_TOOLS.has(name)) return "shell";
  if (WRITE_TOOLS.has(name)) return "write";
  return null;
}

export function auditSkill(text: string, file?: string, fallbackName = "skill"): ConfigFinding[] {
  const skill = parseSkillMarkdown(text, fallbackName);
  const findings: ConfigFinding[] = [];

  for (const tool of skill.allowedTools) {
    const kind = unrestrictedTool(tool);
    if (!kind) continue;
    const index = text.indexOf(tool);
    if (kind === "shell") {
      findings.push(
        findingAt(text, index, {
          patternId: "skill_unrestricted_shell",
          patternName: "Skill grants unrestricted shell or every tool",
          category: "agency",
          severity: "critical",
          owasp: "MCP02:2025",
          recommendation:
            "allowed-tools includes unrestricted Bash, shell, or *. Constrain it to the commands the skill needs, for example Bash(git diff:*). A bare Bash entry lets the model run any command without a prompt.",
          server: skill.name,
          file,
          match: tool,
        })
      );
    } else {
      findings.push(
        findingAt(text, index, {
          patternId: "skill_unrestricted_write",
          patternName: "Skill grants unrestricted file write or edit",
          category: "agency",
          severity: "high",
          owasp: "MCP02:2025",
          recommendation:
            "allowed-tools includes Write or Edit with no path limit. The model can change any file the skill's host can see. Allow only the paths this skill is supposed to edit.",
          server: skill.name,
          file,
          match: tool,
        })
      );
    }
  }

  for (const rule of BODY_RULES) {
    const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(skill.body)) !== null) {
      findings.push(
        findingAt(text, skill.bodyOffset + match.index, {
          patternId: rule.id,
          patternName: rule.name,
          category: "skill-body",
          severity: rule.severity,
          owasp: rule.owasp,
          recommendation: rule.recommendation,
          server: skill.name,
          file,
          match: match[0].slice(0, 160),
        })
      );
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  for (const secret of findSecretTokens(text)) {
    findings.push(
      findingAt(text, secret.index, {
        patternId: "secret_in_skill",
        patternName: "Credential written into a skill file",
        category: "secrets",
        severity: "critical",
        owasp: "MCP01:2025",
        recommendation:
          "A skill file is copied into the model prompt. A literal token there is visible to the model and to anyone with the file. Remove it and read the secret from the environment at runtime.",
        server: skill.name,
        file,
        match: secret.redacted,
      })
    );
  }

  return findings;
}

export interface NamedSkill {
  name: string;
  file?: string;
}

const CONFUSABLES: Record<string, string> = {
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
  "\u0456": "i",
  "\u0455": "s",
};

function normalizeName(name: string): string {
  let out = "";
  for (const ch of name.toLowerCase()) out += CONFUSABLES[ch] ?? ch;
  return out;
}

/** Same skill name, or lookalike names, installed side by side. */
export function findSkillShadowing(skills: NamedSkill[]): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  const byName = new Map<string, NamedSkill[]>();
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(skill);
    byName.set(key, list);
  }
  for (const [name, owners] of byName) {
    if (owners.length < 2) continue;
    findings.push({
      patternId: "skill_name_shadow",
      patternName: `Skill name "${name}" is defined more than once`,
      category: "shadowing",
      severity: "high",
      owasp: "MCP03:2025",
      recommendation: `These files use the same skill name: ${owners.map((owner) => owner.file ?? owner.name).join(", ")}. The agent can load the wrong one. Rename the skill you did not intend to shadow.`,
      server: name,
      file: owners[1]?.file,
      line: 1,
      column: 1,
      match: name,
    });
  }

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const left = skills[i];
      const right = skills[j];
      if (!left || !right) continue;
      if (left.name.toLowerCase() === right.name.toLowerCase()) continue;
      if (normalizeName(left.name) !== normalizeName(right.name)) continue;
      findings.push({
        patternId: "skill_confusable_name",
        patternName: `Skill names "${left.name}" and "${right.name}" look alike`,
        category: "shadowing",
        severity: "critical",
        owasp: "MCP03:2025",
        recommendation:
          "A homoglyph in a skill name lets one skill impersonate another when the agent chooses by the rendered name. Compare the raw characters and remove the lookalike.",
        server: `${left.name}, ${right.name}`,
        file: right.file,
        line: 1,
        column: 1,
        match: `${left.name} ~ ${right.name}`,
      });
    }
  }
  return findings;
}

export function skillNameFromPath(filePath: string): string {
  const parent = basename(dirname(filePath));
  return parent && parent !== "." ? parent : "skill";
}
