import * as fs from "node:fs";
import path from "node:path";

import type { SiblingInfo, TextEditAnchor } from "@themelab/shared";
import jscodeshift from "jscodeshift";

import { logger } from "./logger.js";
import { detectQuoteStyle } from "./utils.js";

/** jscodeshift's bound-to-parser API object (what `j` refers to everywhere below). */
type J = jscodeshift.JSCodeshift;
/** A jscodeshift traversal collection. Left ungenericized (defaults to the
 *  library's own `any` internally) since collections here hold mixed node
 *  shapes resolved dynamically by line/col rather than by static type. */
type Root = jscodeshift.Collection;
/** An AST path for a node of type `N` (defaults to the general ASTNode union). */
type NodePath<N = jscodeshift.ASTNode> = jscodeshift.ASTPath<N>;
/** The union of node shapes that can appear in a JSX children array. */
type JSXChild = NonNullable<jscodeshift.JSXElement["children"]>[number];

/** Minimal shape for source-position helpers that only need a node's
 *  recast-assigned char offsets and/or line:column location — not its full
 *  AST shape. */
interface PositionedNode {
  start?: number | null;
  end?: number | null;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
}

/** Collapse all whitespace runs (including newlines) to a single space. */
function normalizeWs(s: string): string {
  return s.replaceAll(/\s+/g, " ");
}

/** Collapse all rendered-whitespace runs (tabs/newlines/spaces) to a single
 *  space — used to compare JSX source text against DOM textContent, which
 *  React collapses the same way. */
function collapseRenderedWhitespace(value: string): string {
  return value.replaceAll(/[\t\n\f\r ]+/g, " ");
}

export function getParser(filePath: string): string {
  const ext = path.extname(filePath);
  return ext === ".tsx" || ext === ".ts" ? "tsx" : "babel";
}

// ── I/O-free helpers (used by both single-op wrappers and batch engine) ──

/**
 * Parse source code into a jscodeshift Collection.
 * Pure function — no file I/O.
 */
export function parseSource(source: string, filePath: string) {
  const parser = getParser(filePath);
  const j = jscodeshift.withParser(parser);
  const root = j(source);
  const quoteStyle = detectQuoteStyle(source);
  return { j, root, quoteStyle };
}

/**
 * Find a JSXElement at a given line:col in the AST.
 * Returns the ASTPath or null.
 */
export function findJSXElementAt(
  j: J,
  root: Root,
  line: number,
  col: number
): NodePath<jscodeshift.JSXElement> | null {
  let target: NodePath<jscodeshift.JSXElement> | null = null;
  for (const p of root.find(j.JSXElement).paths()) {
    const { loc } = p.node.openingElement;
    if (loc && loc.start.line === line && loc.start.column === col) {
      target = p;
    }
  }
  return target;
}

/**
 * Find the JSX element whose opening tag is on `line`, preferring an exact
 * column but falling back to the nearest element on that line. Used for
 * AI-resolved locations, where the column may drift a little and the tag may
 * legitimately differ from the DOM (e.g. a <Link> that renders an <a>).
 */
export function findJSXElementAtLine(
  j: J,
  root: Root,
  line: number,
  col: number
): NodePath<jscodeshift.JSXElement> | null {
  let exact: NodePath<jscodeshift.JSXElement> | null = null;
  let best: NodePath<jscodeshift.JSXElement> | null = null;
  let bestDelta = Infinity;
  for (const p of root.find(j.JSXElement).paths()) {
    const loc = p.node.openingElement?.loc;
    if (!loc || loc.start.line !== line) {
      continue;
    }
    if (loc.start.column === col) {
      exact = p;
      continue;
    }
    const d = Math.abs(loc.start.column - col);
    if (d < bestDelta) {
      bestDelta = d;
      best = p;
    }
  }
  return exact ?? best;
}

/**
 * Swap the array element at line/col with its neighbor (up = previous, down =
 * next). Used to reorder a .map()-rendered list by its source data array.
 * Mutates the AST in place. Throws if the element or a neighbor isn't found.
 */
export function swapArrayElementAt(
  j: J,
  root: Root,
  line: number,
  col: number,
  direction: "up" | "down"
): void {
  let arr: jscodeshift.ArrayExpression | null = null;
  let idx = -1;
  for (const p of root.find(j.ArrayExpression).paths()) {
    const els = p.node.elements ?? [];
    for (let i = 0; i < els.length; i += 1) {
      const el = els[i];
      const loc = el?.loc;
      if (loc && loc.start.line <= line && line <= loc.end.line) {
        arr = p.node;
        idx = i;
      }
    }
  }
  if (!arr || idx < 0) {
    throw new Error("Could not find the array element to reorder.");
  }
  const arrNode: jscodeshift.ArrayExpression = arr;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= arrNode.elements.length) {
    throw new Error(
      direction === "up"
        ? "Already the first item in the list."
        : "Already the last item in the list."
    );
  }
  const tmp = arrNode.elements[idx];
  arrNode.elements[idx] = arrNode.elements[swap];
  arrNode.elements[swap] = tmp;
}

/**
 * Reorder JSX siblings by swapping elements at the given lines.
 * Mutates the AST in place — no I/O.
 */
/** Climb from `nodePath` to the ancestor that is a direct child of a parent
 *  holding a `children` array (i.e. the node that can be repositioned within
 *  its siblings). Returns `nodePath` itself if no such ancestor is found. */
function getMovableNode(nodePath: NodePath): NodePath {
  let current = nodePath;
  while (current.parent) {
    const parentNode = current.parent.node as { children?: unknown[] };
    if (parentNode.children && parentNode.children.includes(current.node)) {
      return current;
    }
    current = current.parent;
  }
  return nodePath;
}

/** Find, within `collection`, the JSXElement/JSXFragment path whose opening
 *  tag starts at `line`. */
function findJSXOrFragmentAtLine(
  collection: Root,
  line: number
): NodePath<jscodeshift.JSXElement | jscodeshift.JSXFragment> | null {
  let found: NodePath<jscodeshift.JSXElement | jscodeshift.JSXFragment> | null =
    null;
  for (const p of collection.paths()) {
    const node = p.node as jscodeshift.JSXElement | jscodeshift.JSXFragment;
    const startLine =
      "openingElement" in node
        ? node.openingElement.loc?.start.line
        : node.openingFragment?.loc?.start.line;
    if (startLine === line) {
      found = p;
    }
  }
  return found;
}

/** Remove the child at `index`, also removing an immediately preceding
 *  JSXText whitespace node (if any) so indentation stays balanced. Returns
 *  the removed whitespace node for re-insertion at the destination. */
function removeChildPreservingLeadingWhitespace(
  children: jscodeshift.ASTNode[],
  index: number
): jscodeshift.ASTNode | null {
  const whitespace =
    index > 0 && children[index - 1]?.type === "JSXText"
      ? children[index - 1]
      : null;
  if (whitespace) {
    children.splice(index - 1, 2);
  } else {
    children.splice(index, 1);
  }
  return whitespace;
}

/** Insert `node` (with its optional leading `whitespace` node) immediately
 *  before `before` in `children`, inserting ahead of `before`'s own leading
 *  whitespace so indentation stays balanced. */
function insertChildBeforePreservingWhitespace(
  children: jscodeshift.ASTNode[],
  node: jscodeshift.ASTNode,
  before: jscodeshift.ASTNode,
  whitespace: jscodeshift.ASTNode | null
): void {
  const beforeIndex = children.indexOf(before);
  const insertIndex =
    beforeIndex > 0 && children[beforeIndex - 1]?.type === "JSXText"
      ? beforeIndex - 1
      : beforeIndex;
  if (whitespace) {
    children.splice(insertIndex, 0, whitespace, node);
  } else {
    children.splice(insertIndex, 0, node);
  }
}

export function mutateReorder(
  j: J,
  root: Root,
  fromLine: number,
  toLine: number
): void {
  const jsxElements = root.find(j.JSXElement);
  const jsxFragments = root.find(j.JSXFragment);

  const fromNode =
    findJSXOrFragmentAtLine(jsxElements, fromLine) ||
    findJSXOrFragmentAtLine(jsxFragments, fromLine);
  const toNode =
    findJSXOrFragmentAtLine(jsxElements, toLine) ||
    findJSXOrFragmentAtLine(jsxFragments, toLine);

  if (!fromNode) {
    throw new Error(
      `Component not found at line ${fromLine}. If you have unsaved changes in your editor, save your files and try again.`
    );
  }
  if (!toNode) {
    throw new Error(
      `Component not found at line ${toLine}. If you have unsaved changes in your editor, save your files and try again.`
    );
  }

  const fromMovable = getMovableNode(fromNode);
  const toMovable = getMovableNode(toNode);

  const fromParent = fromMovable.parent;
  const toParent = toMovable.parent;

  const fromParentNode = fromParent?.node as
    | { children?: jscodeshift.ASTNode[] }
    | undefined;
  const toParentNode = toParent?.node as
    | { children?: jscodeshift.ASTNode[] }
    | undefined;

  if (!fromParent || !fromParentNode?.children) {
    throw new Error("Elements are not siblings in the same parent container");
  }

  const { children } = fromParentNode;
  const fromIndex = children.indexOf(fromMovable.node);
  const toIndex = children.indexOf(toMovable.node);

  if (fromIndex === -1 || toIndex === -1 || fromParentNode !== toParentNode) {
    throw new Error("Elements are not siblings in the same parent");
  }

  const fromWhitespace = removeChildPreservingLeadingWhitespace(
    children,
    fromIndex
  );
  insertChildBeforePreservingWhitespace(
    children,
    fromMovable.node,
    toMovable.node,
    fromWhitespace
  );
}

