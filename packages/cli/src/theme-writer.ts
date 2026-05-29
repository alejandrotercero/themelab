// packages/cli/src/theme-writer.ts
// Writes design-token edits back into a project's theme CSS file by upserting
// CSS custom properties inside a given selector block (`:root`, `.dark`, …).
// Inverse of theme-resolver.ts. Preserves all surrounding CSS, ordering, and
// indentation; only the edited declarations change.

import * as fs from "node:fs";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Upsert `vars` (name without leading `--` → value) into the first flat
 * `selector { ... }` block in `css`. Existing declarations are replaced in
 * place; missing ones are appended to the block. If the block doesn't exist it
 * is created at the end of the file. Returns the updated CSS (unchanged input
 * is returned as-is when there's nothing to do).
 */
export function upsertCssVars(
  css: string,
  selector: string,
  vars: Record<string, string>,
): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) return css;

  const blockRe = new RegExp(`(${escapeRegExp(selector)}\\s*\\{)([^{}]*)(\\})`);
  const match = blockRe.exec(css);

  if (!match) {
    // No such block — create one. Match the indentation of the file loosely.
    const decls = entries.map(([k, v]) => `  --${k}: ${v};`).join("\n");
    const block = `\n${selector} {\n${decls}\n}\n`;
    return css.endsWith("\n") ? css + block.slice(1) : css + block;
  }

  const [, open, body, close] = match;
  let newBody = body;

  // Detect the indentation used by existing declarations in the block.
  const indentMatch = body.match(/\n([ \t]+)--/);
  const indent = indentMatch ? indentMatch[1] : "  ";

  for (const [name, value] of entries) {
    const declRe = new RegExp(`(--${escapeRegExp(name)}\\s*:\\s*)([^;]*)(;)`);
    if (declRe.test(newBody)) {
      newBody = newBody.replace(declRe, `$1${value}$3`);
    } else {
      // Append before the block's trailing whitespace.
      const trailing = newBody.match(/(\s*)$/)?.[1] ?? "";
      const core = newBody.slice(0, newBody.length - trailing.length);
      newBody = `${core}\n${indent}--${name}: ${value};${trailing}`;
    }
  }

  return css.slice(0, match.index) + open + newBody + close + css.slice(match.index + match[0].length);
}

export interface ThemeVarEdit {
  /** Literal CSS selector whose block to edit (":root", ".dark", "[data-theme=\"dark\"]"). */
  selector: string;
  /** Custom properties to upsert (name without leading `--` → value). */
  vars: Record<string, string>;
}

export interface ThemeWriteResult {
  success: boolean;
  /** File content before the write (for undo). */
  before?: string;
  after?: string;
  error?: string;
}

/**
 * Apply theme-var edits to a CSS file on disk. Reads once, applies every edit,
 * writes once. Returns before/after content for undo. Does not write when the
 * content is unchanged.
 */
export function writeThemeVars(filePath: string, edits: ThemeVarEdit[]): ThemeWriteResult {
  let before: string;
  try {
    before = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { success: false, error: `Could not read theme file: ${err instanceof Error ? err.message : String(err)}` };
  }

  let after = before;
  for (const edit of edits) {
    after = upsertCssVars(after, edit.selector, edit.vars);
  }

  if (after === before) {
    return { success: true, before, after };
  }

  try {
    fs.writeFileSync(filePath, after, "utf-8");
  } catch (err) {
    return { success: false, error: `Could not write theme file: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { success: true, before, after };
}
