import { Command } from "commander";

import {
  baseUrl,
  credentialsPath,
  deleteCredentials,
  loadCredentials,
  redactKey,
  resolveAuth,
  saveCredentials,
} from "../config.js";
import { CliError, EXIT } from "../exit-codes.js";
import { addGlobalFlags } from "../global-flags.js";
import { vapiFetch } from "../http.js";
import { emit, type GlobalFlags } from "../output.js";
import fs from "node:fs";

export function buildAuthCommand(): Command {
  const cmd = new Command("auth").description("Manage Vapi credentials");

  addGlobalFlags(cmd.command("login"))
    .description("Save a Vapi private API key to ~/.config/bvapi/credentials.json")
    .option("--key <key>", "API key (else read from stdin)")
    .option("--org-id <id>", "Optional Vapi organization ID")
    .action(async (opts: { key?: string; orgId?: string }, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags & { key?: string; orgId?: string }>();
      const key = await resolveKey(opts.key, globals.noInput ?? false);
      await assertKeyWorks(key);
      const file = saveCredentials({ apiKey: key, orgId: opts.orgId });
      emit(
        {
          authenticated: true,
          path: file,
          keyPreview: redactKey(key),
          orgId: opts.orgId ?? null,
        },
        globals,
      );
    });

  addGlobalFlags(cmd.command("status"))
    .description("Show current credential source and verify the key works")
    .action(async (_opts, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags>();
      let auth;
      try {
        auth = resolveAuth();
      } catch (err) {
        if (err instanceof CliError) {
          emit(
            {
              authenticated: false,
              source: null,
              keyPreview: null,
              path: credentialsPath(),
              baseUrl: baseUrl(),
              error: err.message,
            },
            globals,
          );
          process.exit(err.code);
        }
        throw err;
      }
      let ok = true;
      let error: string | undefined;
      try {
        await vapiFetch("GET", "/assistant", { apiKey: auth.apiKey, query: { limit: 1 } });
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
      }
      emit(
        {
          authenticated: ok,
          source: auth.source,
          keyPreview: redactKey(auth.apiKey),
          orgId: auth.orgId ?? null,
          path: credentialsPath(),
          baseUrl: baseUrl(),
          ...(error ? { error } : {}),
        },
        globals,
      );
      if (!ok) process.exit(EXIT.AUTH);
    });

  addGlobalFlags(cmd.command("logout"))
    .description("Remove the stored credentials file (does not affect VAPI_API_KEY env)")
    .action((_opts, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags>();
      const removed = deleteCredentials();
      emit({ removed, path: credentialsPath() }, globals);
    });

  return cmd;
}

async function resolveKey(flag: string | undefined, noInput: boolean): Promise<string> {
  if (flag && flag.length > 0) return flag.trim();
  if (process.env.VAPI_API_KEY && process.env.VAPI_API_KEY.length > 0) {
    return process.env.VAPI_API_KEY;
  }
  const existing = loadCredentials();
  if (existing) return existing.apiKey;
  if (noInput) {
    throw new CliError(EXIT.USAGE, "No --key provided and --no-input set");
  }
  if (!process.stdin.isTTY) {
    const buf = fs.readFileSync(0, "utf8").trim();
    if (buf.length === 0) throw new CliError(EXIT.USAGE, "Empty key on stdin");
    return buf;
  }
  throw new CliError(
    EXIT.USAGE,
    "Pass --key <key>, set VAPI_API_KEY, or pipe the key on stdin.",
  );
}

async function assertKeyWorks(key: string): Promise<void> {
  try {
    await vapiFetch("GET", "/assistant", { apiKey: key, query: { limit: 1 } });
  } catch (err) {
    if (err instanceof CliError && err.code === EXIT.AUTH) {
      throw new CliError(EXIT.AUTH, `Key validation failed: ${err.message}`);
    }
    throw err;
  }
}