export function reorderComponent(
  filePath: string,
  fromLine: number,
  toLine: number
): string {
  const source = fs.readFileSync(filePath, "utf-8");
  const { j, root, quoteStyle } = parseSource(source, filePath);

  mutateReorder(j, root, fromLine, toLine);
  return root.toSource({ quote: quoteStyle });
}

/** True for child nodes that count as a reorderable sibling (an element, a
 *  fragment, or a conditionally-rendered element) — i.e. not whitespace/text. */
function isReorderableSibling(node: JSXChild | null | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node.type === "JSXElement" || node.type === "JSXFragment") {
    return true;
  }
  if (node.type === "JSXExpressionContainer") {
    const expr = node.expression;
    return (
      expr?.type === "JSXElement" ||
      expr?.type === "JSXFragment" ||
      expr?.type === "LogicalExpression" ||
      expr?.type === "ConditionalExpression"
    );
  }
  return false;
}

/**
 * Move a resolved JSX element node one position up or down among its real AST
 * siblings (whitespace/text ignored). Mutates the AST in place — no I/O.
 * `node` is a jscodeshift ASTPath (e.g. from the batch resolver or findJSXElementAt).
 * Throws a friendly Error at the boundaries or when there's no sibling container.
 */
export function swapWithAdjacentSibling(
  node: NodePath,
  direction: "up" | "down"
): void {
  // Climb to the node that is a direct child of a parent holding a children array.
  let movable = node;
  while (movable.parent) {
    const parentNode = movable.parent.node as { children?: JSXChild[] };
    if (
      parentNode.children &&
      parentNode.children.includes(movable.node as JSXChild)
    ) {
      break;
    }
    movable = movable.parent;
  }

  const { parent } = movable;
  const parentChildren = parent?.node as { children?: JSXChild[] } | undefined;
  if (!parent || !parentChildren?.children) {
    throw new Error("This element has no sibling container to reorder within.");
  }
  const { children } = parentChildren;

  // Indices (within the full children array, including whitespace) of the
  // reorderable element siblings, in document order.
  const elementIndices: number[] = [];
  for (const [i, c] of children.entries()) {
    if (isReorderableSibling(c)) {
      elementIndices.push(i);
    }
  }

  const fromChildIdx = children.indexOf(movable.node as JSXChild);
  const pos = elementIndices.indexOf(fromChildIdx);
  if (pos === -1) {
    throw new Error("Could not locate this element among its siblings.");
  }

  const swapPos = direction === "up" ? pos - 1 : pos + 1;
  if (swapPos < 0 || swapPos >= elementIndices.length) {
    throw new Error(
      direction === "up"
        ? "Already the first sibling."
        : "Already the last sibling."
    );
  }
  const toChildIdx = elementIndices[swapPos];

  // Swap only the two element nodes — leave the JSXText whitespace nodes in
  // their slots so indentation and line breaks are preserved.
  const tmp = children[fromChildIdx];
  children[fromChildIdx] = children[toChildIdx];
  children[toChildIdx] = tmp;
}

/**
 * Move the JSX element whose opening tag starts at `line` up/down among its
 * siblings — line-based resolution (used by tests; production uses the batch
 * resolver's jsxPath/fuzzy node, see batch-transform's "moveSibling" op).
 */
export function mutateMoveSibling(
  j: J,
  root: Root,
  line: number,
  direction: "up" | "down"
): void {
  let target: NodePath | null = null;
  for (const p of root.find(j.JSXElement).paths()) {
    if (!target && p.node.openingElement.loc?.start.line === line) {
      target = p;
    }
  }
  if (!target) {
    for (const p of root.find(j.JSXFragment).paths()) {
      if (!target && p.node.openingFragment?.loc?.start.line === line) {
        target = p;
      }
    }
  }
  if (!target) {
    throw new Error(
      `No JSX element found at line ${line}. If you have unsaved changes in your editor, save your files and try again.`
    );
  }
  swapWithAdjacentSibling(target, direction);
}

export function moveSiblingComponent(
  filePath: string,
  line: number,
  direction: "up" | "down"
): string {
  const source = fs.readFileSync(filePath, "utf-8");
  const { j, root, quoteStyle } = parseSource(source, filePath);

  mutateMoveSibling(j, root, line, direction);
  return root.toSource({ quote: quoteStyle });
}

/** Resolve a JSX element's tag name for display (e.g. "Navbar", "Ns.Comp"). */
function getJSXElementName(el: jscodeshift.JSXElement): string {
  const { name } = el.openingElement;
  if (name.type === "JSXIdentifier") {
    return name.name;
  }
  if (name.type === "JSXMemberExpression") {
    const objectName =
      name.object.type === "JSXIdentifier" ? name.object.name : "Unknown";
    return `${objectName}.${name.property.name}`;
  }
  return "Unknown";
}

/** Find the JSXElement/JSXFragment path whose opening tag starts at `line`. */
function findParentContainerAtLine(
  j: J,
  root: Root,
  line: number
): NodePath<jscodeshift.JSXElement | jscodeshift.JSXFragment> | null {
  for (const p of root.find(j.JSXElement).paths()) {
    if (p.node.openingElement.loc?.start.line === line) {
      return p;
    }
  }
  for (const p of root.find(j.JSXFragment).paths()) {
    if (p.node.openingFragment?.loc?.start.line === line) {
      return p;
    }
  }
  return null;
}

/** Sibling info for a single JSX child, if it renders one (an element
 *  directly, or the JSX-producing branch of `&&`/`? :`). */
function siblingInfoForChild(child: JSXChild): SiblingInfo | null {
  if (child.type === "JSXElement") {
    return {
      componentName: getJSXElementName(child),
      lineNumber: child.openingElement.loc?.start.line ?? 0,
    };
  }
  if (child.type !== "JSXExpressionContainer") {
    return null;
  }
  // Look inside for JSX elements (e.g., {cond && <Comp />})
  const { expression: expr } = child;
  if (expr.type === "LogicalExpression" && expr.right?.type === "JSXElement") {
    return {
      componentName: getJSXElementName(expr.right),
      lineNumber: child.loc?.start.line ?? 0,
    };
  }
  if (expr.type === "ConditionalExpression") {
    // {cond ? <A /> : <B />} — treat as a single sibling
    const { consequent } = expr;
    if (consequent?.type === "JSXElement") {
      return {
        componentName: getJSXElementName(consequent),
        lineNumber: child.loc?.start.line ?? 0,
      };
    }
  }
  return null;
}

export function getSiblings(
  filePath: string,
  parentLine: number
): SiblingInfo[] {
  const source = fs.readFileSync(filePath, "utf-8");
  const parser = getParser(filePath);
  const j = jscodeshift.withParser(parser);
  const root = j(source);

  const parentNode = findParentContainerAtLine(j, root, parentLine);
  if (!parentNode) {
    throw new Error(`No JSX element found at line ${parentLine}`);
  }

  const siblings: SiblingInfo[] = [];
  const children = (parentNode as NodePath<jscodeshift.JSXElement>).node
    .children as JSXChild[];

  for (const child of children) {
    // Skip JSXText (whitespace), JSXSpreadChild, etc.
    const sibling = siblingInfoForChild(child);
    if (sibling) {
      siblings.push(sibling);
    }
  }

  return siblings;
}

// ── updateClassName ─────────────────────────────────────────────────────

export interface ClassNameUpdate {
  tailwindPrefix: string;
  tailwindToken: string | null;
  value: string;
  relatedPrefixes?: string[];
  classPattern?: string;
  standalone?: boolean;
  /** Responsive breakpoint variant to target (e.g. "md"); base class if omitted. */
  variant?: string;
}

const SHORTHAND_SPLITS: Record<
  string,
  { sides: string[]; extractToken: (cls: string) => string }
