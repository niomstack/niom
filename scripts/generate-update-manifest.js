/**
 * Generate electron-updater manifest files (latest.yml / latest-mac.yml / latest-linux.yml).
 *
 * Usage: node scripts/generate-update-manifest.js <file> <manifest-name> <version>
 *
 * Creates a YAML manifest with sha512 hash, file size, and release date
 * that electron-updater uses to discover and verify updates.
 */

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const [, , filePath, manifestName, version] = process.argv;

if (!filePath || !manifestName || !version) {
  console.error("Usage: node generate-update-manifest.js <file> <manifest-name> <version>");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(filePath);
const hash = crypto.createHash("sha512");
hash.update(fileBuffer);
const sha512 = hash.digest("base64");
const size = fileBuffer.length;
const basename = path.basename(filePath);
const releaseDate = new Date().toISOString();

const manifest = `version: ${version}
files:
  - url: ${basename}
    sha512: ${sha512}
    size: ${size}
path: ${basename}
sha512: ${sha512}
releaseDate: '${releaseDate}'
`;

fs.writeFileSync(manifestName, manifest, "utf-8");
console.log(`Generated: ${manifestName} (${basename}, ${size} bytes)`);
