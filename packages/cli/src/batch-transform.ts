// packages/cli/src/batch-transform.ts
// Batch transform engine — groups operations by file, resolves nodes against
// the original AST, applies all mutations atomically (parse once, write once).

import * as fs from "node:fs";
import path from "node:path";

import type { BatchOperation } from "@themelab/shared";
import type { Collection, JSCodeshift } from "jscodeshift";

import type { AstNode, AstPath } from "./jsx-path-resolver.js";
import { resolveJSXPath } from "./jsx-path-resolver.js";
import { logger } from "./logger.js";
import { applyMdxTextEdit, isMdxTextFile } from "./mdx-text.js";
import {
  resolveProjectFilePath,
  isProjectFilePathSafe,
} from "./path-resolver.js";
import type { ClassNameUpdate } from "./transform.js";
import {
  parseSource,
  findJSXElementAt,
  findJSXElementAtLine,
  mutateClassName,
  mutateClassNameReplace,
  mutateTextContent,
  mutateReorder,
  swapWithAdjacentSibling,
  swapArrayElementAt,
} from "./transform.js";

/**
 * Find an .mdx/.md file that is imported by `jsxFilePath` AND contains `text`.
 *
 * Used as a fallback when a text edit targets a JSX wrapper but the actual
 * content lives in a compiled MDX file (e.g. `import Post from "./post.mdx"`).
 *
 * IMPORTANT: this is scoped to files the clicked component actually references.
 * A previous version searched the entire project for any markdown containing the
 * text and edited the first match, which silently corrupted unrelated docs (e.g.
 * a README) whenever a normal text edit failed to resolve. The import linkage is
 * the safety property: we only ever touch markdown the component imports.
 */
