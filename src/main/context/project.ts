/**
 * NCF Project Context Detection — Workspace Awareness
 *
 * Auto-detects workspace metadata and creates project context nodes:
 *   1. Detects tech stack from package.json, tsconfig.json, Cargo.toml, etc.
 *   2. Extracts conventions from linting configs, formatters
 *   3. Stores under projects/<hash>/ in the NCF
 *   4. Generates L0 abstract for the project
 *
 * Hashing the workspace path creates a stable, filesystem-safe identifier
 * so the same workspace always maps to the same project node.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { ProjectContext, TechStackEntry } from "@/shared/context-types";
import {
  ensureDir,
  writeL0,
  writeL2,
  readL2,
  readMeta,
  updateMeta,
  updateL0IndexEntry,
  nodeExists,
} from "./ncf";

// ─── Constants ───────────────────────────────────────────────────────

/** Files that indicate a tech stack. Maps filename → tech. */
const TECH_INDICATORS: Record<string, string> = {
  "package.json": "Node.js",
  "tsconfig.json": "TypeScript",
  "Cargo.toml": "Rust",
  "go.mod": "Go",
  "requirements.txt": "Python",
  "pyproject.toml": "Python",
  "Gemfile": "Ruby",
  "build.gradle": "Java/Kotlin",
  "pom.xml": "Java",
  "CMakeLists.txt": "C/C++",
  "Makefile": "Make",
  "docker-compose.yml": "Docker",
  "Dockerfile": "Docker",
  ".eslintrc.json": "ESLint",
  ".eslintrc.js": "ESLint",
  ".prettierrc": "Prettier",
  "tailwind.config.js": "TailwindCSS",
  "tailwind.config.ts": "TailwindCSS",
  "vite.config.ts": "Vite",
  "vite.config.js": "Vite",
  "next.config.js": "Next.js",
  "next.config.ts": "Next.js",
  "next.config.mjs": "Next.js",
  "forge.config.ts": "Electron Forge",
  "electron-builder.yml": "Electron",
};

