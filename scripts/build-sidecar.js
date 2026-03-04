/**
 * build-sidecar.js — Prepare the Node.js sidecar for Tauri bundling.
 *
 * Steps:
 *   1. Download a portable Node.js binary for the target platform
 *   2. Build the sidecar JS (tsup → dist/)
 *   3. Prune to production node_modules
 *   4. Stage everything into src-tauri/sidecar-bundle/ for Tauri to bundle
 *
 * This runs as part of `beforeBuildCommand` in tauri.conf.json.
 * The resulting bundle includes:
 *   sidecar-bundle/
 *   ├── node[.exe]          ← portable Node.js binary
 *   ├── dist/               ← compiled sidecar JS
 *   ├── node_modules/       ← production dependencies
 *   └── package.json
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync, readdirSync, statSync, cpSync, renameSync } from "fs";
import { join, resolve } from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

const ROOT = resolve(import.meta.dirname, "..");
const SIDECAR_DIR = join(ROOT, "niom-ai");
const BUNDLE_DIR = join(ROOT, "src-tauri", "sidecar-bundle");
const NODE_VERSION = "22.16.0"; // LTS

function run(cmd, cwd = SIDECAR_DIR) {
    console.log(`  → ${cmd}`);
    execSync(cmd, { cwd, stdio: "inherit" });
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dirSize(dir) {
    let total = 0;
    if (!existsSync(dir)) return 0;
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) total += dirSize(full);
            else try { total += statSync(full).size; } catch { /* skip */ }
        }
    } catch { /* skip */ }
    return total;
}

/**
 * Determine Node.js download URL for the current platform.
 * Override with NIOM_TARGET env var for cross-compilation.
 */
function getNodeDownloadInfo() {
    // Allow override for cross-compilation in CI
    const target = process.env.NIOM_TARGET || `${process.platform}-${process.arch}`;

    const map = {
        "win32-x64": { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`, ext: ".zip", bin: "node.exe" },
        "win32-arm64": { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-arm64.zip`, ext: ".zip", bin: "node.exe" },
        "darwin-x64": { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`, ext: ".tar.gz", bin: "node" },
        "darwin-arm64": { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`, ext: ".tar.gz", bin: "node" },
        "linux-x64": { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz`, ext: ".tar.xz", bin: "node" },
        "linux-arm64": { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz`, ext: ".tar.xz", bin: "node" },
    };

    const info = map[target];
    if (!info) throw new Error(`Unsupported platform: ${target}. Supported: ${Object.keys(map).join(", ")}`);
    return { ...info, target };
}

/**
 * Download and extract the Node.js binary.
 */
async function downloadNode(info) {
    const cacheDir = join(ROOT, ".node-cache");
    const nodeBinDest = join(BUNDLE_DIR, info.bin);

    // Check if already cached
    if (existsSync(nodeBinDest)) {
        console.log(`  ✓ Node.js binary already present`);
        return;
    }

    mkdirSync(cacheDir, { recursive: true });
    const archivePath = join(cacheDir, `node-v${NODE_VERSION}${info.ext}`);

    // Download if not cached
    if (!existsSync(archivePath)) {
        console.log(`  Downloading Node.js v${NODE_VERSION} for ${info.target}...`);
        console.log(`  URL: ${info.url}`);

        const res = await fetch(info.url);
        if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
        await pipeline(res.body, createWriteStream(archivePath));
        console.log(`  ✓ Downloaded (${formatSize(statSync(archivePath).size)})`);
    } else {
        console.log(`  ✓ Using cached download`);
    }

    // Extract just the node binary
    mkdirSync(BUNDLE_DIR, { recursive: true });
    const extractDir = join(cacheDir, "extract");
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });

    if (info.ext === ".zip") {
        // Windows: use PowerShell to extract
        execSync(
            `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`,
            { stdio: "inherit" }
        );
        // Find the node.exe inside the extracted folder
        const extracted = readdirSync(extractDir)[0]; // e.g., node-v22.16.0-win-x64
        const src = join(extractDir, extracted, "node.exe");
        cpSync(src, nodeBinDest);
    } else {
        // macOS/Linux: tar extract just the node binary
        const stripComponents = info.ext === ".tar.xz" ? 1 : 1;
        const tarFlag = info.ext === ".tar.xz" ? "xJf" : "xzf";
        // Extract the entire archive first, then copy just the binary
        execSync(`tar ${tarFlag} "${archivePath}" -C "${extractDir}"`, { stdio: "inherit" });
        const extracted = readdirSync(extractDir)[0];
        const src = join(extractDir, extracted, "bin", "node");
        cpSync(src, nodeBinDest);
        // Make executable
        execSync(`chmod +x "${nodeBinDest}"`);
    }

    rmSync(extractDir, { recursive: true, force: true });
    console.log(`  ✓ Node.js binary extracted to bundle`);
}

