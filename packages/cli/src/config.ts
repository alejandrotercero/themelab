// packages/cli/src/config.ts
// Persistent local settings for the AI locator (API key, custom endpoint, model).
// Stored as JSON under the OS config dir; env vars override the file at runtime.
//
// NOTE: the API key is stored in plaintext in a user-only config file — this is a
// local dev tool, same trust model as a shell rc file. Env vars are preferred for
// CI / shared machines.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "./logger.js";

export interface AiConfig {
  apiKey?: string;
  /** Custom Anthropic-compatible base URL (gateway/proxy). */
  baseURL?: string;
  /** Override the default model. */
  model?: string;
  /** Explicit on/off. Defaults to "on when an API key is present". */
  enabled?: boolean;
}

export interface AppConfig {
  ai?: AiConfig;
}

/** Effective settings after merging file + env, ready to hand to the locator. */
export interface ResolvedAiConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  enabled: boolean;
  /** Where each value came from — for the settings UI (never leaks the key). */
  source: { apiKey: "env" | "file" | "none"; baseURL: "env" | "file" | "none"; model: "env" | "file" | "none" };
}

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "themelab");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf-8")) as AppConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: AppConfig): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  logger.debug(`[config] saved ${configPath()}`);
}

/** Merge a partial AI settings patch into the stored config and persist it. */
export function updateAiConfig(patch: AiConfig): void {
  const cfg = loadConfig();
  cfg.ai = { ...(cfg.ai ?? {}), ...patch };
  // Empty string clears a value.
  for (const k of ["apiKey", "baseURL", "model"] as const) {
    if (cfg.ai[k] === "") delete cfg.ai[k];
  }
  saveConfig(cfg);
}

/** Resolve effective AI settings: env overrides file; enabled implies a key. */
export function resolveAiConfig(): ResolvedAiConfig {
  const file = loadConfig().ai ?? {};
  const envKey = process.env.ANTHROPIC_API_KEY;
  const envBase = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.THEMELAB_AI_MODEL;

  const apiKey = envKey || file.apiKey;
  const baseURL = envBase || file.baseURL;
  const model = envModel || file.model;
  const enabled = (file.enabled ?? true) && !!apiKey;

  return {
    apiKey,
    baseURL,
    model,
    enabled,
    source: {
      apiKey: envKey ? "env" : file.apiKey ? "file" : "none",
      baseURL: envBase ? "env" : file.baseURL ? "file" : "none",
      model: envModel ? "env" : file.model ? "file" : "none",
    },
  };
}
