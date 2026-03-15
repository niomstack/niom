/**
 * Skill Pack Loader
 *
 * Parses SKILL.md files (YAML frontmatter + markdown body) into SkillPack
 * objects. Handles both built-in packs shipped with NIOM and future
 * user-installed packs.
 *
 * Format:
 *   ---
 *   name: os
 *   domain: os
 *   tier: primitive
 *   description: "..."
 *   exemplars: [...]
 *   tools:
 *     - name: readFile
 *       description: "..."
 *       exemplars: [...]
 *       approval: auto
 *   evaluation:
 *     rubric: "..."
 *   ---
 *   Markdown body = system prompt fragment
 */

import * as fs from "fs";
import * as path from "path";
import type {
  SkillPack,
  PackTier,
  PackToolDeclaration,
  ToolApproval,
  PackEvaluation,
} from "@/shared/skill-types";

// ─── YAML Frontmatter Parser ─────────────────────────────────────────
// Lightweight parser — no external dependency. Handles the SKILL.md format.

interface ParsedSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse a SKILL.md file into frontmatter (YAML) and body (markdown).
 * Expects the file to start with `---` frontmatter delimiter.
 */
function parseSkillFile(content: string): ParsedSkillFile {
  const trimmed = content.trim();

  if (!trimmed.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter (---)");
  }

  // Find the closing --- delimiter
  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    throw new Error("SKILL.md frontmatter is not closed (missing ---)");
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  const frontmatter = parseYaml(yamlBlock);

  return { frontmatter, body };
}

/**
 * Minimal YAML parser for SKILL.md frontmatter.
 * Handles: scalar values, arrays (inline and block), nested objects (tools, evaluation).
 * Does NOT handle: anchors, aliases, merge keys, multi-line strings, flow maps.
 */
function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    const rawValue = trimmedLine.slice(colonIndex + 1).trim();

    if (rawValue === "" || rawValue === "|" || rawValue === ">") {
      // Could be a block list or nested object — look at next line
      const nextLineIndent = getIndent(lines[i + 1] || "");
      const currentIndent = getIndent(line);

      if (nextLineIndent > currentIndent) {
        // Block content — collect all indented lines
        const blockLines: string[] = [];
        i++;
        while (i < lines.length) {
          const innerIndent = getIndent(lines[i]);
          if (lines[i].trim() === "" && i + 1 < lines.length && getIndent(lines[i + 1]) > currentIndent) {
            blockLines.push(lines[i]);
            i++;
            continue;
          }
          if (innerIndent <= currentIndent && lines[i].trim() !== "") break;
          blockLines.push(lines[i]);
          i++;
        }

        const blockContent = blockLines.join("\n");

        // Is it a list of objects (tools)?
        if (blockContent.trim().startsWith("- ")) {
          result[key] = parseYamlBlockList(blockContent);
        } else {
          // Nested object (e.g. evaluation)
          result[key] = parseYaml(dedent(blockContent));
        }
        continue;
      }
    }

    // Inline array: [item1, item2, ...]
    if (rawValue.startsWith("[")) {
      result[key] = parseInlineArray(rawValue);
      i++;
      continue;
    }

    // Block array starting on the next line
    if (rawValue === "") {
      i++;
      continue;
    }

    // Scalar value
    result[key] = parseScalar(rawValue);
    i++;
  }

  return result;
}

/**
 * Parse a block list (items starting with `- `).
 * Handles both simple lists and lists of objects.
 */
function parseYamlBlockList(block: string): unknown[] {
  const items: unknown[] = [];
  const lines = block.split("\n");
  let i = 0;

  while (i < lines.length) {
    const trimmedLine = lines[i].trim();

    if (trimmedLine.startsWith("- ")) {
      const firstLine = trimmedLine.slice(2).trim();

      // Check if this is a simple scalar item or an object
      if (firstLine.includes(":")) {
        // Object item — collect all lines until next `- ` at same indent level
        const itemIndent = getIndent(lines[i]);
        const objLines = [firstLine];
        i++;

        while (i < lines.length) {
          const nextTrimmed = lines[i].trim();
          const nextIndent = getIndent(lines[i]);

          if (nextTrimmed.startsWith("- ") && nextIndent <= itemIndent) break;
          if (nextTrimmed === "") { i++; continue; }
          objLines.push(nextTrimmed);
          i++;
        }

        items.push(parseYaml(objLines.join("\n")));
      } else {
        // Simple scalar item
        items.push(parseScalar(firstLine));
        i++;
      }
    } else {
      i++;
    }
  }

  return items;
}

/** Parse an inline YAML array: [a, b, c] */
function parseInlineArray(value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => parseScalar(item.trim()) as string);
}

/** Parse a YAML scalar value (string, number, boolean). */
function parseScalar(value: string): string | number | boolean {
  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  if (value === "true") return true;
  if (value === "false") return false;

  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;

  return value;
}

/** Get the indentation level of a line. */
function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/** Remove common leading indentation from a block. */
function dedent(block: string): string {
  const lines = block.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return "";
  const minIndent = Math.min(...lines.map(getIndent));
  return block
    .split("\n")
    .map((l) => l.slice(minIndent))
    .join("\n");
}