> = {
  p: {
    sides: ["pt", "pr", "pb", "pl"],
    extractToken: (cls) => cls.replace(/^p-/, ""),
  },
  px: {
    sides: ["pl", "pr"],
    extractToken: (cls) => cls.replace(/^px-/, ""),
  },
  py: {
    sides: ["pt", "pb"],
    extractToken: (cls) => cls.replace(/^py-/, ""),
  },
  m: {
    sides: ["mt", "mr", "mb", "ml"],
    extractToken: (cls) => cls.replace(/^m-/, ""),
  },
  mx: {
    sides: ["ml", "mr"],
    extractToken: (cls) => cls.replace(/^mx-/, ""),
  },
  my: {
    sides: ["mt", "mb"],
    extractToken: (cls) => cls.replace(/^my-/, ""),
  },
  rounded: {
    sides: ["rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
    extractToken: (cls) =>
      cls === "rounded" ? "DEFAULT" : cls.replace(/^rounded-/, ""),
  },
  "rounded-t": {
    sides: ["rounded-tl", "rounded-tr"],
    extractToken: (cls) =>
      cls === "rounded-t" ? "DEFAULT" : cls.replace(/^rounded-t-/, ""),
  },
  "rounded-r": {
    sides: ["rounded-tr", "rounded-br"],
    extractToken: (cls) =>
      cls === "rounded-r" ? "DEFAULT" : cls.replace(/^rounded-r-/, ""),
  },
  "rounded-b": {
    sides: ["rounded-br", "rounded-bl"],
    extractToken: (cls) =>
      cls === "rounded-b" ? "DEFAULT" : cls.replace(/^rounded-b-/, ""),
  },
  "rounded-l": {
    sides: ["rounded-tl", "rounded-bl"],
    extractToken: (cls) =>
      cls === "rounded-l" ? "DEFAULT" : cls.replace(/^rounded-l-/, ""),
  },
};

/**
 * Tailwind responsive breakpoint variants — used only to give stacked variants a
 * stable written order (dark first, then breakpoint, then anything else).
 */
const RESPONSIVE_VARIANTS = new Set(["sm", "md", "lg", "xl", "2xl"]);

/**
 * Split a class into its leading variant tokens and the bare utility, ignoring
 * any ":" inside an arbitrary value (`bg-[url(a:b)]`). The last colon-delimited
 * segment outside brackets is the utility; everything before it is a variant.
 *   "dark:md:bg-red-500" → { variants: ["dark","md"], utility: "bg-red-500" }
 *   "bg-[url(http://x)]"  → { variants: [],            utility: "bg-[url(http://x)]" }
 */
function decomposeClass(cls: string): { variants: string[]; utility: string } {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i += 1) {
    const ch = cls[i];
    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (ch === ":" && depth === 0) {
      segments.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(cls.slice(start));
  const utility = segments.pop() ?? "";
  return { variants: segments, utility };
}

/** Parse an update's `variant` string ("dark:md") into its token list. */
function parseVariantTokens(variant?: string): string[] {
  return variant ? variant.split(":").filter(Boolean) : [];
}

/** Canonical variant prefix for a token set: dark, then breakpoints, then rest. */
function canonicalVariantPrefix(tokens: string[]): string {
  if (tokens.length === 0) {
    return "";
  }
  const rank = (t: string) => {
    if (t === "dark") {
      return 0;
    }
    return RESPONSIVE_VARIANTS.has(t) ? 1 : 2;
  };
  return (
    [...tokens]
      // oxlint-disable-next-line unicorn/no-array-sort -- toSorted needs the ES2023 lib (tsconfig targets ES2022); sorting a fresh spread copy, not the input
      .sort((a, b) => rank(a) - rank(b))
      .map((t) => `${t}:`)
      .join("")
  );
}

/** Order-independent set equality for variant tokens ("dark:md" ≡ "md:dark"). */
function sameVariantSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setB = new Set(b);
  return a.every((t) => setB.has(t));
}

/**
 * Build the target class string from an update descriptor, writing any variant
 * tokens in canonical order (e.g. "dark:md:bg-red-500").
 */
function buildClass(update: ClassNameUpdate): string {
  let base: string;
  if (update.standalone) {
    base = update.tailwindToken ?? `${update.tailwindPrefix}-[${update.value}]`;
  } else if (update.tailwindToken) {
    base = `${update.tailwindPrefix}-${update.tailwindToken}`;
  } else {
    base = `${update.tailwindPrefix}-[${update.value}]`;
  }
  return canonicalVariantPrefix(parseVariantTokens(update.variant)) + base;
}

/** Match a *bare* utility (no variants) against a prefix: "p" matches "p-4", "p". */
function utilityMatchesPrefix(utility: string, prefix: string): boolean {
  if (utility === prefix) {
    return true;
  }
  return utility.startsWith(`${prefix}-`);
}

/**
 * Check whether a class matches a given Tailwind prefix at the *base* layer
 * (no variant tokens). E.g. "p" matches "p-4" but never "md:p-4" or "dark:p-4".
 */
function classMatchesPrefix(cls: string, prefix: string): boolean {
  const { variants, utility } = decomposeClass(cls);
  if (variants.length > 0) {
    return false;
  }
  return utilityMatchesPrefix(utility, prefix);
}

/**
 * Variant-aware prefix match. Matches a class iff its variant-token *set* equals
 * the update's (order-independent, so "dark:md:" ≡ "md:dark:") and the bare
 * utility matches `prefix`. With no variant, matches base classes only.
 */
function classMatchesPrefixVariant(
  cls: string,
  prefix: string,
  variant?: string
): boolean {
  const { variants, utility } = decomposeClass(cls);
  if (!sameVariantSet(variants, parseVariantTokens(variant))) {
    return false;
  }
  return utilityMatchesPrefix(utility, prefix);
}

/** Test a classPattern against a class, honoring the update's variant set. */
function classMatchesPattern(
  cls: string,
  pattern: string,
  variant?: string
): boolean {
  const { variants, utility } = decomposeClass(cls);
  if (!sameVariantSet(variants, parseVariantTokens(variant))) {
    return false;
  }
  return new RegExp(pattern).test(utility);
}

/**
 * Apply a single update to an array of class strings.
 * Returns the modified array.
 */
function applyUpdate(classes: string[], update: ClassNameUpdate): string[] {
  const newClass = buildClass(update);
  const result = [...classes];

  const variantPrefix = canonicalVariantPrefix(
    parseVariantTokens(update.variant)
  );

  // 1. Check relatedPrefixes for shorthand splitting
  for (const relatedPrefix of update.relatedPrefixes ?? []) {
    const existingIdx = result.findIndex((c) =>
      classMatchesPrefixVariant(c, relatedPrefix, update.variant)
    );
    if (existingIdx === -1) {
      continue;
    }

    const existingCls = result[existingIdx];
    const split = SHORTHAND_SPLITS[relatedPrefix];
    if (!split) {
      continue;
    }

    // Extract the token from the (de-variant-ed) shorthand class, e.g. md:p-4 → 4.
    // Decompose so the variant order in the existing class doesn't matter.
    const bareExisting = decomposeClass(existingCls).utility;
    const token = split.extractToken(bareExisting);
    // Remove the shorthand class
    result.splice(existingIdx, 1);
    // Insert individual side classes, replacing the edited side with the new value.
    // Untouched sides keep the same variant prefix so responsiveness is preserved.
    const expansions: string[] = [];
    for (const side of split.sides) {
      if (side === update.tailwindPrefix) {
        expansions.push(newClass);
      } else {
        expansions.push(
          `${variantPrefix}${token === "DEFAULT" ? side : `${side}-${token}`}`
        );
      }
    }
    result.splice(existingIdx, 0, ...expansions);
    return result;
  }

  // 2. Find and replace existing class with same prefix (and matching variant)
  const directIdx = result.findIndex((c) =>
    update.classPattern
      ? classMatchesPattern(c, update.classPattern, update.variant)
      : classMatchesPrefixVariant(c, update.tailwindPrefix, update.variant)
  );

  if (directIdx === -1) {
    result.push(newClass);
  } else {
    result[directIdx] = newClass;
  }

  return result;
}

/**
 * Apply updates to a class string (space-separated list of classes).
 */
function updateClassString(
  classStr: string,
  updates: ClassNameUpdate[]
): string {
  let classes = classStr.split(/\s+/).filter(Boolean);
  for (const update of updates) {
    classes = applyUpdate(classes, update);
  }
  return classes.join(" ");
}

/**
 * Check if a cn()/clsx() call has the prefix in a conditional argument.
 */
function classStringMatchesPrefix(value: string, prefix: string): boolean {
  return value.split(/\s+/).some((c) => classMatchesPrefix(c, prefix));
}

/** `active && "bg-blue-500"` */
function logicalExpressionConflicts(
  arg: jscodeshift.LogicalExpression,
  prefix: string
): boolean {
  return (
    arg.right?.type === "StringLiteral" &&
    classStringMatchesPrefix(arg.right.value, prefix)
  );
}

/** `active ? "bg-blue-500" : "bg-red-500"` */
function conditionalExpressionConflicts(
  arg: jscodeshift.ConditionalExpression,
  prefix: string
): boolean {
  for (const branch of [arg.consequent, arg.alternate]) {
    if (
      branch?.type === "StringLiteral" &&
      classStringMatchesPrefix(branch.value, prefix)
    ) {
      return true;
    }
  }
  return false;
}

/** `clsx({ "gap-4": cond })` — keys are the class names */
function objectExpressionConflicts(
  arg: jscodeshift.ObjectExpression,
  prefix: string
): boolean {
  for (const prop of arg.properties ?? []) {
    if (!("computed" in prop) || prop.computed || !("key" in prop)) {
      continue;
    }
    const { key } = prop;
    let keyStr: string | null = null;
    if (key?.type === "StringLiteral") {
      keyStr = key.value;
    } else if (key?.type === "Identifier") {
      keyStr = key.name;
    }
    if (keyStr && classStringMatchesPrefix(keyStr, prefix)) {
      return true;
    }
  }
  return false;
}

function checkConflictingConditional(
  args: jscodeshift.ASTNode[],
  prefix: string
): boolean {
  for (const arg of args) {
    if (
      arg.type === "LogicalExpression" &&
      logicalExpressionConflicts(arg, prefix)
    ) {
      return true;
    }
    if (
      arg.type === "ConditionalExpression" &&
      conditionalExpressionConflicts(arg, prefix)
    ) {
      return true;
    }
    if (
      arg.type === "ObjectExpression" &&
      objectExpressionConflicts(arg, prefix)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Apply className updates to a JSX element node.
 * Mutates the AST in place — no I/O. The `j` parameter is the jscodeshift API instance.
 * Throws on dynamic className or conflicting conditional classes.
 */
/** True if any class in `classes` matches an update's prefix (or its related
 *  prefixes, or its custom classPattern regex). */
function updateMatchesAnyClass(
  update: ClassNameUpdate,
  classes: string[]
): boolean {
  const allPrefixes = [
    update.tailwindPrefix,
    ...(update.relatedPrefixes ?? []),
  ];
  return classes.some(
    (c) =>
      allPrefixes.some((p) => classMatchesPrefix(c, p)) ||
      (update.classPattern && new RegExp(update.classPattern).test(c))
  );
}

/** Apply `updates` to a template-literal className (e.g. `` `flex ${x}` ``):
 *  rewrite whichever static quasi already contains a matching class, or (if
 *  none does) append the new classes to the last quasi. */
function mutateTemplateLiteralClassName(
  expr: jscodeshift.TemplateLiteral,
  updates: ClassNameUpdate[]
): void {
  let anyQuasiMatched = false;
  for (const quasi of expr.quasis) {
    const { raw } = quasi.value;
    const classes = raw.split(/\s+/).filter(Boolean);
    if (classes.length === 0) {
      continue;
    }

    const hasMatch = updates.some((update) =>
      updateMatchesAnyClass(update, classes)
    );

    if (hasMatch) {
      anyQuasiMatched = true;
      const leadingWs = raw.match(/^(?<ws>\s*)/)?.groups?.ws ?? "";
      const trailingWs = raw.match(/(?<ws>\s*)$/)?.groups?.ws ?? "";
      const updated = updateClassString(raw.trim(), updates);
      quasi.value = {
        raw: `${leadingWs}${updated}${trailingWs}`,
        cooked: `${leadingWs}${updated}${trailingWs}`,
      };
    }
  }
  // If no quasi had a matching class, append to the LAST quasi (tail)
  // so our class comes AFTER any dynamic interpolations and wins in Tailwind specificity
  if (!anyQuasiMatched) {
    const lastQuasi = expr.quasis.at(-1);
    if (!lastQuasi) {
      return;
    }
    const { raw } = lastQuasi.value;
    const newClasses = updates.map(buildClass).join(" ");
    // Append with a leading space
    const updated =
      raw.trimEnd().length > 0
        ? `${raw.trimEnd()} ${newClasses}`
        : ` ${newClasses}`;
    lastQuasi.value = { raw: updated, cooked: updated };
  }
}

/** Apply `updates` to a `clsx(...)`/`cn(...)`-style call: rewrite whichever
 *  string-literal argument already contains a matching class, or (if none
 *  does) append the new class to the first string-literal argument. Throws
 *  if a matching class only appears inside a conditional argument (that
 *  can't be safely rewritten statically). */
function mutateCallExpressionClassName(
  expr: jscodeshift.CallExpression,
  updates: ClassNameUpdate[]
): void {
  const { arguments: args } = expr;

  for (const update of updates) {
    if (checkConflictingConditional(args, update.tailwindPrefix)) {
      throw new Error(
        `CONFLICTING_CLASS: "${update.tailwindPrefix}" appears in a conditional argument`
      );
    }

    let found = false;
    for (const arg of args) {
      if (arg.type === "StringLiteral") {
        const classes = arg.value.split(/\s+/).filter(Boolean);
        if (updateMatchesAnyClass(update, classes)) {
          arg.value = updateClassString(arg.value, [update]);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      const firstStr = args.find(
        (a): a is jscodeshift.StringLiteral => a.type === "StringLiteral"
      );
      if (firstStr) {
        const newClass = buildClass(update);
        firstStr.value = firstStr.value
          ? `${firstStr.value} ${newClass}`
          : newClass;
      }
    }
  }
}

export function mutateClassName(
  j: J,
  target: NodePath<jscodeshift.JSXElement>,
  updates: ClassNameUpdate[]
): void {
  const { openingElement } = target.node;
  const attrs = openingElement.attributes ?? [];

  const classNameAttr = attrs.find(
    (a): a is jscodeshift.JSXAttribute =>
      a.type === "JSXAttribute" &&
      a.name?.type === "JSXIdentifier" &&
      a.name.name === "className"
  );

  if (!classNameAttr) {
    const allClasses = updates.map(buildClass).join(" ");
    (openingElement.attributes ??= []).push(
      j.jsxAttribute(j.jsxIdentifier("className"), j.stringLiteral(allClasses))
    );
    return;
  }

  const { value: attrValue } = classNameAttr;

  // Handle both StringLiteral (jscodeshift tsx parser) and Literal (babel parser)
  if (attrValue?.type === "StringLiteral" || attrValue?.type === "Literal") {
    attrValue.value = updateClassString(String(attrValue.value), updates);
    return;
  }

  if (attrValue?.type === "JSXExpressionContainer") {
    const { expression: expr } = attrValue;

    if (expr.type === "TemplateLiteral") {
      mutateTemplateLiteralClassName(expr, updates);
      return;
    }

    if (expr.type === "CallExpression") {
      mutateCallExpressionClassName(expr, updates);
      return;
    }

    throw new Error(
      `DYNAMIC_CLASSNAME: className is a dynamic expression that cannot be statically modified`
    );
  }

  throw new Error(`Unsupported className value type: ${attrValue?.type}`);
}

/**
 * Replace a JSX element's entire className value with `newClassName`. Used by the
 * "Optimize for mobile" AI flow, which regenerates a full className string and
 * applies it at a located node on confirm. Mirrors mutateClassName's handling of
 * the same value shapes, but writes the whole string instead of per-token edits.
 * Throws DYNAMIC_CLASSNAME for shapes we can't safely overwrite wholesale.
 */
export function mutateClassNameReplace(
  j: J,
  target: NodePath<jscodeshift.JSXElement>,
  newClassName: string
): void {
  const { openingElement } = target.node;
  const attrs = openingElement.attributes ?? [];

  const classNameAttr = attrs.find(
    (a): a is jscodeshift.JSXAttribute =>
      a.type === "JSXAttribute" &&
      a.name?.type === "JSXIdentifier" &&
      a.name.name === "className"
  );

  if (!classNameAttr) {
    (openingElement.attributes ??= []).push(
      j.jsxAttribute(
        j.jsxIdentifier("className"),
        j.stringLiteral(newClassName)
      )
    );
    return;
  }

  const { value: attrValue } = classNameAttr;

  if (attrValue?.type === "StringLiteral" || attrValue?.type === "Literal") {
    attrValue.value = newClassName;
    return;
  }

  if (attrValue?.type === "JSXExpressionContainer") {
    const { expression: expr } = attrValue;

    // A single-static-quasi template literal: overwrite that quasi's content.
    if (
      expr.type === "TemplateLiteral" &&
      expr.quasis.length === 1 &&
      expr.expressions.length === 0
    ) {
      const [quasi] = expr.quasis;
      quasi.value = { raw: newClassName, cooked: newClassName };
      return;
    }

    // A cn()/clsx() call with a single StringLiteral argument: overwrite it.
    const [firstArg] = expr.type === "CallExpression" ? expr.arguments : [];
    if (
      expr.type === "CallExpression" &&
      expr.arguments.length === 1 &&
      firstArg?.type === "StringLiteral"
    ) {
      firstArg.value = newClassName;
      return;
    }

    throw new Error(
      `DYNAMIC_CLASSNAME: cannot replace a dynamic className expression wholesale`
    );
  }

  throw new Error(`Unsupported className value type: ${attrValue?.type}`);
}

export function updateClassName(
  filePath: string,
  lineNumber: number,
  columnNumber: number,
  updates: ClassNameUpdate[]
): string {
  const source = fs.readFileSync(filePath, "utf-8");
  const { j, root, quoteStyle } = parseSource(source, filePath);

  const target = findJSXElementAt(j, root, lineNumber, columnNumber);
  if (!target) {
    throw new Error(`No JSX element found at ${lineNumber}:${columnNumber}`);
  }

  mutateClassName(j, target, updates);
  return root.toSource({ quote: quoteStyle });
}

// ── updateTextContent ────────────────────────────────────────────────────

/**
 * Recursively search JSXText nodes in an AST subtree for a substring and replace it.
 * Uses whitespace-flexible matching: the search term (from DOM text) has collapsed
 * whitespace, but the JSX source may have newlines/indentation. We build a regex
 * from oldSub that treats each space as \s+ to bridge this gap.
 */
function replaceInJSXTextRecursive(
  node: jscodeshift.JSXElement,
  oldSub: string,
  newSub: string,
  depth = 0
): boolean {
  const { children } = node;
  if (!children) {
    return false;
  }

  // Build a regex that matches oldSub with flexible whitespace
  const flexPattern = oldSub
    .replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(/\s+/g, "\\s+");
  const flexRe = new RegExp(flexPattern);

  for (const child of children) {
    if (child.type === "JSXText") {
      const trimmed = child.value.trim();
      // Try exact match first, then whitespace-flexible match
      if (child.value.includes(oldSub)) {
        logger.debug(
          `[replaceRecursive] d=${depth} FOUND exact "${oldSub.slice(0, 30)}" in "${trimmed.slice(0, 30)}"`
        );
        child.value = child.value.replace(oldSub, newSub);
        return true;
      }
      const flexMatch = child.value.match(flexRe);
      if (flexMatch) {
        logger.debug(
          `[replaceRecursive] d=${depth} FOUND flex "${oldSub.slice(0, 30)}" in "${trimmed.slice(0, 30)}"`
        );
        child.value = child.value.replace(flexRe, newSub);
        return true;
      }
    }
    if (
      child.type === "JSXExpressionContainer" &&
      child.expression?.type === "StringLiteral" &&
      child.expression.value.includes(oldSub)
    ) {
      child.expression.value = child.expression.value.replace(oldSub, newSub);
      return true;
    }
    // Recurse into child JSX elements
    if (
      child.type === "JSXElement" &&
      replaceInJSXTextRecursive(child, oldSub, newSub, depth + 1)
    ) {
      return true;
    }
  }
  return false;
}

function getLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function getNodeIndex(
  node: PositionedNode,
  edge: "start" | "end",
  lineStarts: number[]
): number | null {
  const direct = edge === "start" ? node.start : node.end;
  if (typeof direct === "number") {
    return direct;
  }

  const loc = node.loc?.[edge];
  if (!loc) {
    return null;
  }
  const lineIndex = lineStarts[loc.line - 1];
  if (lineIndex === undefined) {
    return null;
  }
  return lineIndex + loc.column;
}

function getSourceBetween(
  prevNode: PositionedNode,
  nextNode: PositionedNode,
  source?: string,
  lineStarts?: number[]
): string {
  if (!source) {
    return "";
  }
  const starts = lineStarts ?? getLineStarts(source);
  const prevEnd = getNodeIndex(prevNode, "end", starts);
  const nextStart = getNodeIndex(nextNode, "start", starts);
  if (prevEnd === null || nextStart === null || nextStart < prevEnd) {
    return "";
  }
  return source.slice(prevEnd, nextStart);
}

function getRenderedChildText(
  child: JSXChild,
  source?: string,
  lineStarts?: number[]
): string {
  if (child.type === "JSXText") {
    return collapseRenderedWhitespace(child.value);
  }
  if (child.type === "JSXElement") {
    // getRenderedChildText and getRenderedElementText are mutually recursive
    // (each renders the other's node kind); no declaration order satisfies
    // both directions.
    // oxlint-disable-next-line no-use-before-define -- see rationale above
    return getRenderedElementText(child, source, lineStarts);
  }
  if (child.type === "JSXExpressionContainer") {
    const { expression: expr } = child;
    if (expr?.type === "StringLiteral" || expr?.type === "Literal") {
      return collapseRenderedWhitespace(String(expr.value ?? ""));
    }
  }
  return "";
}

function needsBoundarySpace(
  previousText: string,
  nextText: string,
  sourceBetween: string
): boolean {
  if (!previousText || !nextText) {
    return false;
  }
  if (/\s$/.test(previousText) || /^\s/.test(nextText)) {
    return false;
  }
  return /\s/.test(sourceBetween);
}

function getRenderedElementText(
  node: jscodeshift.JSXElement,
  source?: string,
  lineStarts?: number[]
): string {
  const { children } = node;
  if (!children) {
    return "";
  }

  let text = "";
  let previousChild: JSXChild | null = null;
  let previousText = "";

  for (const child of children) {
    const childText = getRenderedChildText(child, source, lineStarts);
    if (!childText) {
      continue;
    }

    if (previousChild) {
      const sourceBetween = getSourceBetween(
        previousChild,
        child,
        source,
        lineStarts
      );
      if (needsBoundarySpace(previousText, childText, sourceBetween)) {
        text += " ";
      }
    }

    text += childText;
    previousChild = child;
    previousText = childText;
  }

  return collapseRenderedWhitespace(text);
}

function prependToChildText(child: JSXChild, text: string): boolean {
  if (child.type === "JSXText") {
    child.value = text + child.value;
    return true;
  }
  if (
    child.type === "JSXExpressionContainer" &&
    child.expression?.type === "StringLiteral"
  ) {
    child.expression.value = text + String(child.expression.value ?? "");
    return true;
  }
  return false;
}

function appendToChildText(child: JSXChild, text: string): boolean {
  if (child.type === "JSXText") {
    child.value += text;
    return true;
  }
  if (
    child.type === "JSXExpressionContainer" &&
    child.expression?.type === "StringLiteral"
  ) {
    child.expression.value = String(child.expression.value ?? "") + text;
    return true;
  }
  return false;
}

function createSpaceExpressionNode(): jscodeshift.JSXExpressionContainer {
  return {
    type: "JSXExpressionContainer",
    expression: {
      type: "StringLiteral",
      value: " ",
    },
  } as jscodeshift.JSXExpressionContainer;
}

function isTextLikeChild(child: JSXChild): boolean {
  return (
    child.type === "JSXText" ||
    (child.type === "JSXExpressionContainer" &&
      child.expression?.type === "StringLiteral")
  );
}

function isEmptyTextLikeChild(child: JSXChild): boolean {
  if (child.type === "JSXText") {
    return child.value === "";
  }
  if (
    child.type === "JSXExpressionContainer" &&
    child.expression?.type === "StringLiteral"
  ) {
    return String(child.expression.value ?? "") === "";
  }
  return false;
}

function getTextLikeValue(child: JSXChild): string | null {
  if (child.type === "JSXText") {
    return child.value;
  }
  if (
    child.type === "JSXExpressionContainer" &&
    child.expression?.type === "StringLiteral"
  ) {
    return String(child.expression.value ?? "");
  }
  return null;
}

function setTextLikeValue(child: JSXChild, value: string): void {
  if (child.type === "JSXText") {
    child.value = value;
    return;
  }
  if (
    child.type === "JSXExpressionContainer" &&
    child.expression?.type === "StringLiteral"
  ) {
    child.expression.value = value;
  }
}

function hasVisibleTextInEntries(
  entries: JSXChild[],
  source?: string,
  lineStarts?: number[]
): boolean {
  return entries.some((entry) =>
    /\S/.test(getRenderedChildText(entry, source, lineStarts))
  );
}

function mergeAdjacentTextLikeChildren(children: JSXChild[]): JSXChild[] {
  const merged: JSXChild[] = [];
  for (const child of children) {
    if (isEmptyTextLikeChild(child)) {
      continue;
    }

    const previous = merged.at(-1);
    if (previous?.type === "JSXText" && child.type === "JSXText") {
      setTextLikeValue(
        previous,
        `${getTextLikeValue(previous) ?? ""}${getTextLikeValue(child) ?? ""}`
      );
      continue;
    }

    merged.push(child);
  }
  return merged;
}

function trimTextLikeEdges(value: string): {
  core: string;
  hasLeadingWhitespace: boolean;
  hasTrailingWhitespace: boolean;
} {
  return {
    core: value.replace(/^\s+/, "").replace(/\s+$/, ""),
    hasLeadingWhitespace: /^\s/.test(value),
    hasTrailingWhitespace: /\s$/.test(value),
  };
}

function insertSingleVisibleBoundarySpace(
  normalized: JSXChild[],
  upcomingChild?: JSXChild
): void {
  const previous = normalized.at(-1);
  if (!previous) {
    return;
  }

  const previousIsPlainText = previous.type === "JSXText";
  const upcomingIsPlainText = upcomingChild?.type === "JSXText";

  if (previousIsPlainText && upcomingIsPlainText) {
    if (appendToChildText(previous, " ")) {
      return;
    }
    if (upcomingChild && prependToChildText(upcomingChild, " ")) {
      return;
    }
  }

  normalized.push(createSpaceExpressionNode());
}

/** Normalize a single text-like child (JSXText or a StringLiteral
 *  JSXExpressionContainer) during canonicalization: trim its edge whitespace,
 *  push it (unless it collapses to nothing), and return the pendingBoundarySpace
 *  flag that should carry into the next child. */
function normalizeTextLikeChildForCanonicalization(
  child: JSXChild,
  normalized: JSXChild[],
  pendingBoundarySpace: boolean,
  source?: string,
  lineStarts?: number[]
): boolean {
  const value = getTextLikeValue(child) ?? "";
  if (!value) {
    return pendingBoundarySpace;
  }

  const { core, hasLeadingWhitespace, hasTrailingWhitespace } =
    trimTextLikeEdges(value);
  if (!core) {
    return hasVisibleTextInEntries(normalized, source, lineStarts)
      ? true
      : pendingBoundarySpace;
  }

  setTextLikeValue(child, core);
  if (
    (pendingBoundarySpace || hasLeadingWhitespace) &&
    hasVisibleTextInEntries(normalized, source, lineStarts)
  ) {
    insertSingleVisibleBoundarySpace(normalized, child);
  }

  normalized.push(child);
  return hasTrailingWhitespace;
}

/** Normalize a single non-text child (element/expression) during
 *  canonicalization: insert a boundary space if needed, push it, and return
 *  the pendingBoundarySpace flag that should carry into the next child. */
function normalizeNonTextChildForCanonicalization(
  child: JSXChild,
  normalized: JSXChild[],
  pendingBoundarySpace: boolean,
  source?: string,
  lineStarts?: number[]
): boolean {
  const childText = getRenderedChildText(child, source, lineStarts);
  const childHasVisibleText = /\S/.test(childText);
  if (
    (pendingBoundarySpace || /^\s/.test(childText)) &&
    childHasVisibleText &&
    hasVisibleTextInEntries(normalized, source, lineStarts)
  ) {
    insertSingleVisibleBoundarySpace(normalized, child);
  }

  normalized.push(child);
  return childHasVisibleText && /\s$/.test(childText);
}

function canonicalizeEditedTextSubtree(
  node: jscodeshift.JSXElement,
  source?: string,
  lineStarts = source ? getLineStarts(source) : undefined
): void {
  const { children } = node;
  if (!children || children.length === 0) {
    return;
  }

  for (const child of children) {
    if (child.type === "JSXElement") {
      canonicalizeEditedTextSubtree(child, source, lineStarts);
    }
  }

  const normalized: JSXChild[] = [];
  let pendingBoundarySpace = false;

  for (const child of children) {
    pendingBoundarySpace = isTextLikeChild(child)
      ? normalizeTextLikeChildForCanonicalization(
          child,
          normalized,
          pendingBoundarySpace,
          source,
          lineStarts
        )
      : normalizeNonTextChildForCanonicalization(
          child,
          normalized,
          pendingBoundarySpace,
          source,
          lineStarts
        );
  }

  node.children = mergeAdjacentTextLikeChildren(normalized);
}

type ImmediateTextSegment =
  | { type: "child"; text: string; childIndex: number }
  | {
      type: "boundary";
      text: string;
      leftChildIndex: number;
      rightChildIndex: number;
    };

function buildImmediateTextSegments(
  parentNode: jscodeshift.JSXElement,
  source?: string
): ImmediateTextSegment[] {
  const { children } = parentNode;
  if (!children || children.length === 0) {
    return [];
  }

  const lineStarts = source ? getLineStarts(source) : undefined;
  const segments: ImmediateTextSegment[] = [];
  let previousChildIndex: number | null = null;
  let previousText = "";

  for (const [i, currentChild] of children.entries()) {
    const childText = getRenderedChildText(currentChild, source, lineStarts);
    if (!childText) {
      continue;
    }

    if (previousChildIndex !== null) {
      const boundarySource = getSourceBetween(
        children[previousChildIndex],
        currentChild,
        source,
        lineStarts
      );
      if (needsBoundarySpace(previousText, childText, boundarySource)) {
        segments.push({
          type: "boundary",
          text: " ",
          leftChildIndex: previousChildIndex,
          rightChildIndex: i,
        });
      }
    }

    segments.push({ type: "child", text: childText, childIndex: i });
    previousChildIndex = i;
    previousText = childText;
  }

  const collapsedSegments: ImmediateTextSegment[] = [];
  let previousEndsWithWhitespace = false;

  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }
    const whitespaceOnly = /^[\t\n\f\r ]+$/.test(segment.text);
    if (whitespaceOnly && previousEndsWithWhitespace) {
      continue;
    }
    const collapsed = whitespaceOnly ? { ...segment, text: " " } : segment;
    collapsedSegments.push(collapsed);
    previousEndsWithWhitespace = /\s$/.test(collapsed.text);
  }

  return collapsedSegments;
}

function getSegmentsText(segments: ImmediateTextSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

function flattenRangeIntoText(
  parentNode: jscodeshift.JSXElement,
  firstChildIndex: number,
  lastChildIndex: number,
  replacementText: string
): boolean {
  const { children } = parentNode;
  if (!children) {
    return false;
  }
  if (replacementText === "") {
    children.splice(firstChildIndex, lastChildIndex - firstChildIndex + 1);
    return true;
  }
  children.splice(firstChildIndex, lastChildIndex - firstChildIndex + 1, {
    type: "JSXText",
    value: replacementText,
  } as jscodeshift.JSXText);
  return true;
}

function createInsertionNode(text: string): JSXChild {
  if (text === " ") {
    return createSpaceExpressionNode();
  }
  return { type: "JSXText", value: text } as jscodeshift.JSXText;
}

function createWhitespaceInsertionNodes(count: number): JSXChild[] {
  return Array.from({ length: count }, () => createSpaceExpressionNode());
}

function insertBetweenImmediateChildren(
  node: jscodeshift.JSXElement,
  leftChildIndex: number,
  rightChildIndex: number,
  insertion: string,
  existingBoundaryText = ""
): boolean {
  const { children } = node;
  if (!children || !insertion) {
    return false;
  }

  const leftChild = children[leftChildIndex];
  const rightChild = children[rightChildIndex];
  if (/^\s+$/.test(insertion) && /^\s*$/.test(existingBoundaryText)) {
    const totalSpaces = existingBoundaryText.length + insertion.length;
    children.splice(
      rightChildIndex,
      0,
      ...createWhitespaceInsertionNodes(Math.max(1, totalSpaces))
    );
    return true;
  }

  const preferExplicitBoundary =
    leftChild?.type !== "JSXText" || rightChild?.type !== "JSXText";
  if (
    !preferExplicitBoundary &&
    rightChild?.type === "JSXText" &&
    leftChildIndex + 1 === rightChildIndex
  ) {
    rightChild.value = insertion + rightChild.value;
    return true;
  }

  children.splice(rightChildIndex, 0, createInsertionNode(insertion));
  return true;
}

/**
 * Replace text that spans across multiple child elements.
 *
 * When DOM textContent is "do software stuff" but the JSX is
 * "do <strong>software</strong> stuff", no single JSXText node contains
 * the full substring. This function builds a concatenated text from all
 * children, finds the match, then surgically modifies the affected nodes:
 * - First affected text node: trim matched portion, append newSub
 * - Middle children (fully consumed): removed
 * - Last affected text node: trim matched portion from start
 */
function replaceCrossElementText(
  parentNode: jscodeshift.JSXElement,
  oldSub: string,
  newSub: string,
  source?: string,
  matchStartHint?: number
): boolean {
  const { children } = parentNode;
  if (!children || children.length === 0) {
    return false;
  }
  const segments = buildImmediateTextSegments(parentNode, source);
  const concat = getSegmentsText(segments);

  // Find oldSub in the concatenated text
  const hintedMatch =
    matchStartHint !== undefined &&
    concat.slice(matchStartHint, matchStartHint + oldSub.length) === oldSub
      ? matchStartHint
      : -1;
  const matchStart = hintedMatch === -1 ? concat.indexOf(oldSub) : hintedMatch;
  if (matchStart === -1) {
    return false;
  }
  const matchEnd = matchStart + oldSub.length;

  let cursor = 0;
  let firstChildIndex = -1;
  let lastChildIndex = -1;
  let prefix = "";
  let suffix = "";

  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.text.length;
    cursor = segmentEnd;

    if (segmentEnd <= matchStart || segmentStart >= matchEnd) {
      continue;
    }

    if (segment.type === "boundary") {
      if (firstChildIndex === -1) {
        firstChildIndex = segment.leftChildIndex;
      }
      lastChildIndex = segment.rightChildIndex;
      continue;
    }

    if (firstChildIndex === -1) {
      firstChildIndex = segment.childIndex;
      prefix = segment.text.slice(0, Math.max(0, matchStart - segmentStart));
    }

    lastChildIndex = segment.childIndex;
    suffix = segment.text.slice(Math.max(0, matchEnd - segmentStart));
  }

  if (firstChildIndex === -1 || lastChildIndex === -1) {
    return false;
  }

  logger.debug(
    `[crossElement] match spans children[${firstChildIndex}..${lastChildIndex}], replacing "${oldSub.slice(0, 40)}" → "${newSub.slice(0, 40)}"`
  );
  return flattenRangeIntoText(
    parentNode,
    firstChildIndex,
    lastChildIndex,
    prefix + newSub + suffix
  );
}

/**
 * Find the differing substring between two strings.
 */
function isCollapsibleWhitespaceChar(char: string): boolean {
  return (
    char === " " ||
    char === "\n" ||
    char === "\r" ||
    char === "\t" ||
    char === "\f"
  );
}

function mapRenderedOffsetToRawIndex(
  rawText: string,
  renderedOffset: number,
  bias: "start" | "end" = "start"
): number {
  if (renderedOffset <= 0) {
    return 0;
  }

  let renderedIndex = 0;
  let rawIndex = 0;

  while (rawIndex < rawText.length) {
    const char = rawText[rawIndex];
    if (isCollapsibleWhitespaceChar(char)) {
      const runStart = rawIndex;
      while (
        rawIndex < rawText.length &&
        isCollapsibleWhitespaceChar(rawText[rawIndex])
      ) {
        rawIndex += 1;
      }

      if (renderedIndex === renderedOffset) {
        return bias === "end" ? rawIndex : runStart;
      }

      renderedIndex += 1;
      if (renderedIndex >= renderedOffset) {
        return bias === "end" ? rawIndex : runStart;
      }
      continue;
    }

    if (renderedIndex === renderedOffset) {
      return rawIndex;
    }

    rawIndex += 1;
    renderedIndex += 1;
  }

  return rawText.length;
}

function findTextDiff(
  oldText: string,
  newText: string
): { oldSubstring: string; newSubstring: string; prefixLen: number } | null {
  if (oldText === newText) {
    return null;
  }

  let prefixLen = 0;
  while (
    prefixLen < oldText.length &&
    prefixLen < newText.length &&
    oldText[prefixLen] === newText[prefixLen]
  ) {
    prefixLen += 1;
  }

  let oldSuffixStart = oldText.length;
  let newSuffixStart = newText.length;
  while (
    oldSuffixStart > prefixLen &&
    newSuffixStart > prefixLen &&
    oldText[oldSuffixStart - 1] === newText[newSuffixStart - 1]
  ) {
    oldSuffixStart -= 1;
    newSuffixStart -= 1;
  }

  const oldSubstring = oldText.slice(prefixLen, oldSuffixStart);
  const newSubstring = newText.slice(prefixLen, newSuffixStart);

  if (!oldSubstring && !newSubstring) {
    return null;
  }
  return { oldSubstring, newSubstring, prefixLen };
}

function anchorMatchesAt(
  renderedText: string,
  start: number,
  oldSubstring: string,
  textAnchor: TextEditAnchor
): boolean {
  const oldLength = textAnchor.end - textAnchor.start;
  if (start < 0 || start + oldLength > renderedText.length) {
    return false;
  }
  if (
    oldSubstring &&
    renderedText.slice(start, start + oldLength) !== oldSubstring
  ) {
    return false;
  }

  if (textAnchor.contextBefore) {
    const before = renderedText.slice(
      Math.max(0, start - textAnchor.contextBefore.length),
      start
    );
    if (before !== textAnchor.contextBefore) {
      return false;
    }
  }

  if (textAnchor.contextAfter) {
    const after = renderedText.slice(
      start + oldLength,
      start + oldLength + textAnchor.contextAfter.length
    );
    if (after !== textAnchor.contextAfter) {
      return false;
    }
  }

  return true;
}

function resolveAnchoredStart(
  renderedText: string,
  oldSubstring: string,
  textAnchor: TextEditAnchor
): number | null {
  const oldLength = textAnchor.end - textAnchor.start;
  if (
    anchorMatchesAt(renderedText, textAnchor.start, oldSubstring, textAnchor)
  ) {
    return textAnchor.start;
  }

  const maxStart = renderedText.length - oldLength;
  const candidates: number[] = [];
  for (let start = 0; start <= maxStart; start += 1) {
    if (anchorMatchesAt(renderedText, start, oldSubstring, textAnchor)) {
      candidates.push(start);
    }
  }

  if (candidates.length === 0) {
    if (
      !oldSubstring &&
      textAnchor.start >= 0 &&
      textAnchor.start <= renderedText.length
    ) {
      return textAnchor.start;
    }
    if (
      oldSubstring &&
      textAnchor.start >= 0 &&
      textAnchor.start + oldLength <= renderedText.length &&
      renderedText.slice(textAnchor.start, textAnchor.start + oldLength) ===
        oldSubstring
    ) {
      return textAnchor.start;
    }
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const [firstCandidate, ...restCandidates] = candidates;
  let closest = firstCandidate;
  for (const candidate of restCandidates) {
    const closestDistance = Math.abs(closest - textAnchor.start);
    const candidateDistance = Math.abs(candidate - textAnchor.start);
    if (candidateDistance < closestDistance) {
      closest = candidate;
    }
  }
  return closest;
}

function replaceWithinSingleSegmentAtOffset(
  node: jscodeshift.JSXElement,
  start: number,
  end: number,
  replacement: string,
  source?: string
): boolean {
  const segments = buildImmediateTextSegments(node, source);
  const children = node.children ?? [];
  if (segments.length === 0) {
    return false;
  }

  let cursor = 0;
  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.text.length;
    cursor = segmentEnd;

    if (start < segmentStart || end > segmentEnd) {
      continue;
    }
    if (segment.type === "boundary") {
      return false;
    }

    const child = children[segment.childIndex];
    if (!child) {
      return false;
    }

    if (child.type === "JSXText") {
      const rawStart = mapRenderedOffsetToRawIndex(
        child.value,
        Math.max(0, start - segmentStart),
        "start"
      );
      const rawEnd = mapRenderedOffsetToRawIndex(
        child.value,
        Math.max(0, end - segmentStart),
        "end"
      );
      const localStart = Math.max(0, Math.min(child.value.length, rawStart));
      const localEnd = Math.max(
        localStart,
        Math.min(child.value.length, rawEnd)
      );
      const nextValue =
        child.value.slice(0, localStart) +
        replacement +
        child.value.slice(localEnd);
      if (
        nextValue === "" &&
        localStart === 0 &&
        localEnd === child.value.length
      ) {
        children.splice(segment.childIndex, 1);
      } else {
        child.value = nextValue;
      }
      return true;
    }

    if (
      child.type === "JSXExpressionContainer" &&
      child.expression?.type === "StringLiteral"
    ) {
      const value = String(child.expression.value ?? "");
      const rawStart = mapRenderedOffsetToRawIndex(
        value,
        Math.max(0, start - segmentStart),
        "start"
      );
      const rawEnd = mapRenderedOffsetToRawIndex(
        value,
        Math.max(0, end - segmentStart),
        "end"
      );
      const localStart = Math.max(0, Math.min(value.length, rawStart));
      const localEnd = Math.max(localStart, Math.min(value.length, rawEnd));
      const nextValue =
        value.slice(0, localStart) + replacement + value.slice(localEnd);
      if (nextValue === "" && localStart === 0 && localEnd === value.length) {
        children.splice(segment.childIndex, 1);
      } else {
        child.expression.value = nextValue;
      }
      return true;
    }

    if (child.type === "JSXElement") {
      return replaceWithinSingleSegmentAtOffset(
        child,
        start - segmentStart,
        end - segmentStart,
        replacement,
        source
      );
    }

    return false;
  }

  return false;
}

/**
 * Find the first JSXText node in an AST subtree.
 */
function findFirstJSXText(
  node: jscodeshift.JSXElement
): jscodeshift.JSXText | null {
  if (!node.children) {
    return null;
  }
  for (const child of node.children) {
    if (child.type === "JSXText" && child.value.trim()) {
      return child;
    }
    if (child.type === "JSXElement") {
      const found = findFirstJSXText(child);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Insert text at a character offset within the concatenated JSXText of a subtree.
 * Walks through JSXText nodes, tracking cumulative offset, and inserts when found.
 */
// Like mutateTextContent above, this walks a single position-mapping decision
// tree (boundary segment / child segment / text vs. expression vs. element,
// with a same-offset lookahead and an end-of-subtree fallback) where each
// branch is a short early return; splitting it further would fragment one
// atomic offset resolution across functions without reducing risk.
// oxlint-disable-next-line complexity -- see rationale above
function insertInJSXTextAtOffset(
  node: jscodeshift.JSXElement,
  offset: number,
  insertion: string,
  source?: string
): boolean {
  const segments = buildImmediateTextSegments(node, source);
  const children = node.children ?? [];
  if (segments.length === 0) {
    return false;
  }

  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.text.length;
    cursor = segmentEnd;

    if (offset < segmentStart || offset > segmentEnd) {
      continue;
    }

    if (segment.type === "boundary") {
      return insertBetweenImmediateChildren(
        node,
        segment.leftChildIndex,
        segment.rightChildIndex,
        insertion,
        segment.text
      );
    }

    const child = children[segment.childIndex];
    if (!child) {
      return false;
    }

    const nextSegment = segments[i + 1];
    if (
      offset === segmentEnd &&
      nextSegment?.type === "child" &&
      nextSegment.childIndex !== segment.childIndex
    ) {
      return insertBetweenImmediateChildren(
        node,
        segment.childIndex,
        nextSegment.childIndex,
        insertion
      );
    }

    if (child.type === "JSXText") {
      const rawOffset = mapRenderedOffsetToRawIndex(
        child.value,
        Math.max(0, offset - segmentStart),
        "end"
      );
      const localOffset = Math.max(0, Math.min(child.value.length, rawOffset));
      child.value =
        child.value.slice(0, localOffset) +
        insertion +
        child.value.slice(localOffset);
      return true;
    }

    if (child.type === "JSXElement") {
      return insertInJSXTextAtOffset(
        child,
        offset - segmentStart,
        insertion,
        source
      );
    }

    if (
      child.type === "JSXExpressionContainer" &&
      child.expression?.type === "StringLiteral"
    ) {
      const value = String(child.expression.value ?? "");
      const rawOffset = mapRenderedOffsetToRawIndex(
        value,
        Math.max(0, offset - segmentStart),
        "end"
      );
      const localOffset = Math.max(0, Math.min(value.length, rawOffset));
      child.expression.value =
        value.slice(0, localOffset) + insertion + value.slice(localOffset);
      return true;
    }

    return false;
  }

  const lastSegment = segments.at(-1);
  if (lastSegment?.type === "child") {
    const child = node.children?.[lastSegment.childIndex];
    if (child?.type === "JSXText") {
      child.value += insertion;
      return true;
    }
  }

  return false;
}

/**
 * Replace text content of a JSX element node.
 * Mutates the AST in place — no I/O.
 * Returns true if a matching text child was found and replaced.
 *
 * Handles three cases:
 * 1. Exact match: originalText matches a single JSXText child exactly
 * 2. Substring diff: originalText is the full concatenated textContent (includes child elements),
 *    we diff against newText to find what changed, then replace in the matching JSXText fragment
 * 3. Expression match: text is in a JSXExpressionContainer StringLiteral
 */
// This is the central dispatcher over several independent text-edit
// strategies (exact match, anchored replace, whitespace-flexible replace,
// cross-element replace, pure insertion at start/middle/end); each branch is
// a short, self-contained early return, and splitting it further would
// fragment a single atomic decision tree across files/functions without
// reducing real risk, while raising the risk of silently changing which
// strategy wins for a given input.
// oxlint-disable-next-line complexity -- see rationale above
export function mutateTextContent(
  target: NodePath<jscodeshift.JSXElement>,
  originalText: string,
  newText: string,
  source?: string,
  cursorOffset?: number,
  textAnchor?: TextEditAnchor
): boolean {
  const { children } = target.node;
  const tag = getJSXElementName(target.node);
  const line = target.node.openingElement?.loc?.start?.line;
  const finish = (): true => {
    canonicalizeEditedTextSubtree(target.node, source);
    return true;
  };
  logger.debug(
    `[mutateText] target=<${tag}> line=${line} children=${children?.length ?? "null"} original="${originalText.slice(0, 60)}" new="${newText.slice(0, 60)}"`
  );
  if (!children) {
    return false;
  }

  // Diagnostic: dump children types and values to see what we're working with
  for (const [i, c] of children.entries()) {
    if (c.type === "JSXText") {
      logger.debug(
        `[mutateText]   child[${i}] JSXText: "${c.value.slice(0, 80).replaceAll("\n", "\\n")}"`
      );
    } else if (c.type === "JSXElement") {
      logger.debug(
        `[mutateText]   child[${i}] JSXElement: <${getJSXElementName(c)}>`
      );
    } else if (c.type === "JSXExpressionContainer") {
      const { expression: expr } = c;
      const exprValue = (expr as { value?: unknown } | null)?.value;
      logger.debug(
        `[mutateText]   child[${i}] JSXExpr: ${expr?.type} = "${String(exprValue ?? expr?.type).slice(0, 60)}"`
      );
    } else {
      logger.debug(`[mutateText]   child[${i}] ${c.type}`);
    }
  }

  // Case 1: Exact match against a single JSXText child
  // Use normalizeWs because React collapses JSX whitespace (newlines → spaces)
  // but the AST retains raw whitespace — DOM textContent won't match without this.
  for (const child of children) {
    if (child.type === "JSXText") {
      const trimmed = child.value.trim();
      if (normalizeWs(trimmed) === normalizeWs(originalText.trim())) {
        const idx = child.value.indexOf(trimmed);
        const prefixWs = child.value.slice(0, idx);
        const suffixWs = child.value.slice(idx + trimmed.length);
        child.value = prefixWs + newText + suffixWs;
        return finish();
      }
    }
    if (
      child.type === "JSXExpressionContainer" &&
      child.expression.type === "StringLiteral" &&
      child.expression.value === originalText
    ) {
      child.expression.value = newText;
      return finish();
    }
  }

  // Case 2: originalText is concatenated textContent from DOM (includes child element text).
  // Diff originalText vs newText to find the changed substring, then search ALL JSXText nodes
  // recursively (the changed text might be inside a <strong>, <em>, <a>, etc.)
  const diffResult = findTextDiff(originalText, newText);
  logger.debug(
    "[mutateText] diff:",
    diffResult
      ? `old="${diffResult.oldSubstring.slice(0, 30)}" new="${diffResult.newSubstring.slice(0, 30)}" prefix=${diffResult.prefixLen}`
      : "null"
  );
  if (diffResult) {
    if (textAnchor) {
      const renderedText = getRenderedElementText(target.node, source);
      const anchoredStart = resolveAnchoredStart(
        renderedText,
        diffResult.oldSubstring,
        textAnchor
      );
      if (anchoredStart !== null) {
        if (diffResult.oldSubstring) {
          const anchoredReplace = replaceWithinSingleSegmentAtOffset(
            target.node,
            anchoredStart,
            anchoredStart + diffResult.oldSubstring.length,
            diffResult.newSubstring,
            source
          );
          if (anchoredReplace) {
            return finish();
          }

          const anchoredCross = replaceCrossElementText(
            target.node,
            diffResult.oldSubstring,
            diffResult.newSubstring,
            source,
            anchoredStart
          );
          if (anchoredCross) {
            return finish();
          }
        } else {
          const anchoredInsert = insertInJSXTextAtOffset(
            target.node,
            anchoredStart,
            diffResult.newSubstring,
            source
          );
          if (anchoredInsert) {
            return finish();
          }
        }
      }
    }

    if (diffResult.oldSubstring) {
      const whitespaceSensitive =
        !/\S/.test(diffResult.oldSubstring) ||
        !/\S/.test(diffResult.newSubstring);
      if (!whitespaceSensitive) {
        // Replace or delete — search with whitespace-flexible matching
        const found = replaceInJSXTextRecursive(
          target.node,
          diffResult.oldSubstring,
          diffResult.newSubstring
        );
        if (found) {
          return finish();
        }
      }
      // If single-node search failed, the old text likely spans across child elements
      // (e.g. "do <strong>software</strong> stuff" → flat "do software stuff").
      // Try cross-element replacement.
      const crossFound = replaceCrossElementText(
        target.node,
        diffResult.oldSubstring,
        diffResult.newSubstring,
        source,
        diffResult.prefixLen
      );
      if (crossFound) {
        return finish();
      }
    } else if (diffResult.newSubstring && diffResult.prefixLen > 0) {
      // Pure insertion — find the JSXText child that contains the character at prefixLen,
      // then insert the new text at the right position within that child
      const insertionOffset =
        cursorOffset === undefined
          ? diffResult.prefixLen
          : Math.max(0, cursorOffset - diffResult.newSubstring.length);
      const found = insertInJSXTextAtOffset(
        target.node,
        insertionOffset,
        diffResult.newSubstring,
        source
      );
      if (found) {
        return finish();
      }
    } else if (diffResult.newSubstring) {
      // Insertion at the very start — prepend to the first JSXText child
      const firstText = findFirstJSXText(target.node);
      if (firstText) {
        const ws = firstText.value.match(/^(?<ws>\s*)/)?.groups?.ws ?? "";
        firstText.value =
          ws + diffResult.newSubstring + firstText.value.slice(ws.length);
        return finish();
      }
    }
  }

  return false;
}

/**
 * Replace text content of a JSX element at the given source position.
 * Returns the new source string, or null if no matching text child was found.
 */
export function updateTextContent(
  filePath: string,
  lineNumber: number,
  columnNumber: number,
  originalText: string,
  newText: string,
  cursorOffset?: number,
  textAnchor?: TextEditAnchor
): string | null {
  const source = fs.readFileSync(filePath, "utf-8");
  const { j, root, quoteStyle } = parseSource(source, filePath);

  const target = findJSXElementAt(j, root, lineNumber, columnNumber);
  if (!target) {
    return null;
  }

  if (
    mutateTextContent(
      target,
      originalText,
      newText,
      source,
      cursorOffset,
      textAnchor
    )
  ) {
    return root.toSource({ quote: quoteStyle });
  }
  return null;
}
