import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, saveConfig, updateAiConfig, resolveAiConfig, configPath } from "../config.js";

const ENV_KEYS = ["XDG_CONFIG_HOME", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "THEMELAB_AI_MODEL"] as const;

describe("config: AI settings storage + resolution", () => {
  let saved: Record<string, string | undefined>;
  let tmpDir: string;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rr-config-"));
    process.env.XDG_CONFIG_HOME = tmpDir;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("round-trips save/load and writes under the config dir", () => {
    expect(loadConfig()).toEqual({});
    saveConfig({ ai: { apiKey: "sk-test", model: "claude-x" } });
    expect(configPath().startsWith(tmpDir)).toBe(true);
    expect(loadConfig()).toEqual({ ai: { apiKey: "sk-test", model: "claude-x" } });
  });

  it("enables when a stored key is present; disabled flag wins", () => {
    saveConfig({ ai: { apiKey: "sk-file" } });
    let r = resolveAiConfig();
    expect(r.enabled).toBe(true);
    expect(r.apiKey).toBe("sk-file");
    expect(r.source.apiKey).toBe("file");

    saveConfig({ ai: { apiKey: "sk-file", enabled: false } });
    r = resolveAiConfig();
    expect(r.enabled).toBe(false);
  });

  it("is disabled with no key anywhere", () => {
    expect(resolveAiConfig().enabled).toBe(false);
    expect(resolveAiConfig().apiKey).toBeUndefined();
  });

  it("env overrides the file and is reported as the source", () => {
    saveConfig({ ai: { apiKey: "sk-file", baseURL: "https://file", model: "file-model" } });
    process.env.ANTHROPIC_API_KEY = "sk-env";
    process.env.ANTHROPIC_BASE_URL = "https://env";
    process.env.THEMELAB_AI_MODEL = "env-model";
    const r = resolveAiConfig();
    expect(r.apiKey).toBe("sk-env");
    expect(r.baseURL).toBe("https://env");
    expect(r.model).toBe("env-model");
    expect(r.source).toEqual({ apiKey: "env", baseURL: "env", model: "env" });
  });

  it("updateAiConfig merges, and empty string clears a value", () => {
    saveConfig({ ai: { apiKey: "sk-file", baseURL: "https://file" } });
    updateAiConfig({ model: "new-model" });
    expect(loadConfig().ai).toEqual({ apiKey: "sk-file", baseURL: "https://file", model: "new-model" });
    updateAiConfig({ baseURL: "" }); // clear
    expect(loadConfig().ai).toEqual({ apiKey: "sk-file", model: "new-model" });
  });
});