function findImportedMdxFileContainingText(
  jsxFilePath: string,
  text: string,
  projectRoot: string
): string | null {
  const normalizedText = text.replaceAll(/\s+/g, " ").trim();
  if (!normalizedText) {
    return null;
  }

  let source: string;
  try {
    source = fs.readFileSync(jsxFilePath, "utf-8");
  } catch {
    return null;
  }

  // Collect import/require/dynamic-import specifiers that point at .md/.mdx.
  // Scoped to this file only — never a project-wide scan.
  const specifierRegex =
    /(?:import\s[^'"]*?|import\s*\(\s*|require\s*\(\s*|from\s+)['"](?<spec>[^'"]+\.mdx?)['"]/g;
  const baseDir = path.dirname(jsxFilePath);
  const seen = new Set<string>();
  const candidates: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = specifierRegex.exec(source)) !== null) {
    const spec = match.groups?.spec ?? "";
    const resolvedCandidates: string[] = [];
    if (spec.startsWith(".")) {
      resolvedCandidates.push(path.resolve(baseDir, spec));
    } else if (spec.startsWith("@/")) {
      // Common Next/Vite alias: @/ → <root>/src or <root>
      resolvedCandidates.push(
        path.resolve(projectRoot, "src", spec.slice(2)),
        path.resolve(projectRoot, spec.slice(2))
      );
    } else if (spec.startsWith("/")) {
      resolvedCandidates.push(path.resolve(projectRoot, spec.slice(1)));
    }
    for (const candidate of resolvedCandidates) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        candidates.push(candidate);
      }
    }
  }

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const normalizedContent = content.replaceAll(/\s+/g, " ");
      if (normalizedContent.includes(normalizedText)) {
        return filePath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** Get the primary line number from any BatchOperation variant. */
function getOpLine(op: BatchOperation): number {
  return op.op === "reorder" ? op.fromLine : op.line;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface BatchResult {
  /** Per-operation results in the same order as the input operations. */
  results: OperationResult[];
  /** Aggregated: all successful undo entries keyed by file. */
  undoEntries: {
    filePath: string;
    content: string;
    afterContent: string;
  }[];
}

export interface ExecuteBatchOptions {
  /**
   * Keep the existing CLI behavior by default. Desktop passes false to resolve
   * and serialize source changes without mutating the workspace.
   */
  write?: boolean;
}

export interface OperationResult {
  op: BatchOperation["op"];
  file: string;
  line: number;
  success: boolean;
  error?: string;
  /** Contender locations for a failed resolution — seed hints for the AI locator.
   *  Only present on AMBIGUOUS / no-match failures. */
  candidates?: { line: number; col: number; snippet: string }[];
  /** Provenance: set when the AI locator resolved this op. */
  resolvedBy?: "ai";
  /** AI resolution metadata (kind of routing + the model's short rationale). */
  aiKind?: string;
  aiReasoning?: string;
}

// ── Internal types ───────────────────────────────────────────────────────

interface ResolvedOp {
  /** Index into the original operations array. */
  index: number;
  op: BatchOperation;
  /** Resolved AST node reference (null if resolution failed). */
  node: AstPath | null;
  /** Execution priority: 0 = non-structural, 1 = structural. */
  priority: number;
  /** Error from resolution phase. */
  error?: string;
  /** Contender jscodeshift paths when resolution failed (ambiguous / no-match) —
   *  seed hints for the AI locator. Only populated on the cold failure path. */
  ambiguousCandidates?: AstPath[];
}

// ── Node resolution helpers ──────────────────────────────────────────────

/** Read the string name off a node's `name` field (string or nested identifier node). */
function nodeName(n: AstNode | string | null | undefined): string | null {
  if (typeof n === "string") {
    return n;
  }
  if (n && typeof n.name === "string") {
    return n.name;
  }
  return null;
}

function getJSXTagName(node: AstNode): string | null {
  const name = node.openingElement?.name;
  if (!name) {
    return null;
  }
  if (name.type === "JSXIdentifier") {
    return nodeName(name);
  }
  if (name.type === "JSXMemberExpression") {
    return `${nodeName(name.object) ?? ""}.${nodeName(name.property) ?? ""}`;
  }
  return null;
}

/**
 * Check if an AST tag name matches a DOM tag name.
 * Handles motion.div → div, Styled.button → button, etc.
 */
function tagNameMatches(astTag: string, domTag: string): boolean {
  if (astTag.toLowerCase() === domTag.toLowerCase()) {
    return true;
  }
  if (astTag.includes(".")) {
    const suffix = astTag.split(".").at(-1) ?? astTag;
    if (suffix.toLowerCase() === domTag.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Common identity-carrying fields shared by (most) {@link BatchOperation}
 * variants. Used to type identity-verification helpers precisely without
 * threading the full operation union (and its op-specific fields) through
 * code that only ever reads these four.
 */
interface IdentityCandidateOp {
  tagName?: string;
  componentName?: string;
  id?: string;
  className?: string;
}

/**
 * Match an AST tag against the op's DOM `tagName`, OR — when the clicked DOM node
 * is a host element rendered by a user component — against the owning
 * `componentName`. shadcn primitives are the canonical case: `<TabsTrigger>` in
 * source renders a host `<button>` in the DOM, so the overlay sends
 * tagName="button" while the JSX the user wants to edit is `<TabsTrigger>`.
 *
 * The component bridge only fires when the AST tag is itself a component
 * (capitalized identifier or `Foo.Bar` member). For ordinary host elements the
 * componentName is the *containing* function (e.g. `AppHeader`), whose own JSX
 * usage lives in another file — so this won't spuriously match host tags.
 */
function tagOrComponentMatches(
  astTag: string,
  op: IdentityCandidateOp
): boolean {
  const domTag = "tagName" in op ? op.tagName : undefined;
  if (domTag && tagNameMatches(astTag, domTag)) {
    return true;
  }

  const componentName = "componentName" in op ? op.componentName : undefined;
  if (!componentName) {
    return false;
  }
  const astBase = astTag.split(".").pop() ?? astTag;
  const astIsComponent = /^[A-Z]/.test(astBase);
  return astIsComponent && tagNameMatches(astTag, componentName);
}

/** Split a raw class string into non-empty whitespace-separated tokens. */
function splitClassTokens(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Find a named JSXAttribute on an opening element's attribute list. */
function findJSXAttribute(
  node: AstNode,
  attrName: string
): AstNode | undefined {
  const attrs = node.openingElement?.attributes ?? [];
  return attrs.find(
    (a) => a.type === "JSXAttribute" && nodeName(a.name) === attrName
  );
}

/** Extract static classes from a JSX element's className attribute. */
function getJSXStaticClasses(node: AstNode): string[] {
  const val = findJSXAttribute(node, "className")?.value as AstNode | undefined;
  if (!val) {
    return [];
  }
  // Handle both StringLiteral (tsx parser) and Literal (babel parser)
  if (val.type === "StringLiteral" || val.type === "Literal") {
    return splitClassTokens(val.value);
  }
  // JSXExpressionContainer — extract static parts from template literals and cn()/clsx() calls
  if (val.type === "JSXExpressionContainer") {
    const expr = val.expression;
    // Template literal: className={`flex gap-4 ${dynamic}`} — extract from quasis
    if (expr?.type === "TemplateLiteral") {
      const classes: string[] = [];
      for (const quasi of expr.quasis ?? []) {
        const raw = (quasi.value as { raw?: string } | undefined)?.raw ?? "";
        classes.push(...splitClassTokens(raw));
      }
      return classes;
    }
    // Call expression: className={cn("flex gap-4", ...)} — extract from string args
    if (expr?.type === "CallExpression") {
      const classes: string[] = [];
      for (const arg of expr.arguments ?? []) {
        if (arg.type === "StringLiteral" || arg.type === "Literal") {
          classes.push(...splitClassTokens(arg.value));
        }
      }
      return classes;
    }
  }
  return [];
}

/** Get the id attribute from a JSX element. */
function getJSXId(node: AstNode): string | null {
  const val = findJSXAttribute(node, "id")?.value as AstNode | undefined;
  if (!val) {
    return null;
  }
  if (val.type === "StringLiteral" || val.type === "Literal") {
    return typeof val.value === "string" ? val.value : null;
  }
  return null;
}

/** Get the key prop from a JSX element. */
function getJSXKey(node: AstNode): string | null {
  const val = findJSXAttribute(node, "key")?.value as AstNode | undefined;
  if (!val) {
    return null;
  }
  if (val.type === "StringLiteral" || val.type === "Literal") {
    return typeof val.value === "string" ? val.value : null;
  }
  return null;
}

/** Check if AST static classes are a subset of the DOM classes provided. */
function classNameSubsetMatch(
  astClasses: string[],
  domClassName: string
): boolean {
  if (astClasses.length === 0) {
    return false;
  }
  const domClasses = new Set(domClassName.split(/\s+/).filter(Boolean));
  // All AST classes should appear in DOM classes
  return astClasses.every((c) => domClasses.has(c));
}

/**
 * Compute the nth-of-type index (0-based) for a JSX element among its
 * same-tag siblings within the same parent.
 */
function computeASTNthOfType(astPath: AstPath): number {
  const parent = astPath.parent?.node as AstNode | undefined;
  if (!parent?.children) {
    return 0;
  }
  const tag = getJSXTagName(astPath.node);
  if (!tag) {
    return 0;
  }
  let count = 0;
  for (const child of parent.children) {
    if (child === (astPath.node as unknown as AstNode)) {
      return count;
    }
    if (child.type === "JSXElement" && getJSXTagName(child) === tag) {
      count += 1;
    }
  }
  return count;
}

/** Collapse all whitespace runs (including newlines) to a single space. */
function normalizeWs(s: string): string {
  return s.replaceAll(/\s+/g, " ");
}

/** Check if a JSX element's text content (recursive) contains the given text.
 *  Uses whitespace-normalized comparison because React collapses JSX whitespace
 *  (newlines → spaces) but the AST retains raw formatting. */
function containsText(node: AstNode, text: string): boolean {
  const normalized = normalizeWs(text.trim());
  if (!normalized) {
    return false;
  }
  const { children } = node;
  if (!children) {
    return false;
  }
  for (const child of children) {
    if (
      child.type === "JSXText" &&
      typeof child.value === "string" &&
      normalizeWs(child.value.trim()).includes(normalized)
    ) {
      return true;
    }
    if (child.type === "JSXElement" && containsText(child, text)) {
      return true;
    }
  }
  return false;
}

/**
 * Map contender jscodeshift paths to {line, col, snippet} for the AI locator.
 * snippet is the source line at the element's opening tag. Cold-path only.
 */
function candidatePathsToLocations(
  paths: AstPath[] | undefined,
  source: string
): { line: number; col: number; snippet: string }[] | undefined {
  if (!paths || paths.length === 0) {
    return undefined;
  }
  const lines = source.split("\n");
  const out: { line: number; col: number; snippet: string }[] = [];
  for (const p of paths) {
    const loc = (p?.node as AstNode | undefined)?.openingElement?.loc?.start;
    if (!loc) {
      continue;
    }
    out.push({
      line: loc.line,
      col: loc.column,
      snippet: (lines[loc.line - 1] ?? "").trim().slice(0, 120),
    });
  }
  return out.length > 0 ? out : undefined;
}

// ── Identity verification ────────────────────────────────────────────────

type VerifyVerdict =
  | { ok: true }
  | { ok: false; reason: "tag" | "class" | "id" };

/**
 * Confirm a resolved AST node is not a *contradiction* of the captured identity.
 *
 * Deliberately conservative: it rejects only on positive evidence of a wrong
 * match (tag mismatch, ids that both exist and differ, or both sides carrying
 * classes with zero overlap). Mere absence of confirmation (e.g. node has no
 * static className) never fails — that would block legitimate edits. Subset
 * matching is used for *disambiguation* among candidates (see resolveNodes B3),
 * not as a hard gate here.
 */
function verifyIdentity(node: AstNode, op: IdentityCandidateOp): VerifyVerdict {
  const astTag = getJSXTagName(node);
  if (op.tagName && astTag && !tagOrComponentMatches(astTag, op)) {
    return { ok: false, reason: "tag" };
  }
  if (op.id) {
    const astId = getJSXId(node);
    if (astId && astId !== op.id) {
      return { ok: false, reason: "id" };
    }
  }
  if (op.className) {
    const astClasses = getJSXStaticClasses(node);
    if (astClasses.length > 0) {
      const domClasses = new Set(op.className.split(/\s+/).filter(Boolean));
      const overlaps = astClasses.some((c) => domClasses.has(c));
      if (!overlaps) {
        return { ok: false, reason: "class" };
      }
    }
  }
  return { ok: true };
}

/**
 * Op variants resolveOneNode/resolveByLineColTrusted/checkStaleness operate
 * on — everything except reorder/reorderArrayItem (line-based, handled by
 * the mutation itself) and replaceClassName (resolved separately before
 * these helpers run). All remaining variants share `line`/`col`/`jsxPath`.
 */
type ResolvableOp = Exclude<
  BatchOperation,
  { op: "reorder" } | { op: "reorderArrayItem" } | { op: "replaceClassName" }
>;

/** Whether an op variant is priced as non-structural (applied before structural ops). */
function isNonStructuralOp(op: BatchOperation): boolean {
  return (
    op.op === "updateClass" || op.op === "updateText" || op.op === "moveSpacing"
  );
}

/** Priority for a resolved op: 0 = non-structural, 1 = structural. */
function priorityOf(op: BatchOperation): number {
  return isNonStructuralOp(op) ? 0 : 1;
}

/** Resolve an op by exact line:col, bypassing identity/staleness gates. */
function resolveByLineColTrusted(
  j: JSCodeshift,
  root: Collection,
  index: number,
  op: ResolvableOp | Extract<BatchOperation, { op: "replaceClassName" }>,
  priority: number
): ResolvedOp {
  const tnode = findJSXElementAtLine(
    j,
    root,
    op.line,
    op.col
  ) as unknown as AstPath | null;
  return tnode
    ? { index, op, node: tnode, priority }
    : {
        index,
        op,
        node: null,
        priority,
        error: `No JSX element found near ${op.line}:${op.col}`,
      };
}

/**
 * Staleness check: the captured intent may be invalid because the file
 * changed since the overlay captured this element. Returns an error message
 * if stale, or null if the check passes (or can't be performed).
 */
function checkStaleness(op: ResolvableOp, resolvedPath: string): string | null {
  if (
    !("fileMtime" in op) ||
    op.fileMtime === undefined ||
    op.fileSize === undefined
  ) {
    return null;
  }
  try {
    const stat = fs.statSync(resolvedPath);
    const currentMtime = Math.floor(stat.mtimeMs);
    const expectedMtime = Math.floor(op.fileMtime);
    const currentSize = stat.size;
    if (currentMtime !== expectedMtime || currentSize !== op.fileSize) {
      return (
        `FILE_CHANGED: File has been modified since the overlay captured this element (stale). ` +
        `Re-select the element and try again. ` +
        `Expected mtime=${expectedMtime}/size=${op.fileSize}, got mtime=${currentMtime}/size=${currentSize}`
      );
    }
    return null;
  } catch {
    // stat failed — proceed without staleness check
    return null;
  }
}

/** Fields Step B (fuzzy resolution) reads off an op, beyond identity fields. */
interface FuzzyResolveOp extends IdentityCandidateOp {
  op: BatchOperation["op"];
  line: number;
  col: number;
  nthOfType?: number;
  jsxKey?: string;
  originalText?: string;
  text?: string;
}

interface FuzzyResolveResult {
  node: AstPath | null;
  ambiguousCount: number;
  ambiguousCandidates: AstPath[];
}

/** B1/B2: narrow candidates to the single one matching a captured id/key hint. */
function disambiguateByIdOrKey(
  candidates: AstPath[],
  op: FuzzyResolveOp
): AstPath | null {
  if (op.id) {
    const byId = candidates.filter(
      (p) => getJSXId(p.node as unknown as AstNode) === op.id
    );
    if (byId.length === 1) {
      return byId[0];
    }
  }
  if (op.jsxKey) {
    const byKey = candidates.filter(
      (p) => getJSXKey(p.node as unknown as AstNode) === op.jsxKey
    );
    if (byKey.length === 1) {
      return byKey[0];
    }
  }
  return null;
}

/**
 * B2.5: narrow candidates by visible text content. Mutates `candidates` in
 * place when multiple (but not all) match, to narrow the pool for later
 * steps — matching the original inline behavior.
 */
function narrowCandidatesByText(
  candidates: AstPath[],
  op: FuzzyResolveOp
): AstPath | null {
  const textHint = op.op === "updateText" ? op.originalText : op.text;
  if (!textHint) {
    return null;
  }
  const textCandidates = candidates.filter((c) =>
    containsText(c.node as unknown as AstNode, textHint)
  );
  if (textCandidates.length === 1) {
    const [node] = textCandidates;
    const loc = (node.node as unknown as AstNode).openingElement?.loc?.start;
    logger.debug(
      `[resolve] Text content match <${op.tagName}> → ${loc?.line}:${loc?.column}`
    );
    return node;
  }
  if (textCandidates.length > 1) {
    // Narrow candidates to those containing the text
    candidates.length = 0;
    candidates.push(...textCandidates);
  }
  return null;
}

/**
 * B3 (0 subset matches path): last-resort bidirectional overlap scoring,
 * requiring a clear winner (no silent pick when the top scores are close).
 */
function disambiguateByOverlapScore(
  candidates: AstPath[],
  op: FuzzyResolveOp
): { node: AstPath | null; ambiguousCandidates: AstPath[] } {
  const domClasses = (op.className ?? "").split(/\s+/).filter(Boolean);
  const scored = candidates.map((c) => {
    const astClasses = getJSXStaticClasses(c.node as unknown as AstNode);
    if (astClasses.length === 0) {
      return { c, overlap: 0 };
    }
    const astInDom = astClasses.filter((cl) => domClasses.includes(cl)).length;
    const domInAst = domClasses.filter((cl) => astClasses.includes(cl)).length;
    return {
      c,
      overlap: (astInDom + domInAst) / (astClasses.length + domClasses.length),
    };
  });
  // oxlint-disable-next-line unicorn/no-array-sort -- `scored` is a fresh
  // array from .map() with no other references, so in-place sort mutates
  // nothing observable; Array#toSorted() needs an ES2023 lib target this
  // package's (shared) tsconfig doesn't enable.
  scored.sort((a, b) => b.overlap - a.overlap);

  if (scored.length === 0 || scored[0].overlap < 0.3) {
    return { node: null, ambiguousCandidates: [] };
  }
  const second = scored[1]?.overlap ?? 0;
  if (scored[0].overlap - second > 0.1) {
    return { node: scored[0].c, ambiguousCandidates: [] }; // clear winner
  }
  const tied = scored
    .filter((s) => s.overlap >= scored[0].overlap - 0.1)
    .map((s) => s.c);
  if (op.nthOfType === undefined) {
    return { node: null, ambiguousCandidates: tied };
  }
  const byNth = tied.find((p) => computeASTNthOfType(p) === op.nthOfType);
  return byNth
    ? { node: byNth, ambiguousCandidates: [] }
    : { node: null, ambiguousCandidates: tied };
}

/**
 * B3: filter by className — prefer AST ⊆ DOM (subset) matches. The DOM
 * className legitimately includes runtime-injected classes (cn(), CSS-in-JS),
 * so the true element's *static* classes should all appear in the DOM set.
 */
function disambiguateByClassName(
  candidates: AstPath[],
  op: FuzzyResolveOp
): { node: AstPath | null; ambiguousCandidates: AstPath[] } {
  if (!op.className) {
    return { node: null, ambiguousCandidates: [] };
  }
  const { className } = op;
  const subsetMatches = candidates.filter((c) =>
    classNameSubsetMatch(
      getJSXStaticClasses(c.node as unknown as AstNode),
      className
    )
  );
  logger.debug(
    `[resolve]   ${subsetMatches.length}/${candidates.length} subset matches for className`
  );

  if (subsetMatches.length === 1) {
    return { node: subsetMatches[0], ambiguousCandidates: [] };
  }
  if (subsetMatches.length > 1) {
    // Several subset matches (e.g. identical siblings) — only nthOfType can
    // break the tie. If it can't, this is genuinely ambiguous: fail loudly
    // instead of editing a guessed node.
    if (op.nthOfType !== undefined) {
      const byNth = subsetMatches.filter(
        (p) => computeASTNthOfType(p) === op.nthOfType
      );
      if (byNth.length === 1) {
        return { node: byNth[0], ambiguousCandidates: [] };
      }
    }
    return { node: null, ambiguousCandidates: subsetMatches };
  }
  // 0 subset matches — source may have diverged from the captured className.
  return disambiguateByOverlapScore(candidates, op);
}

/** B5: narrow candidates by nthOfType alone (no className hint). */
function disambiguateByNthOfType(
  candidates: AstPath[],
  op: FuzzyResolveOp
): AstPath | null {
  if (op.nthOfType === undefined) {
    return null;
  }
  const byNth = candidates.filter(
    (p) => computeASTNthOfType(p) === op.nthOfType
  );
  return byNth.length === 1 ? byNth[0] : null;
}

/**
 * Step B: fuzzy resolution using captured hints (id, key, text, className,
 * nthOfType) when there is no exact line:col match. Disambiguates among all
 * same-tag/component candidates in the file.
 */
function resolveFuzzyCandidate(
  j: JSCodeshift,
  root: Collection,
  op: FuzzyResolveOp
): FuzzyResolveResult {
  if (!op.tagName) {
    return { node: null, ambiguousCount: 0, ambiguousCandidates: [] };
  }

  const candidates: AstPath[] = [];
  for (const p of root.find(j.JSXElement).paths()) {
    const astTag = getJSXTagName(p.node as unknown as AstNode);
    if (astTag && tagOrComponentMatches(astTag, op)) {
      candidates.push(p as unknown as AstPath);
    }
  }

  logger.debug(
    `[resolve] ${candidates.length} <${op.tagName}> candidates, DOM className="${op.className?.slice(0, 60) ?? ""}"`
  );

  if (candidates.length === 1) {
    // A single tag match is a strong signal, but reject if it positively
    // contradicts the captured identity (e.g. disjoint classes) — then fail
    // loudly rather than edit a node we have evidence is wrong.
    const verdict = verifyIdentity(
      candidates[0].node as unknown as AstNode,
      op
    );
    if (verdict.ok) {
      return {
        node: candidates[0],
        ambiguousCount: 0,
        ambiguousCandidates: [],
      };
    }
    logger.debug(
      `[resolve] sole <${op.tagName}> candidate rejected by verify (${verdict.reason})`
    );
    return { node: null, ambiguousCount: 0, ambiguousCandidates: [] };
  }
  if (candidates.length <= 1) {
    return { node: null, ambiguousCount: 0, ambiguousCandidates: [] };
  }

  // ── Disambiguate ─────────────────────────────────────────────────────
  let node = disambiguateByIdOrKey(candidates, op);
  node ??= narrowCandidatesByText(candidates, op);

  let ambiguousCandidates: AstPath[] = [];
  if (!node) {
    ({ node, ambiguousCandidates } = disambiguateByClassName(candidates, op));
  }
  if (!node) {
    node = disambiguateByNthOfType(candidates, op);
  }

  // Unresolved with multiple same-tag candidates — keep them as seed hints
  // for the AI locator (no-match case, e.g. the real target is a map
  // template or a conditional branch we didn't enumerate).
  if (!node && ambiguousCandidates.length === 0) {
    ambiguousCandidates = candidates;
  }

  return {
    node,
    ambiguousCount: ambiguousCandidates.length,
    ambiguousCandidates,
  };
}

/** Resolve a single (non-reorder, non-replaceClassName, non-trustLocation) op. */
function resolveOneNode(
  j: JSCodeshift,
  root: Collection,
  index: number,
  op: ResolvableOp,
  resolvedPath: string
): ResolvedOp {
  // ── Staleness check (before resolution — guards every path below) ──
  const stalenessError = checkStaleness(op, resolvedPath);
  if (stalenessError) {
    return { index, op, node: null, priority: 0, error: stalenessError };
  }

  // ── Step 0: Try JSX structural path (preferred) ───────────────────
  if ("jsxPath" in op && op.jsxPath && op.jsxPath.segments.length > 0) {
    const pathNode = resolveJSXPath(j, root, op.jsxPath);
    if (pathNode) {
      // Gate the structural-path result through full identity verification
      // (not just tag): a stale path that still resolves to a tag-matching
      // but wrong node would otherwise be edited silently.
      const verdict = verifyIdentity(pathNode.node, op);
      if (verdict.ok) {
        return { index, op, node: pathNode, priority: priorityOf(op) };
      }
      logger.debug(
        `[resolve] structural path rejected by verify (${verdict.reason}) — falling through to line:col + fuzzy`
      );
    }
    // If path resolution failed, fall through to line:col + fuzzy (existing code)
  }

  // ── Step A: Try exact line:col match ─────────────────────────────
  let node = findJSXElementAt(
    j,
    root,
    op.line,
    op.col
  ) as unknown as AstPath | null;

  // Verify the exact-position hit against captured identity
  if (node) {
    const verdict = verifyIdentity(node.node, op);
    if (!verdict.ok) {
      // Exact position contradicts identity — clear and fall through
      node = null;
    }
  }

  // ── Step B: Fallback — fuzzy resolution using hints ──────────────
  let ambiguousCount = 0;
  let ambiguousCandidates: AstPath[] = [];
  if (!node) {
    ({ node, ambiguousCount, ambiguousCandidates } = resolveFuzzyCandidate(
      j,
      root,
      op
    ));
  }

  // Genuine ambiguity — fail loudly so the user (or a future AI fallback) can
  // resolve it, rather than mutating an arbitrary candidate. Text ops keep
  // their null-without-error path so the string-literal/MDX fallback can run.
  if (!node && ambiguousCount > 1 && op.op !== "updateText") {
    return {
      index,
      op,
      node: null,
      priority: 0,
      error: `AMBIGUOUS: ${ambiguousCount} elements match the captured identity (tag=${op.tagName}${op.className ? `, className="${op.className.slice(0, 60)}"` : ""}) and no disambiguator (id, key, nthOfType) singles one out. Re-select the element.`,
      ambiguousCandidates,
    };
  }

  if (!node && op.op === "updateText") {
    return { index, op, node: null, priority: 0 };
  }

  if (!node) {
    return {
      index,
      op,
      node: null,
      priority: 0,
      error: `No JSX element found at ${op.line}:${op.col}${op.tagName ? ` (tag=${op.tagName})` : ""}${op.className ? ` (className=${op.className})` : ""}`,
      ambiguousCandidates,
    };
  }

  return { index, op, node, priority: priorityOf(op) };
}

// ── Node resolution ──────────────────────────────────────────────────────

function resolveNodes(
  j: JSCodeshift,
  root: Collection,
  ops: { index: number; op: BatchOperation }[],
  resolvedPath: string
): ResolvedOp[] {
  const resolved: ResolvedOp[] = [];

  for (const { index, op } of ops) {
    if (op.op === "reorder" || op.op === "reorderArrayItem") {
      // Line-based resolution (handled during mutation), no staleness baseline.
      resolved.push({
        index,
        op,
        node: null, // not needed — the mutation resolves by line internally
        priority: 1, // structural
      });
      continue;
    }

    // replaceClassName is an AI-generated, location-locked op (like reorderArrayItem)
    // applied on user confirm — it carries only file/line/col, not the full identity
    // + staleness fields, so resolve its node by line/col and skip the gates below.
    if (op.op === "replaceClassName") {
      resolved.push(resolveByLineColTrusted(j, root, index, op, 0));
      continue;
    }

    // ── AI-resolved location: trust it ───────────────────────────────
    // The locator already decided identity (the source tag may differ from the
    // DOM tag, e.g. <Link> → <a>), so resolve purely by line/col and skip the
    // identity + staleness gates that would otherwise reject it.
    if ((op as { trustLocation?: boolean }).trustLocation) {
      resolved.push(
        resolveByLineColTrusted(j, root, index, op, priorityOf(op))
      );
      continue;
    }

    resolved.push(resolveOneNode(j, root, index, op, resolvedPath));
  }

  return resolved;
}

// ── Same-node coalescing ─────────────────────────────────────────────────

function coalesceOps(resolved: ResolvedOp[]): ResolvedOp[] {
  // Group by node identity (same line:col means same node)
  const byPosition = new Map<string, ResolvedOp[]>();

  for (const rop of resolved) {
    if (rop.error || !rop.node) {
      // Failed resolution — keep as-is
      continue;
    }
    if (
      rop.op.op === "reorder" ||
      rop.op.op === "deleteElement" ||
      rop.op.op === "moveSibling" ||
      rop.op.op === "reorderArrayItem"
    ) {
      // Structural ops can't be coalesced
      continue;
    }
    const key = `${rop.op.line}:${rop.op.col}`;
    const group = byPosition.get(key) ?? [];
    group.push(rop);
    byPosition.set(key, group);
  }

  // Merge multiple updateClass ops on the same node
  const merged = new Set<number>(); // indices that were merged away

  for (const [, group] of byPosition) {
    const classOps = group.filter((r) => r.op.op === "updateClass");
    if (classOps.length <= 1) {
      continue;
    }

    // Merge all updates into the first op
    const [primary] = classOps;
    const primaryOp = primary.op as Extract<
      BatchOperation,
      { op: "updateClass" }
    >;
    for (let i = 1; i < classOps.length; i += 1) {
      const secondaryOp = classOps[i].op as Extract<
        BatchOperation,
        { op: "updateClass" }
      >;
      primaryOp.updates.push(...secondaryOp.updates);
      merged.add(classOps[i].index);
    }
  }

  // Return non-merged ops + mark merged ones as success (they're included in primary)
  return resolved.filter((r) => !merged.has(r.index));
}

// ── Mutation application ─────────────────────────────────────────────────

/**
 * Non-reorder/updateText ops only reach `applyOp` with a resolved `node`
 * (guaranteed by `resolveNodes`/`coalesceOps` before `executeBatch` calls
 * this). Narrow away the `null` branch here rather than threading optional
 * chaining through every case below; if the invariant is ever violated this
 * throws (caught by `executeBatch`'s per-op try/catch), which is the same
 * outcome unguarded property access on `null` would have produced.
 */
function requireNode(node: AstPath | null): AstPath {
  if (!node) {
    throw new Error(
      "applyOp: expected a resolved node (resolveNodes should have guaranteed one)"
    );
  }
  return node;
}

// ── String literal fallback for text edits ──────────────────────────────

/**
 * Fallback for text edits where the text lives in a JS string literal
 * (e.g. `description: "some text"`) rather than inline JSX.
 * Searches all StringLiteral/Literal nodes in the file for an exact match.
 */
function replaceStringLiteralInFile(
  j: JSCodeshift,
  root: Collection,
  originalText: string,
  newText: string
): { replaced: boolean; ambiguous: boolean } {
  const trimmedOriginal = originalText.trim();
  if (!trimmedOriginal) {
    return { replaced: false, ambiguous: false };
  }

  const literalMatches: { apply: () => void }[] = [];

  // Search StringLiteral nodes (babel parser)
  for (const p of root.find(j.StringLiteral).paths()) {
    if (p.node.value === trimmedOriginal) {
      literalMatches.push({
        apply: () => {
          p.node.value = newText.trim();
        },
      });
    }
  }

  // Search Literal nodes (typescript/flow parser)
  try {
    for (const p of root.find(j.Literal).paths()) {
      if (
        typeof p.node.value === "string" &&
        p.node.value === trimmedOriginal
      ) {
        literalMatches.push({
          apply: () => {
            p.node.value = newText.trim();
          },
        });
      }
    }
  } catch {
    // j.Literal may not exist in all parsers
  }

  // Search TemplateLiteral quasis for the text as a substring
  for (const p of root.find(j.TemplateLiteral).paths()) {
    for (const quasi of p.node.quasis ?? []) {
      if (
        (p.node.expressions?.length ?? 0) === 0 &&
        quasi.value?.raw === trimmedOriginal
      ) {
        literalMatches.push({
          apply: () => {
            quasi.value.raw = newText.trim();
            quasi.value.cooked = newText.trim();
          },
        });
      }
    }
  }

  if (literalMatches.length === 0) {
    return { replaced: false, ambiguous: false };
  }
  if (literalMatches.length > 1) {
    return { replaced: false, ambiguous: true };
  }
  literalMatches[0].apply();
  return { replaced: true, ambiguous: false };
}

function collapseVisibleWhitespace(value: string): string {
  return value.replaceAll("\u00A0", " ").replaceAll(/\s+/g, " ");
}

function getStaticRenderableText(
  node: AstNode | null | undefined
): string | null {
  if (!node) {
    return "";
  }
  if (node.type === "JSXText") {
    return collapseVisibleWhitespace(String(node.value ?? ""));
  }
  if (node.type === "JSXElement") {
    const parts: string[] = [];
    for (const child of node.children ?? []) {
      const text = getStaticRenderableText(child);
      if (text === null) {
        return null;
      }
      parts.push(text);
    }
    return collapseVisibleWhitespace(parts.join(""));
  }
  if (node.type === "JSXExpressionContainer") {
    const expr = node.expression;
    if (expr?.type === "StringLiteral" || expr?.type === "Literal") {
      return collapseVisibleWhitespace(String(expr.value ?? ""));
    }
    return null;
  }
  return "";
}

/** The subset of node shapes {@link readStringLiteralValue}/{@link writeStringLiteralValue} accept. */
type LiteralLikeNode = AstNode | null | undefined;

function readStringLiteralValue(node: LiteralLikeNode): string | null {
  if (!node) {
    return null;
  }
  if (node.type === "StringLiteral" || node.type === "Literal") {
    return typeof node.value === "string" ? node.value : null;
  }
  if (
    node.type === "TemplateLiteral" &&
    (node.expressions?.length ?? 0) === 0
  ) {
    const quasiValue = node.quasis?.[0]?.value as
      | { raw?: string; cooked?: string }
      | undefined;
    return quasiValue?.cooked ?? quasiValue?.raw ?? "";
  }
  return null;
}

function writeStringLiteralValue(
  node: LiteralLikeNode,
  value: string
): boolean {
  if (!node) {
    return false;
  }
  if (node.type === "StringLiteral" || node.type === "Literal") {
    node.value = value;
    return true;
  }
  if (
    node.type === "TemplateLiteral" &&
    (node.expressions?.length ?? 0) === 0 &&
    node.quasis?.length === 1
  ) {
    const [quasi] = node.quasis;
    quasi.value = { raw: value, cooked: value };
    return true;
  }
  return false;
}

function getObjectPropertyValueNode(
  objectExpression: AstNode | null | undefined,
  propertyName: string
): AstNode | null {
  for (const property of objectExpression?.properties ?? []) {
    if (property?.type !== "Property" && property?.type !== "ObjectProperty") {
      continue;
    }
    let keyName: string | null = null;
    if (property.key?.type === "Identifier") {
      keyName = nodeName(property.key);
    } else if (
      property.key?.type === "StringLiteral" ||
      property.key?.type === "Literal"
    ) {
      keyName = String(property.key.value ?? "");
    }
    if (keyName === propertyName) {
      return (property.value as AstNode | undefined) ?? null;
    }
  }
  return null;
}

function resolveVariableDeclaratorByName(
  j: JSCodeshift,
  root: Collection,
  name: string
): AstPath | null {
  // jscodeshift Collection#find(type, filter) is not Array#find(cb, thisArg);
  // the second argument is a shape filter, not a `this` binding.
  const matches = root
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- see above
    .find(j.VariableDeclarator, {
      id: { type: "Identifier", name },
    })
    .paths();
  if (matches.length !== 1) {
    return null;
  }
  return matches[0] as unknown as AstPath;
}

function findEnclosingMapCollectionExpression(
  elementPath: AstPath,
  paramName: string
): AstNode | null {
  let current: AstPath | undefined = elementPath;
  while (current) {
    const node = current.node as unknown as AstNode;
    if (
      node?.type === "ArrowFunctionExpression" ||
      node?.type === "FunctionExpression"
    ) {
      const firstParam = node.params?.[0];
      if (
        firstParam?.type === "Identifier" &&
        nodeName(firstParam) === paramName
      ) {
        const callNode = current.parent?.node as AstNode | undefined;
        if (
          callNode?.type === "CallExpression" &&
          callNode.callee?.type === "MemberExpression" &&
          !callNode.callee.computed &&
          callNode.callee.property?.type === "Identifier" &&
          nodeName(callNode.callee.property) === "map"
        ) {
          return callNode.callee.object ?? null;
        }
      }
    }
    current = current.parent as unknown as AstPath | undefined;
  }
  return null;
}

/** `{originalText}` bound to a plain `const x = "..."` identifier. */
function candidatesFromIdentifier(
  j: JSCodeshift,
  root: Collection,
  expression: AstNode
): AstNode[] {
  const declarator = resolveVariableDeclaratorByName(
    j,
    root,
    nodeName(expression) ?? ""
  );
  const valueNode = (declarator?.node as unknown as AstNode | undefined)?.init;
  return readStringLiteralValue(valueNode) === null || !valueNode
    ? []
    : [valueNode];
}

/**
 * `{obj.prop}` — either a directly-declared object (`const obj = {...}`), or
 * (when `obj` is a `.map()` callback param) a property read off every
 * element of the mapped array, so any of them could be the bound value.
 */
function candidatesFromMemberExpression(
  j: JSCodeshift,
  root: Collection,
  elementPath: AstPath,
  expression: AstNode
): AstNode[] {
  const objectName = nodeName(expression.object) ?? "";
  const propertyName = nodeName(expression.property) ?? "";

  const directObjectDeclarator = resolveVariableDeclaratorByName(
    j,
    root,
    objectName
  );
  const directObjectValue = getObjectPropertyValueNode(
    (directObjectDeclarator?.node as unknown as AstNode | undefined)?.init,
    propertyName
  );
  if (readStringLiteralValue(directObjectValue) !== null) {
    return [directObjectValue as AstNode];
  }

  const collectionExpression = findEnclosingMapCollectionExpression(
    elementPath,
    objectName
  );
  if (collectionExpression?.type !== "Identifier") {
    return [];
  }
  const collectionDeclarator = resolveVariableDeclaratorByName(
    j,
    root,
    nodeName(collectionExpression) ?? ""
  );
  const arrayExpression = (
    collectionDeclarator?.node as unknown as AstNode | undefined
  )?.init;
  if (arrayExpression?.type !== "ArrayExpression") {
    return [];
  }
  return (arrayExpression.elements ?? [])
    .map((element) => getObjectPropertyValueNode(element, propertyName))
    .filter((node): node is AstNode => readStringLiteralValue(node) !== null);
}

function resolveExpressionLiteralCandidates(
  j: JSCodeshift,
  root: Collection,
  elementPath: AstPath,
  expression: AstNode | null | undefined
): AstNode[] {
  if (!expression) {
    return [];
  }

  if (expression.type === "Identifier") {
    return candidatesFromIdentifier(j, root, expression);
  }

  if (
    expression.type === "MemberExpression" &&
    !expression.computed &&
    expression.object?.type === "Identifier" &&
    expression.property?.type === "Identifier"
  ) {
    return candidatesFromMemberExpression(j, root, elementPath, expression);
  }

  return [];
}

function replaceBoundStringLiteralInElement(
  j: JSCodeshift,
  root: Collection,
  elementPath: AstPath,
  originalText: string,
  newText: string
): boolean {
  const children = (elementPath.node as unknown as AstNode).children ?? [];
  if (children.length === 0) {
    return false;
  }

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child?.type !== "JSXExpressionContainer") {
      continue;
    }

    const candidates = resolveExpressionLiteralCandidates(
      j,
      root,
      elementPath,
      child.expression
    );
    if (candidates.length === 0) {
      continue;
    }

    const prefixParts = children.slice(0, index).map(getStaticRenderableText);
    const suffixParts = children.slice(index + 1).map(getStaticRenderableText);
    if ([...prefixParts, ...suffixParts].some((part) => part === null)) {
      continue;
    }

    const prefix = collapseVisibleWhitespace(prefixParts.join(""));
    const suffix = collapseVisibleWhitespace(suffixParts.join(""));

    const matchingCandidates = candidates.filter((candidateNode) => {
      const value = readStringLiteralValue(candidateNode);
      return (
        value !== null &&
        collapseVisibleWhitespace(`${prefix}${value}${suffix}`) ===
          collapseVisibleWhitespace(originalText)
      );
    });

    if (matchingCandidates.length !== 1) {
      continue;
    }
    if (
      !collapseVisibleWhitespace(newText).startsWith(prefix) ||
      !collapseVisibleWhitespace(newText).endsWith(suffix)
    ) {
      continue;
    }

    const rawNewValue = newText.slice(
      prefix.length,
      newText.length - suffix.length
    );
    if (writeStringLiteralValue(matchingCandidates[0], rawNewValue)) {
      return true;
    }
  }

  return false;
}

// ── Tailwind spacing scale helpers ──────────────────────────────────────

/**
 * Remove all classes matching a regex pattern from a JSX element's className.
 * Handles StringLiteral, Literal, TemplateLiteral, and CallExpression className forms.
 */
/** Strip classes matching `pattern` out of a whitespace-separated class string. */
function removeMatchingTokens(s: unknown, pattern: RegExp): string {
  return String(s ?? "")
    .split(/\s+/)
    .filter((c) => c && !pattern.test(c))
    .join(" ");
}

/** `className={\`flex gap-4 ${dynamic}\`}` — clean each static quasi, preserving surrounding whitespace. */
function removeClassFromTemplateLiteral(expr: AstNode, pattern: RegExp): void {
  for (const quasi of expr.quasis ?? []) {
    const quasiValue = quasi.value as { raw?: string } | undefined;
    const raw = quasiValue?.raw ?? "";
    const leadingWs = raw.match(/^(?<ws>\s*)/)?.groups?.ws ?? "";
    const trailingWs = raw.match(/(?<ws>\s*)$/)?.groups?.ws ?? "";
    const cleaned = removeMatchingTokens(raw.trim(), pattern);
    quasi.value = {
      raw: `${leadingWs}${cleaned}${trailingWs}`,
      cooked: `${leadingWs}${cleaned}${trailingWs}`,
    };
  }
}

/** `className={cn("flex gap-4", ...)}` — clean each static string argument. */
function removeClassFromCallExpression(expr: AstNode, pattern: RegExp): void {
  for (const arg of expr.arguments ?? []) {
    if (arg.type === "StringLiteral" || arg.type === "Literal") {
      arg.value = removeMatchingTokens(arg.value, pattern);
    }
  }
}

function removeClassByPattern(nodePath: AstPath, pattern: RegExp): void {
  const { openingElement } = nodePath.node as unknown as AstNode;
  const attrs = openingElement?.attributes ?? [];
  const classNameAttr = attrs.find(
    (a) => a.type === "JSXAttribute" && nodeName(a.name) === "className"
  );
  if (!classNameAttr?.value) {
    return;
  }

  const val = classNameAttr.value as AstNode;

  if (val.type === "StringLiteral" || val.type === "Literal") {
    val.value = removeMatchingTokens(val.value, pattern);
    return;
  }
  if (val.type === "JSXExpressionContainer") {
    const expr = val.expression;
    if (expr?.type === "TemplateLiteral") {
      removeClassFromTemplateLiteral(expr, pattern);
      return;
    }
    if (expr?.type === "CallExpression") {
      removeClassFromCallExpression(expr, pattern);
    }
  }
}

/** Default Tailwind spacing scale: token → px. Used by the batch engine to
 *  read back existing translate classes and accumulate deltas. */
const SPACING_TOKEN_PX: Record<string, number> = {
  "0": 0,
  px: 1,
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "2.5": 10,
  "3": 12,
  "3.5": 14,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
  "9": 36,
  "10": 40,
  "11": 44,
  "12": 48,
  "14": 56,
  "16": 64,
  "20": 80,
  "24": 96,
  "28": 112,
  "32": 128,
  "36": 144,
  "40": 160,
  "44": 176,
  "48": 192,
  "52": 208,
  "56": 224,
  "60": 240,
  "64": 256,
  "72": 288,
  "80": 320,
  "96": 384,
};

/** Reverse map: px → token for re-snapping. */
const PX_SPACING_TOKEN: Record<number, string> = {};
for (const [token, px] of Object.entries(SPACING_TOKEN_PX)) {
  PX_SPACING_TOKEN[px] = token;
}

/**
 * Parse a Tailwind translate class (e.g., "translate-x-6", "-translate-y-4", "translate-x-[32px]")
 * back to a signed pixel value.
 */
function parseTranslateClassPx(cls: string, basePrefix: string): number {
  const isNeg = cls.startsWith("-");
  // Strip leading "-" and the prefix + "-" to get the token
  const stripped = isNeg ? cls.slice(1) : cls;
  const token = stripped.slice(basePrefix.length + 1); // +1 for the "-" separator

  // Arbitrary value: [Npx]
  const arbMatch = token.match(/^\[(?<px>-?\d+(?:\.\d+)?)px\]$/);
  if (arbMatch) {
    return (isNeg ? -1 : 1) * Number(arbMatch.groups?.px);
  }

  // Standard token. Indexing a plain Record with an arbitrary string key can
  // yield `undefined` at runtime even though the index signature claims
  // `number` — check both null and undefined rather than trusting the type.
  const px = SPACING_TOKEN_PX[token];
  if (px !== null && px !== undefined) {
    return (isNeg ? -1 : 1) * px;
  }

  return 0; // unknown token, treat as 0
}

/**
 * Snap an absolute pixel value to the nearest Tailwind spacing token.
 * Returns the token name (e.g., "6") or an arbitrary value (e.g., "[32px]").
 */
function snapPxToSpacingToken(absPx: number): string {
  let bestToken: string | null = null;
  let bestDist = Infinity;

  for (const [token, tokenPx] of Object.entries(SPACING_TOKEN_PX)) {
    const dist = Math.abs(absPx - tokenPx);
    if (dist < bestDist) {
      bestDist = dist;
      bestToken = token;
    }
  }

  // Accept if within 15% relative threshold (max 8px)
  if (bestToken !== null && bestDist <= Math.min(absPx * 0.15, 8)) {
    return bestToken;
  }

  return `[${Math.round(absPx)}px]`;
}

// ── Move mechanism detection ─────────────────────────────────────────────

type MoveMechanism = "framer-motion" | "translate-class";

/**
 * Detect which mechanism should be used to apply a move to this element.
 * - framer-motion: element is motion.* with animate prop that ALREADY contains x or y
 *   (only if the animate prop already controls position — don't inject position into
 *   opacity-only or scale-only animations)
 * - translate-class: default for everything else — stacks on top of inline styles
 *   without destroying existing values
 */
function detectMoveMechanism(
  nodePath: AstPath,
  axis: "x" | "y"
): MoveMechanism {
  const node = nodePath.node as unknown as AstNode;
  const tagName = getJSXTagName(node);
  const attrs = node.openingElement?.attributes ?? [];

  // Check for framer-motion: tag starts with "motion." and animate prop has x/y
  if (tagName?.startsWith("motion.")) {
    const animateProp = attrs.find(
      (a) => a.type === "JSXAttribute" && nodeName(a.name) === "animate"
    );
    if (
      animateProp?.value &&
      (animateProp.value as AstNode).type === "JSXExpressionContainer"
    ) {
      const expr = (animateProp.value as AstNode).expression;
      if (expr?.type === "ObjectExpression") {
        const propName = axis === "x" ? "x" : "y";
        const hasAxisProp = (expr.properties ?? []).some(
          (p) => p.type === "ObjectProperty" && nodeName(p.key) === propName
        );
        if (hasAxisProp) {
          return "framer-motion";
        }
      }
    }
  }

  return "translate-class";
}

/**
 * Apply move to a framer-motion element by modifying the animate prop's existing x/y value.
 * Only called when detectMoveMechanism confirmed the animate prop already has the axis prop.
 */
function applyFramerMotionMove(
  nodePath: AstPath,
  op: Extract<BatchOperation, { op: "moveSpacing" }>
): string | undefined {
  const attrs =
    (nodePath.node as unknown as AstNode).openingElement?.attributes ?? [];
  const animateProp = attrs.find(
    (a) => a.type === "JSXAttribute" && nodeName(a.name) === "animate"
  );
  const animateValue = animateProp?.value as AstNode | undefined;
  if (animateValue?.type !== "JSXExpressionContainer") {
    return "animate prop not found or not an expression";
  }

  const expr = animateValue.expression;
  if (expr?.type !== "ObjectExpression") {
    return "Cannot modify framer-motion animate prop (not an inline object)";
  }

  const propName = op.axis === "x" ? "x" : "y";
  const existingProp = (expr.properties ?? []).find(
    (p) => p.type === "ObjectProperty" && nodeName(p.key) === propName
  );

  if (!existingProp) {
    // Shouldn't happen — detectMoveMechanism verified this exists
    return `No ${propName} property in animate prop`;
  }

  // Read current numeric value (handles positive literals and unary negation)
  let currentValue = 0;
  const existingValue = existingProp.value as AstNode | undefined;
  if (existingValue?.type === "NumericLiteral") {
    currentValue =
      typeof existingValue.value === "number" ? existingValue.value : 0;
  } else if (
    existingValue?.type === "UnaryExpression" &&
    existingValue.operator === "-"
  ) {
    const argValue = existingValue.argument?.value;
    currentValue = -(typeof argValue === "number" ? argValue : 0);
  }

  const newValue = currentValue + op.pxDelta;

  // Write back — use UnaryExpression for negative values to produce "y: -160" not "y: -160"
  existingProp.value =
    newValue < 0
      ? {
          type: "UnaryExpression",
          operator: "-",
          prefix: true,
          argument: { type: "NumericLiteral", value: Math.abs(newValue) },
        }
      : { type: "NumericLiteral", value: newValue };

  return undefined;
}

// ── Main entry point ─────────────────────────────────────────────────────

function applyUpdateClass(
  j: JSCodeshift,
  node: AstPath | null,
  op: Extract<BatchOperation, { op: "updateClass" }>
): string | undefined {
  const updates: ClassNameUpdate[] = op.updates.map(
    (u: Extract<BatchOperation, { op: "updateClass" }>["updates"][number]) => ({
      tailwindPrefix: u.tailwindPrefix,
      tailwindToken: u.tailwindToken,
      value: u.value,
      relatedPrefixes: u.relatedPrefixes,
      classPattern: u.classPattern,
      standalone: u.standalone,
      variant: u.variant,
    })
  );
  mutateClassName(
    j,
    requireNode(node) as unknown as Parameters<typeof mutateClassName>[1],
    updates
  );
  return undefined;
}

function applyReplaceClassName(
  j: JSCodeshift,
  node: AstPath | null,
  op: Extract<BatchOperation, { op: "replaceClassName" }>
): string | undefined {
  mutateClassNameReplace(
    j,
    requireNode(node) as unknown as Parameters<
      typeof mutateClassNameReplace
    >[1],
    op.className
  );
  return undefined;
}

function applyUpdateText(
  j: JSCodeshift,
  root: Collection,
  node: AstPath | null,
  op: Extract<BatchOperation, { op: "updateText" }>,
  source: string
): string | undefined {
  if (node) {
    const boundFallback = replaceBoundStringLiteralInElement(
      j,
      root,
      node,
      op.originalText,
      op.newText
    );
    if (boundFallback) {
      return undefined;
    }

    const found = mutateTextContent(
      node as unknown as Parameters<typeof mutateTextContent>[0],
      op.originalText,
      op.newText,
      source,
      op.cursorOffset,
      op.textAnchor
    );
    if (found) {
      return undefined;
    }
  }

  const fallback = replaceStringLiteralInFile(
    j,
    root,
    op.originalText,
    op.newText
  );
  if (fallback.replaced) {
    return undefined;
  }
  if (fallback.ambiguous) {
    return `Text "${op.originalText}" matched multiple string literals in this file; refusing ambiguous rewrite`;
  }
  return `No matching text "${op.originalText}" found in element at ${op.line}:${op.col}`;
}

function applyMoveSibling(
  node: AstPath | null,
  op: Extract<BatchOperation, { op: "moveSibling" }>
): string | undefined {
  if (!node) {
    return `Could not resolve element at ${op.line}:${op.col} to move`;
  }
  try {
    swapWithAdjacentSibling(
      node as unknown as Parameters<typeof swapWithAdjacentSibling>[0],
      op.direction
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

function applyMoveSpacing(
  j: JSCodeshift,
  node: AstPath | null,
  op: Extract<BatchOperation, { op: "moveSpacing" }>
): string | undefined {
  const target = requireNode(node);
  // Detect the right mechanism for this element
  const mechanism = detectMoveMechanism(target, op.axis);

  if (mechanism === "framer-motion") {
    return applyFramerMotionMove(target, op);
  }

  // Default: CSS translate class
  const basePrefix = op.axis === "x" ? "translate-x" : "translate-y";
  const classPattern = `^-?${basePrefix.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-|$)`;
  const classPatternRe = new RegExp(classPattern);

  // Read existing translate class to accumulate rather than replace
  const existingClasses = getJSXStaticClasses(target.node);
  let existingPx = 0;
  for (const cls of existingClasses) {
    if (classPatternRe.test(cls)) {
      existingPx = parseTranslateClassPx(cls, basePrefix);
      break;
    }
  }

  const totalPx = existingPx + op.pxDelta;

  // If net movement is ~0, remove the translate class entirely
  if (Math.abs(totalPx) < 0.5) {
    removeClassByPattern(target, classPatternRe);
    return undefined;
  }

  const isNegative = totalPx < 0;
  const token = snapPxToSpacingToken(Math.abs(totalPx));
  const updates: ClassNameUpdate[] = [
    {
      tailwindPrefix: isNegative ? `-${basePrefix}` : basePrefix,
      tailwindToken: token,
      value: "",
      classPattern,
    },
  ];
  mutateClassName(
    j,
    target as unknown as Parameters<typeof mutateClassName>[1],
    updates
  );
  return undefined;
}

/**
 * Remove a deleted element's leading/trailing whitespace-only JSXText
 * sibling along with it, if one exists. Returns true if the element (and
 * possibly its whitespace sibling) was removed via direct children-array
 * splicing; false if the caller should fall back to `path.prune()`.
 */
function deleteJSXChild(target: AstPath): boolean {
  const parent = target.parent as { node?: AstNode } | undefined;
  if (!parent?.node?.children) {
    return false;
  }
  const { children } = parent.node;
  const idx = children.indexOf(target.node);
  if (idx === -1) {
    return false;
  }
  // Remove trailing whitespace JSXText if it exists
  if (
    idx + 1 < children.length &&
    children[idx + 1]?.type === "JSXText" &&
    String(children[idx + 1].value ?? "").trim() === ""
  ) {
    children.splice(idx, 2);
  }
  // Or remove leading whitespace JSXText
  else if (
    idx > 0 &&
    children[idx - 1]?.type === "JSXText" &&
    String(children[idx - 1].value ?? "").trim() === ""
  ) {
    children.splice(idx - 1, 2);
  } else {
    children.splice(idx, 1);
  }
  return true;
}

function applyDeleteElement(node: AstPath | null): string | undefined {
  // Use jscodeshift's path-based removal — handles all parent types
  // (JSXElement children, return statements, variable declarations, etc.)
  // and correctly updates internal AST references.
  const target = requireNode(node);
  try {
    // For JSX children, we need to also remove surrounding whitespace JSXText nodes
    if (deleteJSXChild(target)) {
      return undefined;
    }
    // Fallback: use jscodeshift's prune (handles non-JSX-children cases)
    target.prune();
    return undefined;
  } catch (error) {
    return `Failed to remove element: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function applyOp(
  j: JSCodeshift,
  root: Collection,
  rop: ResolvedOp,
  source: string
): string | undefined {
  const { op, node } = rop;

  switch (op.op) {
    case "updateClass": {
      return applyUpdateClass(j, node, op);
    }
    case "replaceClassName": {
      return applyReplaceClassName(j, node, op);
    }
    case "updateText": {
      return applyUpdateText(j, root, node, op, source);
    }
    case "reorder": {
      try {
        mutateReorder(j, root, op.fromLine, op.toLine);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return undefined;
    }
    case "reorderArrayItem": {
      try {
        swapArrayElementAt(j, root, op.line, op.col, op.direction);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return undefined;
    }
    case "moveSibling": {
      return applyMoveSibling(node, op);
    }
    case "moveSpacing": {
      return applyMoveSpacing(j, node, op);
    }
    case "duplicateElement": {
      // Handled in Phase 0 of executeBatch (source-level splice).
      return undefined;
    }
    case "deleteElement": {
      return applyDeleteElement(node);
    }
    default: {
      const _exhaustive: never = op;
      return `Unknown operation type: ${_exhaustive}`;
    }
  }
}

// ── Duplicate element helpers ───────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLiteralAttributeValue(
  attrValue: AstNode | null | undefined
): string | null {
  if (!attrValue) {
    return null;
  }
  if (attrValue.type === "StringLiteral" || attrValue.type === "Literal") {
    return typeof attrValue.value === "string" ? attrValue.value : null;
  }
  return null;
}

function getDuplicateParentIdentity(nodePath: AstPath): string {
  const parent = nodePath.parent?.node as AstNode | undefined;
  const parentStart = parent?.start ?? "root";
  const parentEnd = parent?.end ?? "root";
  return `${parentStart}:${parentEnd}`;
}

function collectSiblingLiteralKeys(nodePath: AstPath): Set<string> {
  const keys = new Set<string>();
  const parentChildren = (nodePath.parent?.node as AstNode | undefined)
    ?.children;
  if (!Array.isArray(parentChildren)) {
    return keys;
  }

  for (const sibling of parentChildren) {
    if (sibling?.type !== "JSXElement") {
      continue;
    }
    const keyAttr = (sibling.openingElement?.attributes ?? []).find(
      (a) => a.type === "JSXAttribute" && nodeName(a.name) === "key"
    );
    const keyValue = getLiteralAttributeValue(
      keyAttr?.value as AstNode | undefined
    );
    if (keyValue) {
      keys.add(keyValue);
    }
  }
  return keys;
}

function pickUniqueDuplicateKey(
  originalKey: string,
  usedKeys: Set<string>
): string {
  let candidate = `${originalKey}-copy`;
  let suffix = 2;
  while (usedKeys.has(candidate)) {
    candidate = `${originalKey}-copy-${suffix}`;
    suffix += 1;
  }
  usedKeys.add(candidate);
  return candidate;
}

function deduplicateKey(
  jsxText: string,
  nodePath: AstPath,
  reservedKeysByParent: Map<string, Set<string>>
): string {
  const attrs =
    (nodePath.node as unknown as AstNode).openingElement?.attributes ?? [];
  const keyAttr = attrs.find(
    (a) => a.type === "JSXAttribute" && nodeName(a.name) === "key"
  );
  if (!keyAttr?.value) {
    return jsxText;
  }
  const originalKey = getLiteralAttributeValue(keyAttr.value as AstNode);
  if (!originalKey) {
    return jsxText;
  }

  const parentIdentity = getDuplicateParentIdentity(nodePath);
  let usedKeys = reservedKeysByParent.get(parentIdentity);
  if (!usedKeys) {
    usedKeys = collectSiblingLiteralKeys(nodePath);
    reservedKeysByParent.set(parentIdentity, usedKeys);
  }

  const newKey = pickUniqueDuplicateKey(originalKey, usedKeys);
  return jsxText.replace(
    new RegExp(`key=(["'])${escapeRegex(originalKey)}\\1`),
    (_match, quote: string) => `key=${quote}${newKey}${quote}`
  );
}

function getTextLikeNodeValue(node: AstNode | null | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "JSXText") {
    return typeof node.value === "string" ? node.value : "";
  }
  if (node.type === "JSXExpressionContainer") {
    const value = getLiteralAttributeValue(node.expression);
    return value ?? "";
  }
  return "";
}

function getLeadingInlineSeparator(text: string): string {
  if (!text) {
    return "";
  }
  const trimmedLeadingWhitespace = text.match(/^[\t\n\f\r ]+/)?.[0] ?? "";
  const remainder = text.slice(trimmedLeadingWhitespace.length);
  if (!remainder) {
    return trimmedLeadingWhitespace;
  }

  const punctuationMatch = remainder.match(/^(?:[,;:/|]\s*)+/)?.[0] ?? "";
  if (punctuationMatch) {
    return trimmedLeadingWhitespace + punctuationMatch;
  }

  return trimmedLeadingWhitespace;
}

function getTrailingInlineSeparator(text: string): string {
  if (!text) {
    return "";
  }
  const trailingWhitespace = text.match(/[\t\n\f\r ]+$/)?.[0] ?? "";
  const prefix = text.slice(0, text.length - trailingWhitespace.length);
  const punctuationMatch = prefix.match(/(?:[,;:/|]\s*)+$/)?.[0] ?? "";
  if (punctuationMatch) {
    return punctuationMatch + trailingWhitespace;
  }
  return trailingWhitespace;
}

function extractInlineDuplicateSeparator(
  source: string,
  nodePath: AstPath
): string {
  const node = nodePath.node as unknown as AstNode;
  const parentChildren = (nodePath.parent?.node as AstNode | undefined)
    ?.children;
  if (!Array.isArray(parentChildren)) {
    return "";
  }

  const nodeIndex = parentChildren.indexOf(node);
  if (nodeIndex === -1) {
    return "";
  }

  const nextSibling = parentChildren[nodeIndex + 1];
  if (nextSibling) {
    const between = source.slice(
      node.end ?? 0,
      nextSibling.start ?? node.end ?? 0
    );
    if (between.length > 0) {
      return between;
    }

    const nextValue = getTextLikeNodeValue(nextSibling);
    const nextSeparator = getLeadingInlineSeparator(nextValue);
    if (nextSeparator) {
      return nextSeparator;
    }
  }

  const previousSibling = parentChildren[nodeIndex - 1];
  if (previousSibling) {
    const between = source.slice(
      previousSibling.end ?? node.start ?? 0,
      node.start ?? 0
    );
    if (between.length > 0) {
      return between;
    }

    const previousValue = getTextLikeNodeValue(previousSibling);
    return getTrailingInlineSeparator(previousValue);
  }

  return "";
}

interface SourceSplice {
  offset: number;
  insert: string;
}

function buildDuplicateSplice(
  source: string,
  nodePath: AstPath,
  reservedKeysByParent: Map<string, Set<string>>
): SourceSplice | null {
  const node = nodePath.node as unknown as AstNode;
  const { start } = node;
  const { end } = node;
  if (
    start === null ||
    start === undefined ||
    end === null ||
    end === undefined
  ) {
    return null;
  }
  const subtreeText = source.slice(start, end);
  const processedText = deduplicateKey(
    subtreeText,
    nodePath,
    reservedKeysByParent
  );

  // Determine if this is an inline child (e.g. <a> inside <p>) or a block-level sibling.
  // Check if the element is on its own line: if the text between the previous newline
  // and the element start is only whitespace, it's block-level and gets newline+indent.
  // Otherwise it's inline and gets inserted with the same separator that follows it.
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const textBeforeOnLine = source.slice(lineStart, start);
  const isBlockLevel = textBeforeOnLine.trim() === "";

  if (isBlockLevel) {
    const indent = textBeforeOnLine;
    return { offset: end, insert: `\n${indent}${processedText}` };
  }

  // Inline element — reuse the separator that currently follows the element
  // so duplicates preserve punctuation and spacing within prose.
  const separator = extractInlineDuplicateSeparator(source, nodePath);

  return { offset: end, insert: separator + processedText };
}

type OpGroup = { index: number; op: BatchOperation }[];

/** Mark every op in a file group as failed with the same error message. */
function failAllOps(
  results: OperationResult[],
  ops: OpGroup,
  file: string,
  error: string
): void {
  for (const { index, op } of ops) {
    results[index] = {
      op: op.op,
      file,
      line: getOpLine(op),
      success: false,
      error,
    };
  }
}

/**
 * Process a single .mdx/.md file's operations (text edits only — structural
 * ops aren't supported for markdown). Mutates `results`/`undoEntries`.
 */
function processMdxFile(
  ops: OpGroup,
  file: string,
  resolvedPath: string,
  source: string,
  results: OperationResult[],
  undoEntries: BatchResult["undoEntries"],
  write: boolean
): void {
  const beforeContent = source;
  logger.info(`[MDX] Processing MDX file: ${resolvedPath}`);
  let currentSource = source;
  let fileHasChanges = false;

  for (const { index, op } of ops) {
    const line = getOpLine(op);

    if (op.op !== "updateText") {
      results[index] = {
        op: op.op,
        file,
        line,
        success: false,
        error: `Operation "${op.op}" is not supported for markdown/MDX files`,
      };
      continue;
    }

    try {
      const result = applyMdxTextEdit(
        currentSource,
        op.line,
        op.col,
        op.originalText,
        op.newText,
        op.cursorOffset,
        op.textAnchor
      );

      logger.info(
        `[MDX] applyMdxTextEdit result: changed=${result.changed}, error=${result.error || "none"}, originalText="${op.originalText?.slice(0, 40)}", newText="${op.newText?.slice(0, 40)}"`
      );

      if (result.error) {
        results[index] = {
          op: op.op,
          file,
          line,
          success: false,
          error: result.error,
        };
        continue;
      }

      currentSource = result.source;
      fileHasChanges ||= result.changed;
      results[index] = {
        op: op.op,
        file,
        line,
        success: result.changed,
        error: result.changed
          ? undefined
          : "Text matched but no change produced",
      };
    } catch (error) {
      results[index] = {
        op: op.op,
        file,
        line,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!fileHasChanges) {
    return;
  }
  try {
    if (write) fs.writeFileSync(resolvedPath, currentSource, "utf-8");
    undoEntries.push({
      filePath: resolvedPath,
      content: beforeContent,
      afterContent: currentSource,
    });
  } catch (error) {
    failAllOps(
      results,
      ops,
      file,
      `Failed to write file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Phase 0: apply `duplicateElement` splices at the source-text level before
 * parsing for the remaining ops (duplication is a text splice, not an AST
 * mutation, so it must happen first and re-parsing picks up the new nodes).
 * Returns the (possibly spliced) source and whether any non-duplicate ops
 * remain to be processed against a fresh parse.
 */
function applyDuplicateSplices(
  duplicateOps: OpGroup,
  file: string,
  resolvedPath: string,
  source: string,
  results: OperationResult[]
): string {
  const { j: jDup, root: rootDup } = parseSource(source, resolvedPath);
  const splices: SourceSplice[] = [];
  const reservedKeysByParent = new Map<string, Set<string>>();

  for (const { index, op } of duplicateOps) {
    const line = getOpLine(op);
    const tempResolved = resolveNodes(
      jDup,
      rootDup,
      [{ index, op }],
      resolvedPath
    );
    const [rop] = tempResolved;
    if (!rop || rop.error || !rop.node) {
      results[index] = {
        op: op.op,
        file,
        line,
        success: false,
        error: rop?.error ?? "Could not resolve element for duplication",
      };
      continue;
    }
    const splice = buildDuplicateSplice(source, rop.node, reservedKeysByParent);
    if (!splice) {
      results[index] = {
        op: op.op,
        file,
        line,
        success: false,
        error: "Could not extract source range for duplication",
      };
      continue;
    }
    splices.push(splice);
    results[index] = { op: op.op, file, line, success: true };
  }

  splices.sort((a, b) => b.offset - a.offset);
  let splicedSource = source;
  for (const splice of splices) {
    splicedSource =
      splicedSource.slice(0, splice.offset) +
      splice.insert +
      splicedSource.slice(splice.offset);
  }
  return splicedSource;
}

/**
 * Phases 1-5 for a single non-MDX file: resolve nodes, coalesce same-node
 * ops, sort by priority, apply mutations, backfill merged-op results, and
 * serialize + write once if anything changed. Mutates `results`/`undoEntries`.
 */
function processJsxFile(
  operations: BatchOperation[],
  opsToResolve: OpGroup,
  allFileOps: OpGroup,
  file: string,
  resolvedPath: string,
  source: string,
  results: OperationResult[],
  undoEntries: BatchResult["undoEntries"],
  write: boolean
): void {
  const beforeContent = source;
  const { j, root, quoteStyle } = parseSource(source, resolvedPath);

  // Phase 1: Resolve all nodes against the (potentially modified) AST
  const resolved = resolveNodes(j, root, opsToResolve, resolvedPath);

  // Phase 2: Coalesce same-node operations
  const coalesced = coalesceOps(resolved);

  // Phase 3: Sort by priority (non-structural first, structural bottom-up)
  coalesced.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Within same priority, structural ops go bottom-up (highest line first)
    if (a.priority === 1) {
      return getOpLine(b.op) - getOpLine(a.op);
    }
    return 0;
  });

  // Phase 4: Apply mutations
  let fileHasChanges = false;

  for (const rop of coalesced) {
    const line = getOpLine(rop.op);

    if (rop.error) {
      results[rop.index] = {
        op: rop.op.op,
        file,
        line,
        success: false,
        error: rop.error,
        candidates: candidatePathsToLocations(
          rop.ambiguousCandidates,
          beforeContent
        ),
      };
      continue;
    }

    try {
      const error = applyOp(j, root, rop, beforeContent);
      if (error) {
        results[rop.index] = {
          op: rop.op.op,
          file,
          line,
          success: false,
          error,
        };
      } else {
        results[rop.index] = { op: rop.op.op, file, line, success: true };
        fileHasChanges = true;
      }
    } catch (error) {
      results[rop.index] = {
        op: rop.op.op,
        file,
        line,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Fill in results for merged ops (they succeed if the primary succeeded)
  for (let i = 0; i < operations.length; i += 1) {
    if (results[i] === undefined && operations[i].file === file) {
      // This was a merged-away op — mark success
      const op = operations[i];
      results[i] = { op: op.op, file, line: getOpLine(op), success: true };
    }
  }

  // Phase 5: Serialize once and write
  if (!fileHasChanges) {
    return;
  }
  try {
    const afterContent = root.toSource({ quote: quoteStyle });
    if (write) fs.writeFileSync(resolvedPath, afterContent, "utf-8");
    undoEntries.push({
      filePath: resolvedPath,
      content: beforeContent,
      afterContent,
    });
  } catch (error) {
    // Serialization/write failed — mark all ops for this file as failed
    failAllOps(
      results,
      allFileOps,
      file,
      `Failed to write file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Process one file's operation group atomically. Mutates `results`/`undoEntries`. */
function processFile(
  operations: BatchOperation[],
  file: string,
  ops: OpGroup,
  projectRoot: string,
  results: OperationResult[],
  undoEntries: BatchResult["undoEntries"],
  write: boolean
): void {
  if (!isProjectFilePathSafe(file, projectRoot)) {
    failAllOps(results, ops, file, "File path is outside the project root");
    return;
  }

  const resolvedPath = resolveProjectFilePath(file, projectRoot);
  if (!resolvedPath) {
    failAllOps(results, ops, file, "Could not resolve file path");
    return;
  }

  let source: string;
  try {
    source = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    failAllOps(
      results,
      ops,
      file,
      `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  if (isMdxTextFile(resolvedPath)) {
    processMdxFile(ops, file, resolvedPath, source, results, undoEntries, write);
    return;
  }

  const beforeContent = source;

  // Phase 0: Apply duplicateElement splices BEFORE parsing for other ops.
  const duplicateOps = ops.filter((o) => o.op.op === "duplicateElement");
  const nonDuplicateOps = ops.filter((o) => o.op.op !== "duplicateElement");

  if (duplicateOps.length > 0) {
    source = applyDuplicateSplices(
      duplicateOps,
      file,
      resolvedPath,
      source,
      results
    );
    if (nonDuplicateOps.length === 0) {
      if (source !== beforeContent) {
        try {
          if (write) fs.writeFileSync(resolvedPath, source, "utf-8");
          undoEntries.push({
            filePath: resolvedPath,
            content: beforeContent,
            afterContent: source,
          });
        } catch (error) {
          failAllOps(
            results,
            duplicateOps,
            file,
            `Failed to write file: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      return;
    }
  }

  processJsxFile(
    operations,
    nonDuplicateOps.length > 0 ? nonDuplicateOps : ops,
    ops,
    file,
    resolvedPath,
    source,
    results,
    undoEntries,
    write
  );
}

export function executeBatch(
  operations: BatchOperation[],
  projectRoot: string,
  options: ExecuteBatchOptions = {}
): BatchResult {
  const write = options.write ?? true;
  const results: OperationResult[] = Array.from({ length: operations.length });
  const undoEntries: BatchResult["undoEntries"] = [];

  // Group operations by file
  const byFile = new Map<string, OpGroup>();

  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i];
    const { file } = op;
    const group = byFile.get(file) ?? [];
    group.push({ index: i, op });
    byFile.set(file, group);
  }

  // Process each file atomically
  for (const [file, ops] of byFile) {
    processFile(operations, file, ops, projectRoot, results, undoEntries, write);
  }

  // ── MDX fallback: redirect text edits that targeted JSX wrappers ──────
  // When MDX content is compiled and imported by a JSX file, the overlay
  // resolves to the JSX wrapper (e.g., BlogPost.jsx) instead of the .mdx
  // source. Detect this and retry against the actual MDX file.
  if (!write) return { results, undoEntries };
  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i];
    if (op.op !== "updateText") {
      continue;
    }

    const resolvedPath = resolveProjectFilePath(op.file, projectRoot);
    if (!resolvedPath || isMdxTextFile(resolvedPath)) {
      continue;
    } // already handled by MDX path

    // Check if the JSX transform actually modified the right text, or if
    // it matched a coincidental string literal in the wrapper file
    const currentContent = (() => {
      try {
        return fs.readFileSync(resolvedPath, "utf-8");
      } catch {
        return null;
      }
    })();
    if (!currentContent) {
      continue;
    }

    // If the original text doesn't appear in the JSX source, the JSX transform
    // matched something it shouldn't have — revert and try MDX
    const originalTextNormalized = op.originalText
      .replaceAll(/\s+/g, " ")
      .trim();
    const sourceHasText = currentContent
      .replaceAll(/\s+/g, " ")
      .includes(originalTextNormalized);

    // Also check: if the result was a failure, try MDX fallback
    const resultFailed = !results[i]?.success;

    if (resultFailed || !sourceHasText) {
      const mdxFile = findImportedMdxFileContainingText(
        resolvedPath,
        op.originalText,
        projectRoot
      );
      if (mdxFile) {
        logger.info(
          `[MDX fallback] Redirecting text edit from ${op.file} → ${mdxFile}`
        );
        try {
          const mdxSource = fs.readFileSync(mdxFile, "utf-8");
          const mdxBefore = mdxSource;
          const mdxResult = applyMdxTextEdit(
            mdxSource,
            op.line,
            op.col,
            op.originalText,
            op.newText,
            op.cursorOffset,
            op.textAnchor
          );

          logger.info(
            `[MDX fallback] result: changed=${mdxResult.changed}, error=${mdxResult.error || "none"}`
          );

          if (mdxResult.error) {
            results[i] = {
              op: op.op,
              file: mdxFile,
              line: op.line,
              success: false,
              error: mdxResult.error,
            };
          } else if (mdxResult.changed) {
            fs.writeFileSync(mdxFile, mdxResult.source, "utf-8");
            undoEntries.push({
              filePath: mdxFile,
              content: mdxBefore,
              afterContent: mdxResult.source,
            });
            results[i] = {
              op: op.op,
              file: mdxFile,
              line: op.line,
              success: true,
            };
          } else {
            results[i] = {
              op: op.op,
              file: mdxFile,
              line: op.line,
              success: false,
              error: "Text found in MDX but no change produced",
            };
          }
        } catch (error) {
          results[i] = {
            op: op.op,
            file: mdxFile,
            line: op.line,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
  }

  return { results, undoEntries };
}
