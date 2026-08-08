import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
await copyFile(path.join(root, "src/preload.cjs"), path.join(output, "preload.cjs"));
