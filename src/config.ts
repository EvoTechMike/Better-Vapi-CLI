import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CliError, EXIT } from "./exit-codes.js";

export interface Credentials {
  apiKey: string;
  orgId?: string;
}

export interface ResolvedAuth {
  apiKey: string;
  orgId?: string;
  source: "env" | "file";
}

export function configDir(): string {
  if (process.env.VAPI_CONFIG_DIR) return process.env.VAPI_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "vapi-cli");
}

export function credentialsPath(): string {
  return path.join(configDir(), "credentials.json");
}

export function baseUrl(): string {
  return process.env.VAPI_BASE_URL || "https://api.vapi.ai";
}

export function loadCredentials(): Credentials | null {
  const file = credentialsPath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    if (!parsed.apiKey || typeof parsed.apiKey !== "string") return null;
    return { apiKey: parsed.apiKey, orgId: parsed.orgId };
  } catch (err) {
    throw new CliError(
      EXIT.CONFIG,
      `Failed to read ${file}: ${(err as Error).message}`,
    );
  }
}

export function saveCredentials(creds: Credentials): string {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = credentialsPath();
  fs.writeFileSync(file, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

export function deleteCredentials(): boolean {
  const file = credentialsPath();
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function resolveAuth(): ResolvedAuth {
  const envKey = process.env.VAPI_API_KEY;
  if (envKey && envKey.length > 0) {
    return { apiKey: envKey, orgId: process.env.VAPI_ORG_ID, source: "env" };
  }
  const file = loadCredentials();
  if (file) return { apiKey: file.apiKey, orgId: file.orgId, source: "file" };
  throw new CliError(
    EXIT.AUTH,
    "No Vapi API key configured. Set VAPI_API_KEY or run `vapi auth login`.",
  );
}

export function redactKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
