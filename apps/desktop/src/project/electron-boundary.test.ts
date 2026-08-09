import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

async function waitForExit(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 20_000);
  const result = await new Promise<{ code: number | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code }));
  });
  clearTimeout(timeout);
  return { ...result, output };
}

async function portIsOpen(port: number): Promise<boolean> {
  try {
    await execFileAsync("node", ["-e", `const net=require('net'); const s=net.createConnection({host:'127.0.0.1',port:${port}}); s.once('connect',()=>{s.destroy();process.exit(0)}); s.once('error',()=>process.exit(1)); setTimeout(()=>process.exit(1),500);`]);
    return true;
  } catch {
    return false;
  }
}

describe("native Electron lifecycle boundary", () => {
  it("starts an inspected fixture and releases its owned server on app quit", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "themelab-electron-") );
    try {
      await mkdir(path.join(fixture, "node_modules"));
      await symlink(path.resolve(process.cwd(), "node_modules/react"), path.join(fixture, "node_modules/react"));
      await symlink(path.resolve(process.cwd(), "node_modules/vite"), path.join(fixture, "node_modules/vite"));
      await writeFile(path.join(fixture, "package.json"), JSON.stringify({
        name: "themelab-electron-fixture",
        private: true,
        packageManager: "pnpm@10.0.0",
        dependencies: { react: "19.0.0", vite: "6.0.0" },
        scripts: { dev: "node server.cjs" },
      }, null, 2));
      await writeFile(path.join(fixture, "server.cjs"), `const http=require('http'); const args=process.argv.slice(2); const port=Number(args[args.indexOf('--port')+1]); const server=http.createServer((_,res)=>{res.end('ok')}); server.listen(port,'127.0.0.1');`);

      const electron = require("electron") as string;
      const main = path.resolve(process.cwd(), "dist/main.js");
      const result = await waitForExit(electron, [main], {
        ...process.env,
        THEMELAB_WORKSPACE: fixture,
        THEMELAB_E2E_AUTOSTART: "1",
        THEMELAB_E2E_QUIT_DELAY_MS: "100",
      });
      const match = result.output.match(/owned server ready at http:\/\/127\.0\.0\.1:(\d+)/);
      expect(result.code, result.output).toBe(0);
      expect(match, result.output).not.toBeNull();
      expect(await portIsOpen(Number(match?.[1]))).toBe(false);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});
