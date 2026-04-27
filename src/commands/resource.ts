import { Command, Option } from "commander";

import { resolveAuth } from "../config.js";
import { CliError, EXIT } from "../exit-codes.js";
import { addGlobalFlags } from "../global-flags.js";
import { planRequest, vapiFetch } from "../http.js";
import { confirmDestructive, emit, readBodyFromFlag, type GlobalFlags } from "../output.js";

export interface ResourceConfig {
  /** Command name, e.g. "assistant" */
  name: string;
  /** Resource path segment in the Vapi API, e.g. "assistant" or "squad" */
  apiPath: string;
  /** Human description for the parent command */
  description: string;
  /** Query params accepted by `list`, registered as flags */
  listQueryFlags?: { flag: string; description: string }[];
}

interface ListOpts {
  limit?: string;
  [key: string]: string | undefined;
}

interface FileOpts {
  file?: string;
}

export function buildResourceCommand(cfg: ResourceConfig): Command {
  const root = new Command(cfg.name).description(cfg.description);

  const list = addGlobalFlags(root.command("list"))
    .description(`List ${cfg.name}s (GET /${cfg.apiPath}). Returns an array.`)
    .option("-l, --limit <n>", "Maximum number of records to return")
    .option("--created-at-gt <iso>", "Created after (ISO 8601)")
    .option("--created-at-lt <iso>", "Created before (ISO 8601)")
    .option("--updated-at-gt <iso>", "Updated after (ISO 8601)")
    .option("--updated-at-lt <iso>", "Updated before (ISO 8601)")
    .action(async (opts: ListOpts, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags & ListOpts>();
      const query = filterQuery({
        limit: opts.limit,
        createdAtGt: globals["createdAtGt"],
        createdAtLt: globals["createdAtLt"],
        updatedAtGt: globals["updatedAtGt"],
        updatedAtLt: globals["updatedAtLt"],
      });
      if (globals.dryRun) {
        emit(planRequest("GET", `/${cfg.apiPath}`, { query }), globals);
        return;
      }
      const auth = resolveAuth();
      const data = await vapiFetch<unknown[]>("GET", `/${cfg.apiPath}`, {
        apiKey: auth.apiKey,
        query,
      });
      emit(data, { ...globals, emptyExit: true });
    });

  for (const extra of cfg.listQueryFlags ?? []) {
    list.addOption(new Option(extra.flag, extra.description));
  }

  addGlobalFlags(root.command("get"))
    .argument("<id>", `${cfg.name} id`)
    .description(`Fetch ${cfg.name} by id (GET /${cfg.apiPath}/{id})`)
    .action(async (id: string, _opts: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags>();
      if (globals.dryRun) {
        emit(planRequest("GET", `/${cfg.apiPath}/${encodeURIComponent(id)}`, {}), globals);
        return;
      }
      const auth = resolveAuth();
      const data = await vapiFetch("GET", `/${cfg.apiPath}/${encodeURIComponent(id)}`, {
        apiKey: auth.apiKey,
      });
      emit(data, globals);
    });

  addGlobalFlags(root.command("create"))
    .description(`Create ${cfg.name} (POST /${cfg.apiPath}). Body via -f <file|->`)
    .requiredOption("-f, --file <path>", "JSON body file (use - for stdin)")
    .action(async (opts: FileOpts, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags>();
      if (!opts.file) throw new CliError(EXIT.USAGE, "--file is required");
      const body = readBodyFromFlag(opts.file);
      if (globals.dryRun) {
        emit(planRequest("POST", `/${cfg.apiPath}`, { body }), globals);
        return;
      }
      const auth = resolveAuth();
      const data = await vapiFetch("POST", `/${cfg.apiPath}`, { apiKey: auth.apiKey, body });
      emit(data, globals);
    });

  addGlobalFlags(root.command("update"))
    .argument("<id>", `${cfg.name} id`)
    .description(`Patch ${cfg.name} by id (PATCH /${cfg.apiPath}/{id}). Body via -f <file|->`)
    .requiredOption("-f, --file <path>", "JSON body file (use - for stdin)")
    .action(async (id: string, opts: FileOpts, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags>();
      if (!opts.file) throw new CliError(EXIT.USAGE, "--file is required");
      const body = readBodyFromFlag(opts.file);
      if (globals.dryRun) {
        emit(planRequest("PATCH", `/${cfg.apiPath}/${encodeURIComponent(id)}`, { body }), globals);
        return;
      }
      const auth = resolveAuth();
      const data = await vapiFetch("PATCH", `/${cfg.apiPath}/${encodeURIComponent(id)}`, {
        apiKey: auth.apiKey,
        body,
      });
      emit(data, globals);
    });

  addGlobalFlags(root.command("delete"))
    .argument("<id>", `${cfg.name} id`)
    .description(`Delete ${cfg.name} by id (DELETE /${cfg.apiPath}/{id})`)
    .action(async (id: string, _opts: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags>();
      if (!globals.dryRun) confirmDestructive(`delete ${cfg.name} ${id}`, globals);
      if (globals.dryRun) {
        emit(planRequest("DELETE", `/${cfg.apiPath}/${encodeURIComponent(id)}`, {}), globals);
        return;
      }
      const auth = resolveAuth();
      const data = await vapiFetch("DELETE", `/${cfg.apiPath}/${encodeURIComponent(id)}`, {
        apiKey: auth.apiKey,
      });
      emit(data, globals);
    });

  return root;
}

function filterQuery(
  q: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}
