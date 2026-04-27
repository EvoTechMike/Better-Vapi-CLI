import { Command } from "commander";

import { buildAssistantCommand } from "./commands/assistant.js";
import { buildAuthCommand } from "./commands/auth.js";
import { buildCallCommand } from "./commands/call.js";
import { buildPhoneNumberCommand } from "./commands/phone-number.js";
import { buildSquadCommand } from "./commands/squad.js";
import { CliError, EXIT, EXIT_DESCRIPTIONS } from "./exit-codes.js";
import { addGlobalFlags } from "./global-flags.js";
import { emit, type GlobalFlags } from "./output.js";
import { findSubcommand, serializeCommand } from "./schema.js";

const VERSION = "0.1.0";

function buildProgram(): Command {
  const program = new Command();

  program
    .name("bvapi")
    .description(
      "CLI for Vapi voice AI. Pipe JSON to jq, redirect to disk for large payloads.",
    )
    .version(VERSION)
    .showHelpAfterError();

  // Normalize alias flags (--fields, --yes) into canonical names so command
  // actions only have to read --select/--force.
  program.hook("preAction", (_thisCmd, actionCmd) => {
    const o = actionCmd.opts() as Record<string, unknown>;
    if (o.fields && !o.select) actionCmd.setOptionValueWithSource("select", o.fields, "cli");
    if (o.yes && !o.force) actionCmd.setOptionValueWithSource("force", true, "cli");
  });

  program.addCommand(buildAuthCommand());
  program.addCommand(buildAssistantCommand());
  program.addCommand(buildSquadCommand());
  program.addCommand(buildCallCommand());
  program.addCommand(buildPhoneNumberCommand());

  addGlobalFlags(program.command("schema [path...]"))
    .description(
      "Print the CLI command tree as JSON. Optional path narrows to a subcommand, e.g. `bvapi schema assistant get`.",
    )
    .action((parts: string[], _opts, command: Command) => {
      const globals = command.opts<GlobalFlags>();
      const target = parts.length === 0 ? program : findSubcommand(program, parts);
      if (!target) throw new CliError(EXIT.NOT_FOUND, `No such command: ${parts.join(" ")}`);
      emit(serializeCommand(target), globals);
    });

  addGlobalFlags(program.command("exit-codes"))
    .description("Print the CLI exit-code map as JSON.")
    .action((_opts, command: Command) => {
      const globals = command.opts<GlobalFlags>();
      const map: Record<string, { code: number; description: string }> = {};
      for (const [k, v] of Object.entries(EXIT)) {
        map[k] = { code: v, description: EXIT_DESCRIPTIONS[v] };
      }
      emit(map, globals);
    });

  return program;
}

export async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

export function handleError(err: unknown): never {
  if (err instanceof CliError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(err.code);
  }
  if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "commander.help") {
    process.exit(EXIT.OK);
  }
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("commander.")) {
      const msg = (err as { message?: unknown }).message;
      process.stderr.write(`${typeof msg === "string" ? msg : String(err)}\n`);
      process.exit(EXIT.USAGE);
    }
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT.ERR);
}

export { buildProgram };