// ─── Skill Pack Validation ───────────────────────────────────────────

const VALID_TIERS: PackTier[] = ["primitive", "intent", "fallback"];
const VALID_APPROVALS: ToolApproval[] = ["auto", "confirm", "deny"];

/**
 * Validate and transform parsed frontmatter into a SkillPack.
 * Throws descriptive errors on invalid format.
 */
function validatePack(
  fm: Record<string, unknown>,
  body: string,
  source: string,
): SkillPack {
  // Required fields
  const name = expectString(fm, "name", source);
  const domain = expectString(fm, "domain", source);
  const tier = expectEnum(fm, "tier", VALID_TIERS, source) as PackTier;
  const description = expectString(fm, "description", source);

  // Exemplars (required, array of strings)
  const exemplars = expectStringArray(fm, "exemplars", source);

  // Negative exemplars (optional)
  const negativeExemplars = fm.negativeExemplars
    ? expectStringArray(fm, "negativeExemplars", source)
    : undefined;

  // Tools (optional — fallback packs may have none)
  const rawTools = fm.tools as Record<string, unknown>[] | undefined;
  const tools: PackToolDeclaration[] = (rawTools || []).map((t, idx) =>
    validateToolDecl(t, `${source} tool[${idx}]`),
  );

  // Evaluation (optional)
  const rawEval = fm.evaluation as Record<string, unknown> | undefined;
  const evaluation: PackEvaluation | undefined = rawEval
    ? { rubric: expectString(rawEval, "rubric", `${source} evaluation`) }
    : undefined;

  return {
    name,
    domain,
    tier,
    description,
    exemplars,
    negativeExemplars,
    tools,
    evaluation,
    systemPrompt: body,
    source,
  };
}

function validateToolDecl(
  raw: Record<string, unknown>,
  context: string,
): PackToolDeclaration {
  return {
    name: expectString(raw, "name", context),
    description: expectString(raw, "description", context),
    exemplars: expectStringArray(raw, "exemplars", context),
    negativeExemplars: raw.negativeExemplars
      ? expectStringArray(raw, "negativeExemplars", context)
      : undefined,
    approval: raw.approval
      ? (expectEnum(raw, "approval", VALID_APPROVALS, context) as ToolApproval)
      : undefined,
  };
}

// ─── Validation Helpers ──────────────────────────────────────────────

function expectString(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`[${ctx}] Missing or empty required field: "${key}"`);
  }
  return val;
}

function expectStringArray(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): string[] {
  const val = obj[key];
  if (!Array.isArray(val)) {
    throw new Error(`[${ctx}] Expected array for "${key}", got ${typeof val}`);
  }
  return val.map((item, i) => {
    if (typeof item !== "string") {
      throw new Error(`[${ctx}] ${key}[${i}] must be a string`);
    }
    return item;
  });
}

function expectEnum(
  obj: Record<string, unknown>,
  key: string,
  valid: string[],
  ctx: string,
): string {
  const val = expectString(obj, key, ctx);
  if (!valid.includes(val)) {
    throw new Error(`[${ctx}] "${key}" must be one of: ${valid.join(", ")}. Got: "${val}"`);
  }
  return val;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Load a single SKILL.md file and return the parsed SkillPack.
 */
export function loadSkillPack(filePath: string): SkillPack {
  const content = fs.readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseSkillFile(content);
  return validatePack(frontmatter, body, filePath);
}

/**
 * Load all built-in Skill Packs from the packs directory.
 * Returns an array of validated SkillPack objects.
 */
export function loadBuiltinPacks(): SkillPack[] {
  const packsDir = path.join(__dirname, "packs");

  // If running from webpack bundle, __dirname might not resolve correctly.
  // Fall back to requiring the known pack paths.
  if (!fs.existsSync(packsDir)) {
    console.warn("[SkillLoader] Packs directory not found at:", packsDir);
    return [];
  }

  const packs: SkillPack[] = [];
  const entries = fs.readdirSync(packsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = path.join(packsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      console.warn(`[SkillLoader] No SKILL.md found in pack: ${entry.name}`);
      continue;
    }

    try {
      const pack = loadSkillPack(skillPath);
      packs.push(pack);
      console.log(`[SkillLoader] Loaded pack: ${pack.name} (${pack.tier}, ${pack.tools.length} tools)`);
    } catch (error) {
      console.error(`[SkillLoader] Failed to load pack ${entry.name}:`, error);
    }
  }

  // Sort: primitive first, then intent, then fallback
  const tierOrder: Record<PackTier, number> = { primitive: 0, intent: 1, fallback: 2 };
  packs.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  return packs;
}

/**
 * Load a user-installed Skill Pack from an arbitrary path.
 * Used for marketplace packs installed to ~/.niom/skills/.
 */
export function loadUserPack(packDir: string): SkillPack | null {
  const skillPath = path.join(packDir, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    console.warn(`[SkillLoader] No SKILL.md found at: ${skillPath}`);
    return null;
  }

  try {
    return loadSkillPack(skillPath);
  } catch (error) {
    console.error(`[SkillLoader] Failed to load user pack at ${packDir}:`, error);
    return null;
  }
}
