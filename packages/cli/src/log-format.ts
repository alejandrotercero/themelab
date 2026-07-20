// packages/cli/src/log-format.ts
// Pretty, branded formatting for batch-commit logs.
import chalk from "chalk";

import { logger } from "./logger.js";

const BRAND = "#ec003f";

// Map internal op names to short, human verbs shown in the log tree.
const OP_LABELS: Record<string, string> = {
  updateClass: "style",
  updateProperty: "style",
  updateText: "text",
  reorder: "reorder",
  moveSibling: "move",
  deleteElement: "delete",
  duplicateElement: "dup",
  insertElement: "insert",
};

function opLabel(op: string): string {
  return OP_LABELS[op] ?? op;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Drop the project-root prefix and the meaningless ":0" the overlay sends when a
// line is resolved fuzzily server-side rather than from a known source line.
function loc(file: string, line: number | undefined): string {
  const short = file.replace(/^.*?\/src\//, "src/");
  const suffix =
    typeof line === "number" && line > 0 ? chalk.dim(`:${line}`) : "";
  return chalk.white(short) + suffix;
}

interface OpLike {
  op: string;
  file: string;
  line?: number;
  fromLine?: number;
}
interface ResultLike {
  op: string;
  file: string;
  line?: number;
  success: boolean;
  error?: string;
}

function lineOf(o: OpLike): number | undefined {
  return o.op === "reorder" ? o.fromLine : o.line;
}

/** Header + per-op tree for an incoming batch. */
export function logBatchStart(ops: OpLike[]): void {
  const n = ops.length;
  logger.info(
    `\n${chalk.hex(BRAND)("  ◆ ")}${chalk.bold(
      "commit"
    )}${chalk.dim(` · ${plural(n, "change")}`)}`
  );
  for (const [i, o] of ops.entries()) {
    const branch = i === ops.length - 1 ? "└" : "├";
    logger.info(
      chalk.dim(`    ${branch} `) +
        chalk.hex(BRAND)(opLabel(o.op).padEnd(8)) +
        loc(o.file, lineOf(o))
    );
  }
}

/** Footer summarising success/failure of a committed batch. */
export function logBatchResult(results: ResultLike[]): void {
  const failed = results.filter((r) => !r.success);
  const ok = results.length - failed.length;
  if (failed.length === 0) {
    logger.info(
      `${chalk.green("  ✓ ") + chalk.dim(`${plural(ok, "change")} applied`)}\n`
    );
    return;
  }
  logger.error(
    chalk.red(`  ✗ ${plural(failed.length, "change")} failed`) +
      (ok > 0 ? chalk.dim(`, ${ok} applied`) : "")
  );
  for (const [i, r] of failed.entries()) {
    const branch = i === failed.length - 1 ? "└" : "├";
    logger.error(
      chalk.dim(`    ${branch} `) +
        loc(r.file, r.line) +
        chalk.red(` — ${r.error ?? "unknown error"}`)
    );
  }
  logger.error("");
}

/** A thrown exception during a batch commit. */
export function logBatchException(err: unknown): void {
  logger.error(
    `${
      chalk.red("  ✗ commit failed — ") +
      (err instanceof Error ? err.message : String(err))
    }\n`
  );
}