/**
 * Clean unnecessary files from node_modules to shrink bundle.
 */
function cleanNodeModules(nmDir) {
    const removable = new Set([
        "README.md", "readme.md", "README", "CHANGELOG.md", "changelog.md",
        "HISTORY.md", "LICENSE", "LICENSE.md", "LICENSE.txt", "license",
        ".github", ".npmignore", ".eslintrc", ".eslintrc.json",
        "tsconfig.json", ".editorconfig", ".prettierrc",
        "CONTRIBUTING.md", "SECURITY.md", ".travis.yml",
        "appveyor.yml", ".coveralls.yml",
    ]);

    let cleaned = 0;
    function walk(dir) {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (removable.has(entry.name)) {
                rmSync(full, { recursive: true, force: true });
                cleaned++;
            } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
                walk(full);
            }
        }
    }
    walk(nmDir);
    return cleaned;
}

// ═══════════════════════════════════════
//  Main
// ═══════════════════════════════════════

async function main() {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║      NIOM Sidecar Build for Tauri        ║");
    console.log("╚══════════════════════════════════════════╝");

    const nodeInfo = getNodeDownloadInfo();
    console.log(`\nTarget: ${nodeInfo.target}`);
    console.log(`Node.js: v${NODE_VERSION}\n`);

    // Step 1: Prepare bundle directory
    console.log("[1/4] Preparing bundle directory...");
    rmSync(BUNDLE_DIR, { recursive: true, force: true });
    mkdirSync(BUNDLE_DIR, { recursive: true });

    // Step 2: Download Node.js
    console.log("\n[2/4] Downloading Node.js binary...");
    await downloadNode(nodeInfo);

    // Step 3: Build sidecar JS
    console.log("\n[3/4] Building sidecar...");
    run("pnpm install --frozen-lockfile");
    run("pnpm build");

    // Copy built files to bundle
    cpSync(join(SIDECAR_DIR, "dist"), join(BUNDLE_DIR, "dist"), { recursive: true });
    cpSync(join(SIDECAR_DIR, "package.json"), join(BUNDLE_DIR, "package.json"));

    // Copy built-in skill packs (.md files — not bundled by tsup)
    const packsDir = join(SIDECAR_DIR, "src", "skills", "packs");
    const bundlePacksDir = join(BUNDLE_DIR, "dist", "packs");
    if (existsSync(packsDir)) {
        cpSync(packsDir, bundlePacksDir, { recursive: true });
        console.log(`  ✓ Copied built-in skill packs to dist/packs/`);
    }

    // Step 4: Install production deps directly in bundle (npm for flat, portable node_modules)
    console.log("\n[4/4] Installing production dependencies in bundle...");
    // npm gives us a flat node_modules without pnpm's symlink store structure
    run("npm install --omit=dev --no-package-lock --ignore-scripts", BUNDLE_DIR);

    // Clean unnecessary files from node_modules
    const cleaned = cleanNodeModules(join(BUNDLE_DIR, "node_modules"));

    // Report sizes
    const nodeBinSize = statSync(join(BUNDLE_DIR, nodeInfo.bin)).size;
    const distSize = dirSize(join(BUNDLE_DIR, "dist"));
    const nmSize = dirSize(join(BUNDLE_DIR, "node_modules"));
    const total = nodeBinSize + distSize + nmSize;

    console.log("\n┌──────────────────────────────────────────┐");
    console.log(`│ node binary     ${formatSize(nodeBinSize).padStart(12)}`);
    console.log(`│ dist/           ${formatSize(distSize).padStart(12)}`);
    console.log(`│ node_modules/   ${formatSize(nmSize).padStart(12)}`);
    console.log(`│ cleaned:        ${String(cleaned).padStart(8)} files`);
    console.log(`│ total bundle:   ${formatSize(total).padStart(12)}`);
    console.log("└──────────────────────────────────────────┘");
    console.log("\n✓ Sidecar bundle ready at src-tauri/sidecar-bundle/\n");
}

main().catch((err) => {
    console.error("\n✗ Build failed:", err.message);
    process.exit(1);
});