/** Package.json dependency → framework detection. */
const DEP_INDICATORS: Record<string, string> = {
  react: "React",
  vue: "Vue.js",
  angular: "Angular",
  svelte: "Svelte",
  electron: "Electron",
  express: "Express",
  fastify: "Fastify",
  "next": "Next.js",
  "ai": "AI SDK",
  prisma: "Prisma",
  drizzle: "Drizzle",
  tailwindcss: "TailwindCSS",
  "shadcn-ui": "shadcn/ui",
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Detect and index a workspace as a project in the NCF.
 *
 * @param workspacePath - Absolute path to the workspace root
 * @returns The detected ProjectContext
 */
export async function detectProject(workspacePath: string): Promise<ProjectContext | null> {
  if (!fs.existsSync(workspacePath)) return null;

  const hash = hashWorkspacePath(workspacePath);
  const projectPath = `projects/${hash}`;
  const name = path.basename(workspacePath);

  // Check if we've already analyzed this recently (within 1 hour)
  if (nodeExists(projectPath)) {
    const meta = readMeta(projectPath);
    if (meta && (Date.now() - meta.layersUpdatedAt) < 3600_000) {
      // Read cached project context
      const cached = readL2(`${projectPath}/context.json`);
      if (cached) {
        try {
          return JSON.parse(cached) as ProjectContext;
        } catch {
          // Re-analyze if cached data is corrupted
        }
      }
    }
  }

  // Scan workspace
  const techStack = detectTechStack(workspacePath);
  const conventions = detectConventions(workspacePath);

  const project: ProjectContext = {
    workspaceHash: hash,
    name,
    rootPath: workspacePath,
    techStack,
    conventions,
    analyzedAt: Date.now(),
  };

  // Write to NCF
  ensureDir(projectPath);

  // Store full context as L2
  writeL2(`${projectPath}/context.json`, JSON.stringify(project, null, 2));

  // Generate L0 abstract
  const stackNames = techStack.map((t) => t.name).join(", ");
  const abstract = `Project "${name}": ${stackNames || "unknown stack"}. ${conventions.length} conventions detected.`;
  writeL0(projectPath, abstract);
  updateL0IndexEntry(projectPath, abstract);

  // Generate a readable overview (L1)
  const overview = generateProjectOverview(project);
  writeL2(`${projectPath}/.overview.md`, overview);

  updateMeta(projectPath, {
    source: `workspace:${workspacePath}`,
    layersUpdatedAt: Date.now(),
  });

  console.log(
    `[NCF Project] Indexed "${name}": ${techStack.length} technologies, ${conventions.length} conventions`,
  );

  return project;
}

/**
 * Get project context for a workspace, if indexed.
 */
export function getProjectContext(workspacePath: string): ProjectContext | null {
  const hash = hashWorkspacePath(workspacePath);
  const contextFile = `projects/${hash}/context.json`;

  const content = readL2(contextFile);
  if (!content) return null;

  try {
    return JSON.parse(content) as ProjectContext;
  } catch {
    return null;
  }
}

// ─── Detection Logic ─────────────────────────────────────────────────

/**
 * Detect tech stack from workspace files.
 */
function detectTechStack(workspacePath: string): TechStackEntry[] {
  const stack: TechStackEntry[] = [];
  const seen = new Set<string>();

  // Check for indicator files
  for (const [filename, tech] of Object.entries(TECH_INDICATORS)) {
    const filePath = path.join(workspacePath, filename);
    if (fs.existsSync(filePath)) {
      if (!seen.has(tech)) {
        const entry: TechStackEntry = {
          name: tech,
          detectedFrom: filename,
        };

        // Try to extract version for some files
        if (filename === "package.json") {
          try {
            const pkg = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            if (pkg.engines?.node) {
              entry.version = pkg.engines.node;
            }
          } catch {
            // Ignore parse errors
          }
        }

        stack.push(entry);
        seen.add(tech);
      }
    }
  }

  // Check package.json dependencies for framework detection
  const pkgPath = path.join(workspacePath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      for (const [dep, tech] of Object.entries(DEP_INDICATORS)) {
        if (dep in allDeps && !seen.has(tech)) {
          stack.push({
            name: tech,
            version: String(allDeps[dep]).replace(/[\^~]/g, ""),
            detectedFrom: `package.json (${dep})`,
          });
          seen.add(tech);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check Cargo.toml for Rust version
  const cargoPath = path.join(workspacePath, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    try {
      const cargo = fs.readFileSync(cargoPath, "utf-8");
      const editionMatch = cargo.match(/edition\s*=\s*"(\d+)"/);
      if (editionMatch) {
        const existing = stack.find((s) => s.name === "Rust");
        if (existing) existing.version = `edition ${editionMatch[1]}`;
      }
    } catch {
      // Ignore
    }
  }

  return stack;
}

/**
 * Detect project conventions from config files.
 */
function detectConventions(workspacePath: string): string[] {
  const conventions: string[] = [];

  // TypeScript strictness
  const tsconfigPath = path.join(workspacePath, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      if (tsconfig.compilerOptions?.strict) {
        conventions.push("TypeScript strict mode enabled");
      }
      if (tsconfig.compilerOptions?.paths) {
        conventions.push("Path aliases configured (@ imports)");
      }
    } catch {
      // Ignore
    }
  }

  // ESLint config
  const eslintFiles = [".eslintrc.json", ".eslintrc.js", ".eslintrc.yml", "eslint.config.js"];
  for (const file of eslintFiles) {
    if (fs.existsSync(path.join(workspacePath, file))) {
      conventions.push(`ESLint configured (${file})`);
      break;
    }
  }

  // Prettier
  const prettierFiles = [".prettierrc", ".prettierrc.json", ".prettierrc.yml", "prettier.config.js"];
  for (const file of prettierFiles) {
    if (fs.existsSync(path.join(workspacePath, file))) {
      conventions.push("Prettier code formatter configured");
      break;
    }
  }

  // Git
  if (fs.existsSync(path.join(workspacePath, ".git"))) {
    conventions.push("Git version control");
  }

  // Monorepo indicators
  if (fs.existsSync(path.join(workspacePath, "pnpm-workspace.yaml"))) {
    conventions.push("pnpm workspace (monorepo)");
  }
  if (fs.existsSync(path.join(workspacePath, "lerna.json"))) {
    conventions.push("Lerna monorepo");
  }

  // CI/CD
  if (fs.existsSync(path.join(workspacePath, ".github/workflows"))) {
    conventions.push("GitHub Actions CI/CD");
  }

  return conventions;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Generate a stable hash from a workspace path.
 */
function hashWorkspacePath(workspacePath: string): string {
  return crypto
    .createHash("sha256")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Generate a human-readable project overview (L1).
 */
function generateProjectOverview(project: ProjectContext): string {
  const lines = [
    `# ${project.name}`,
    "",
    `**Path:** \`${project.rootPath}\``,
    `**Analyzed:** ${new Date(project.analyzedAt).toISOString()}`,
    "",
    "## Tech Stack",
    "",
  ];

  if (project.techStack.length > 0) {
    for (const tech of project.techStack) {
      const version = tech.version ? ` (${tech.version})` : "";
      lines.push(`- **${tech.name}**${version} — detected from \`${tech.detectedFrom}\``);
    }
  } else {
    lines.push("- No technologies detected");
  }

  lines.push("", "## Conventions", "");

  if (project.conventions.length > 0) {
    for (const conv of project.conventions) {
      lines.push(`- ${conv}`);
    }
  } else {
    lines.push("- No conventions detected");
  }

  return lines.join("\n");
}
