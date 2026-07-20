// packages/cli/src/config.ts
// Persistent local settings for the AI locator (API key, custom endpoint, model).
// Stored as JSON under the OS config dir; env vars override the file at runtime.
//
// NOTE: the API key is stored in plaintext in a user-only config file — this is a
// local dev tool, same trust model as a shell rc file. Env vars are preferred for
// CI / shared machines.

import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import { logger } from "./logger.js";

export interface AiConfig {
  apiKey?: string;
  /** Custom Anthropic-compatible base URL (gateway/proxy). */
  baseURL?: string;
  /** Override the default model. */
  model?: string;
  /** Explicit on/off. Defaults to "on when an API key is present". */
  enabled?: boolean;
  /** Retry failed locates with a stronger model (tier 2). Defaults to on. */
  escalationEnabled?: boolean;
  /** Override the tier-2 model. */
  escalationModel?: string;
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
  escalationEnabled: boolean;
  escalationModel?: string;
  /** Where each value came from — for the settings UI (never leaks the key). */
  source: {
    apiKey: "env" | "file" | "none";
    baseURL: "env" | "file" | "none";
    model: "env" | "file" | "none";
    escalationModel: "env" | "file" | "none";
  };
}

function valueSource(
  envValue: string | undefined,
  fileValue: string | undefined
): "env" | "file" | "none" {
  if (envValue) {
    return "env";
  }
  if (fileValue) {
    return "file";
  }
  return "none";
}

function configDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
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
  fs.writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  logger.debug(`[config] saved ${configPath()}`);
}

/** Merge a partial AI settings patch into the stored config and persist it. */
export function updateAiConfig(patch: AiConfig): void {
  const cfg = loadConfig();
  // Empty string clears a value.
  cfg.ai = Object.fromEntries(
    Object.entries({ ...cfg.ai, ...patch }).filter(([, v]) => v !== "")
  ) as AiConfig;
  saveConfig(cfg);
}

/** Resolve effective AI settings: env overrides file; enabled implies a key. */
export function resolveAiConfig(): ResolvedAiConfig {
  const file = loadConfig().ai ?? {};
  const envKey = process.env.ANTHROPIC_API_KEY;
  const envBase = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.THEMELAB_AI_MODEL;
  const envEscModel = process.env.THEMELAB_AI_MODEL_ESCALATED;
  const envEscalation = process.env.THEMELAB_AI_ESCALATION;

  const apiKey = envKey || file.apiKey;
  const baseURL = envBase || file.baseURL;
  const model = envModel || file.model;
  const enabled = (file.enabled ?? true) && !!apiKey;
  // THEMELAB_AI_ESCALATION=0/false disables the tier-2 retry; default on.
  const escalationEnabled =
    envEscalation === undefined
      ? (file.escalationEnabled ?? true)
      : !["0", "false", "off"].includes(envEscalation.toLowerCase());
  const escalationModel = envEscModel || file.escalationModel;

  return {
    apiKey,
    baseURL,
    model,
    enabled,
    escalationEnabled,
    escalationModel,
    source: {
      apiKey: valueSource(envKey, file.apiKey),
      baseURL: valueSource(envBase, file.baseURL),
      model: valueSource(envModel, file.model),
      escalationModel: valueSource(envEscModel, file.escalationModel),
    },
  };
}
