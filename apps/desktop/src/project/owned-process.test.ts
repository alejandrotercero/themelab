import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { startOwnedProcess } from "./owned-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("startOwnedProcess", () => {
  it("stops the full POSIX process group it owns", async () => {
    if (process.platform === "win32") return;
    const script = "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); console.log(child.pid); setInterval(() => {}, 1000);";
    const owned = startOwnedProcess({ executable: process.execPath, args: ["-e", script], cwd: here, env: process.env });
    const childPid = await new Promise<number>((resolve, reject) => {
      let output = "";
      owned.child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const pid = Number(output.trim());
        if (Number.isInteger(pid) && pid > 0) resolve(pid);
      });
      owned.child.once("error", reject);
    });
    await owned.stop();
    expect(owned.child.exitCode !== null || owned.child.signalCode !== null).toBe(true);
    expect(() => process.kill(childPid, 0)).toThrow();
  }, 10_000);

  it("is idempotent after the process has stopped", async () => {
    const owned = startOwnedProcess({ executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: here, env: process.env });
    await owned.stop();
    await expect(owned.stop()).resolves.toBeUndefined();
  }, 10_000);
});
