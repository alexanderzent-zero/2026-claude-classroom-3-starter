import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SERVER_URL = "http://localhost:3000";

/** Overridable so the integration test can point the CLI at its own server. */
export function serverUrl(): string {
  return process.env.AI_TUTOR_SERVER_URL?.trim() || DEFAULT_SERVER_URL;
}

/**
 * The user's config directory, the way `gh` picks one: `$XDG_CONFIG_HOME` when
 * set, else `~/.config`. `AI_TUTOR_CONFIG_DIR` overrides it outright — the
 * integration test uses that to keep a real login off the developer's machine.
 */
function configDir(): string {
  const override = process.env.AI_TUTOR_CONFIG_DIR;
  if (override) {
    return override;
  }
  const base =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "ai-tutor");
}

function configFile(): string {
  return join(configDir(), "config.json");
}

type StoredConfig = { token: string; serverUrl: string };

/** Never printed and never committed — a file only its owner can read. */
export function saveToken(token: string): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const config: StoredConfig = { token, serverUrl: serverUrl() };
  writeFileSync(configFile(), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function loadToken(): string | null {
  try {
    const raw = readFileSync(configFile(), "utf8");
    return (JSON.parse(raw) as StoredConfig).token;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  try {
    rmSync(configFile());
  } catch {
    // Nothing to remove — logout is idempotent.
  }
}
