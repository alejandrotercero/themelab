#!/usr/bin/env node
// Copies the compiled host binary (dist/themelab) onto a directory in your
// PATH so `themelab` runs from anywhere. Run via `pnpm install:bin`, which
// builds the binary first.
//
// Destination resolution (first match wins):
//   1. first CLI arg          → pnpm install:bin -- /usr/local/bin
//   2. $THEMELAB_BIN_DIR
//   3. ~/.local/bin (default)

import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const isWin = process.platform === "win32";
const exe = isWin ? ".exe" : "";
const src = join(repoRoot, "dist", `themelab${exe}`);

if (!existsSync(src)) {
  console.error(`install-bin: ${src} not found — run \`pnpm build:bin\` first.`);
  process.exit(1);
}

const destDir = resolve(
  process.argv[2] || process.env.THEMELAB_BIN_DIR || join(homedir(), ".local", "bin")
);
const dest = join(destDir, `themelab${exe}`);

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
if (!isWin) chmodSync(dest, 0o755);

console.log(`install-bin: installed → ${dest}`);

const onPath = (process.env.PATH || "")
  .split(delimiter)
  .map((p) => resolve(p))
  .includes(destDir);

if (!onPath) {
  console.log(`\n${destDir} is not on your PATH. Add it, e.g. (fish):`);
  console.log(`  fish_add_path ${destDir}`);
  console.log(`or (bash/zsh):`);
  console.log(`  echo 'export PATH="${destDir}:$PATH"' >> ~/.profile`);
} else {
  console.log(`Run it from anywhere: themelab`);
}
