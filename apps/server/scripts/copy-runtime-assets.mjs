import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/jobs/live-browser-script.js");
const destDir = path.join(root, "dist/jobs");
const dest = path.join(destDir, "live-browser-script.js");

mkdirSync(destDir, { recursive: true });
cpSync(src, dest);
console.log(`copied ${path.relative(root, src)} → ${path.relative(root, dest)}`);
