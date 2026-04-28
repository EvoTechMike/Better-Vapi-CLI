import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";

import { resolveAuth } from "../config.js";
import { CliError, EXIT } from "../exit-codes.js";
import { addGlobalFlags } from "../global-flags.js";
import { planUpload, vapiUpload } from "../http.js";
import { emit, type GlobalFlags } from "../output.js";
import { buildResourceCommand } from "./resource.js";

export function buildFileCommand(): Command {
  const root = buildResourceCommand({
    name: "file",
    apiPath: "file",
    description:
      "Manage Vapi files (knowledge-base sources: pdf, txt, md, docx, csv, json, ...)",
    skipCreate: true,
  });

  addGlobalFlags(root.command("create"))
    .description("Upload a file (POST /file, multipart). Returns the File with its id.")
    .requiredOption("-f, --file <path>", "Local path to the file to upload")
    .action(async (opts: { file?: string }, command: Command) => {
      const globals = command.optsWithGlobals<GlobalFlags>();
      if (!opts.file) throw new CliError(EXIT.USAGE, "--file is required");
      const resolved = path.resolve(opts.file);
      if (!fs.existsSync(resolved)) {
        throw new CliError(EXIT.USAGE, `File not found: ${resolved}`);
      }
      const stat = fs.statSync(resolved);
      const name = path.basename(resolved);

      if (globals.dryRun) {
        emit(
          planUpload("POST", "/file", {
            fields: { file: `@${resolved}`, name, bytes: stat.size },
          }),
          globals,
        );
        return;
      }

      const buf = fs.readFileSync(resolved);
      const form = new FormData();
      form.append("file", new Blob([buf]), name);

      const auth = resolveAuth();
      const data = await vapiUpload("POST", "/file", {
        apiKey: auth.apiKey,
        formData: form,
      });
      emit(data, globals);
    });

  return root;
}
