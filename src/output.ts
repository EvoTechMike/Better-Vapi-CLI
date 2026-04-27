import fs from "node:fs";
import path from "node:path";

import { CliError, EXIT } from "./exit-codes.js";

export interface GlobalFlags {
  json?: boolean;
  plain?: boolean;
  select?: string;
  out?: string;
  dryRun?: boolean;
  noInput?: boolean;
  force?: boolean;
  verbose?: boolean;
}

export interface EmitContext extends GlobalFlags {
  emptyExit?: boolean;
}

export function emit(data: unknown, ctx: EmitContext = {}): void {
  if (ctx.emptyExit && Array.isArray(data) && data.length === 0) {
    if (ctx.out) writeOut(ctx.out, data);
    process.exit(EXIT.EMPTY);
  }

  const projected = ctx.select ? project(data, ctx.select) : data;

  if (ctx.out) {
    const resolved = writeOut(ctx.out, projected);
    process.stdout.write(`${JSON.stringify({ path: resolved })}\n`);
    if (ctx.verbose) process.stderr.write(`wrote ${resolved}\n`);
    return;
  }

  if (ctx.plain) {
    process.stdout.write(toTsv(projected));
    return;
  }

  const isTty = process.stdout.isTTY;
  const json = isTty && !ctx.json ? JSON.stringify(projected, null, 2) : JSON.stringify(projected);
  process.stdout.write(`${json}\n`);
}

function writeOut(target: string, data: unknown): string {
  const resolved = path.resolve(target);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2));
  return resolved;
}

function project(data: unknown, fields: string): unknown {
  const keys = fields.split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return data;
  if (Array.isArray(data)) return data.map((item) => pick(item, keys));
  return pick(data, keys);
}

function pick(item: unknown, keys: string[]): Record<string, unknown> {
  if (item === null || typeof item !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (item as Record<string, unknown>)[k];
  return out;
}

function toTsv(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return "";
    const headers = collectHeaders(data);
    const rows = data.map((row) => headers.map((h) => tsvCell(row, h)).join("\t"));
    return `${headers.join("\t")}\n${rows.join("\n")}\n`;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    return `${Object.entries(obj)
      .filter(([, v]) => v === null || typeof v !== "object")
      .map(([k, v]) => `${k}\t${formatScalar(v)}`)
      .join("\n")}\n`;
  }
  return `${String(data)}\n`;
}

function collectHeaders(rows: unknown[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) {
        const v = (row as Record<string, unknown>)[k];
        if (v === null || typeof v !== "object") seen.add(k);
      }
    }
  }
  return [...seen];
}

function tsvCell(row: unknown, key: string): string {
  if (!row || typeof row !== "object") return "";
  return formatScalar((row as Record<string, unknown>)[key]);
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(/\t/g, " ").replace(/\n/g, " ");
  return String(v);
}

export function readBodyFromFlag(flag: string): unknown {
  const raw = readRaw(flag);
  if (raw.trim().length === 0) {
    throw new CliError(EXIT.USAGE, "Empty input body");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CliError(EXIT.USAGE, `Body is not valid JSON: ${(err as Error).message}`);
  }
}

function readRaw(flag: string): string {
  if (flag === "-") return fs.readFileSync(0, "utf8");
  return fs.readFileSync(flag, "utf8");
}

export function confirmDestructive(message: string, ctx: GlobalFlags): void {
  if (ctx.force) return;
  if (ctx.noInput) {
    throw new CliError(EXIT.USAGE, `Refusing to ${message} without --force in --no-input mode`);
  }
  // commander runs in async context but we don't have a TTY prompt lib;
  // require --force or --yes for destructive operations.
  throw new CliError(
    EXIT.USAGE,
    `Refusing to ${message}. Pass --force (or --yes) to confirm.`,
  );
}
