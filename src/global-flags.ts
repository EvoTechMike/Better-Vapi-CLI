import { Command, Option } from "commander";

/**
 * Commander only matches options at the level they are declared. To let users
 * type `vapi <cmd> --json --out path`, every leaf command has to repeat the
 * global flag set. Calling this on a subcommand keeps that ergonomic without
 * forcing parent-first ordering.
 */
export function addGlobalFlags(cmd: Command): Command {
  for (const opt of GLOBAL_OPTIONS) cmd.addOption(opt());
  return cmd;
}

const GLOBAL_OPTIONS: (() => Option)[] = [
  () => new Option("-j, --json", "Force JSON output (default when stdout is piped)"),
  () => new Option("-p, --plain", "Tab-separated output (top-level scalars only)"),
  () => new Option("--select <fields>", "Comma-separated list of top-level fields to keep"),
  () => new Option("--fields <fields>", "Alias for --select").hideHelp(),
  () =>
    new Option("--out <path>", 'Write JSON to <path>; print {"path":...} to stdout'),
  () => new Option("-n, --dry-run", "Print the planned request and exit without calling the API"),
  () => new Option("--no-input", "Never prompt; fail if input is required"),
  () => new Option("--force", "Skip destructive-action confirmation"),
  () => new Option("--yes", "Alias for --force").hideHelp(),
  () => new Option("-v, --verbose", "Verbose progress to stderr"),
];
