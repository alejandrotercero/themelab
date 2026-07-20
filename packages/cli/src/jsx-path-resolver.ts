// packages/cli/src/jsx-path-resolver.ts
// Resolves a JSX structural path to an AST node (jscodeshift path object).

import type { JSXStructuralPath, JSXPathSegment } from "@themelab/shared";
import type { ASTPath, Collection, JSCodeshift } from "jscodeshift";

/** Source location range as attached by recast/babel/estree parsers. */
export interface AstLoc {
  start?: { line: number; column: number };
  end?: { line: number; column: number };
}

/**
 * Minimal structural typing for the jscodeshift/ast-types AST nodes this
 * module and batch-transform.ts read. jscodeshift supports multiple parsers
 * (babel, tsx, flow, ...) whose real ast-types unions differ subtly (e.g.
 * `StringLiteral` vs `Literal`) and are collectively enormous discriminated
 * unions that are impractical to thread through code that deliberately
 * duck-types across parsers. This interface models exactly the fields these
 * modules read/write, typed precisely rather than `any`; the index signature
 * covers the long tail of rarely-touched fields (still `unknown`, not `any`,
 * so callers must narrow before use).
 */
export interface AstNode {
  type: string;
  name?: AstNode | string | null;
  object?: AstNode;
  property?: AstNode;
  computed?: boolean;
  value?: unknown;
  raw?: string;
  openingElement?: {
    name?: AstNode;
    attributes?: AstNode[];
    loc?: AstLoc | null;
  };
  closingElement?: unknown;
  attributes?: AstNode[];
  attribute?: AstNode;
  children?: AstNode[];
  expression?: AstNode | null;
  expressions?: AstNode[];
  quasis?: AstNode[];
  arguments?: AstNode[];
  callee?: AstNode;
  id?: AstNode | null;
  init?: AstNode | null;
  body?: AstNode | AstNode[];
  argument?: AstNode | null;
  declaration?: AstNode;
  declarations?: AstNode[];
  params?: AstNode[];
  left?: AstNode;
  right?: AstNode;
  test?: AstNode;
  consequent?: AstNode;
  alternate?: AstNode | null;
  operator?: string;
  elements?: (AstNode | null)[];
  properties?: AstNode[];
  key?: AstNode;
  specifiers?: AstNode[];
  source?: AstNode;
  loc?: AstLoc | null;
  start?: number | null;
  end?: number | null;
  extra?: { raw?: string; rawValue?: unknown };
  [key: string]: unknown;
}

/** jscodeshift path over an {@link AstNode}. */
export type AstPath = ASTPath<AstNode>;

/**
 * Read the string name off a node's `name` field, which — depending on the
 * node kind — is either a bare string (e.g. `JSXIdentifier.name`) or a nested
 * identifier-like node (e.g. `JSXAttribute.name`, itself a `JSXIdentifier`).
 */
function nodeName(n: AstNode | string | null | undefined): string | null {
  if (typeof n === "string") {
    return n;
  }
  if (n && typeof n.name === "string") {
    return n.name;
  }
  return null;
}

/**
 * Get the tag name from a JSXElement node.
 * Handles JSXIdentifier ("div") and JSXMemberExpression ("motion.div").
 */
function getTagName(node: AstNode): string | null {
  const name = node.openingElement?.name;
  if (!name) {
    return null;
  }
  if (name.type === "JSXIdentifier") {
    return typeof name.name === "string" ? name.name : null;
  }
  if (name.type === "JSXMemberExpression") {
    const objectName =
      typeof name.object?.name === "string" ? name.object.name : "";
    const propertyName =
      typeof name.property?.name === "string" ? name.property.name : "";
    return `${objectName}.${propertyName}`;
  }
  return null;
}

/**
 * Check if an AST tag name matches a segment name.
 * Handles motion.div matching "motion.div", and also "div" matching "div".
 */
function tagMatches(astTag: string, segmentName: string): boolean {
  if (astTag === segmentName) {
    return true;
  }
  // motion.div → div
  if (astTag.includes(".")) {
    const suffix = astTag.split(".").at(-1) ?? astTag;
    if (suffix === segmentName) {
      return true;
    }
  }
  if (segmentName.includes(".")) {
    const suffix = segmentName.split(".").at(-1) ?? segmentName;
    if (suffix === astTag) {
      return true;
    }
  }
  return false;
}

/**
 * Get a string attribute value from a JSX element.
 * Handles StringLiteral and Literal node types.
 */
function getStringAttr(node: AstNode, attrName: string): string | null {
  const attrs = node.openingElement?.attributes ?? [];
  const attr = attrs.find(
    (a) => a.type === "JSXAttribute" && nodeName(a.name) === attrName
  );
  if (!attr?.value) {
    return null;
  }
  const val = attr.value as AstNode;
  if (val.type === "StringLiteral" || val.type === "Literal") {
    return typeof val.value === "string" ? val.value : null;
  }
  return null;
}

/** Split a raw class string into non-empty whitespace-separated tokens. */
function splitClassTokens(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Extract static class tokens from a `` `flex gap-4 ${dynamic}` `` template literal. */
function classesFromTemplateLiteral(expr: AstNode): string[] {
  const out: string[] = [];
  for (const q of expr.quasis ?? []) {
    const raw = (q.value as { raw?: string } | undefined)?.raw ?? "";
    out.push(...splitClassTokens(raw));
  }
  return out;
}

/** Extract static class tokens from string-literal args of a `cn(...)`/`clsx(...)` call. */
function classesFromCallExpression(expr: AstNode): string[] {
  const out: string[] = [];
  for (const a of expr.arguments ?? []) {
    if (a.type === "StringLiteral" || a.type === "Literal") {
      out.push(...splitClassTokens(a.value));
    }
  }
  return out;
}

/**
 * Extract a JSX element's static className tokens (string literal, template
 * literal quasis, or cn()/clsx() string args). Used to validate the positional
 * `index` discriminator against the captured classHint.
 */
function staticClassesOf(node: AstNode): string[] {
  const attrs = node.openingElement?.attributes ?? [];
  const attr = attrs.find(
    (a) => a.type === "JSXAttribute" && nodeName(a.name) === "className"
  );
  const val = attr?.value as AstNode | undefined;
  if (!val) {
    return [];
  }
  if (val.type === "StringLiteral" || val.type === "Literal") {
    return splitClassTokens(val.value);
  }
  if (val.type === "JSXExpressionContainer") {
    const expr = val.expression;
    if (expr?.type === "TemplateLiteral") {
      return classesFromTemplateLiteral(expr);
    }
    if (expr?.type === "CallExpression") {
      return classesFromCallExpression(expr);
    }
  }
  return [];
}

/** A component's function body plus whether it is an implicit-return expression body. */
interface ComponentFuncBody {
  body: AstNode;
  isExpressionBody: boolean;
}

/**
 * Match: `function ComponentName() {}`. Mirrors the original `.forEach`
 * semantics — if multiple declarations match, the last one in traversal
 * order wins (not the first).
 */
function findFuncBodyFromFunctionDeclaration(
  j: JSCodeshift,
  root: Collection,
  componentName: string
): ComponentFuncBody | null {
  let result: ComponentFuncBody | null = null;
  for (const p of root.find(j.FunctionDeclaration).paths()) {
    if (p.node.id?.name === componentName) {
      result = {
        body: p.node.body as unknown as AstNode,
        isExpressionBody: false,
      };
    }
  }
  return result;
}

/** Match: `const ComponentName = () => {}` or a function-expression initializer. */
function findFuncBodyFromVariableDeclarator(
  j: JSCodeshift,
  root: Collection,
  componentName: string
): ComponentFuncBody | null {
  let result: ComponentFuncBody | null = null;
  for (const p of root.find(j.VariableDeclarator).paths()) {
    if (p.node.id.type !== "Identifier" || p.node.id.name !== componentName) {
      continue;
    }
    const { init } = p.node;
    if (init?.type === "ArrowFunctionExpression") {
      const body = init.body as unknown as AstNode;
      result = { body, isExpressionBody: body.type !== "BlockStatement" };
    } else if (init?.type === "FunctionExpression") {
      result = {
        body: init.body as unknown as AstNode,
        isExpressionBody: false,
      };
    }
  }
  return result;
}

/** Match: `export default function ComponentName() {}` (named, anonymous, or arrow). */
function findFuncBodyFromExportDefault(
  j: JSCodeshift,
  root: Collection,
  componentName: string
): ComponentFuncBody | null {
  let result: ComponentFuncBody | null = null;
  for (const p of root.find(j.ExportDefaultDeclaration).paths()) {
    const decl = p.node.declaration as AstNode;
    const isNamedMatch =
      decl?.type === "FunctionDeclaration" &&
      (decl.id as AstNode | null)?.name === componentName;
    // `export default function() {}` — anonymous default
    const isAnonymousDefault =
      decl?.type === "FunctionDeclaration" &&
      !decl.id &&
      componentName === "default";
    if (isNamedMatch || isAnonymousDefault) {
      result = { body: decl.body as AstNode, isExpressionBody: false };
    }
    if (decl?.type === "ArrowFunctionExpression") {
      const body = decl.body as AstNode;
      result = { body, isExpressionBody: body?.type !== "BlockStatement" };
    }
  }
  return result;
}

/** Locate the JSX element/fragment a component function body returns. */
function findReturnedJSXNode(func: ComponentFuncBody): AstNode | null {
  const { body, isExpressionBody } = func;
  if (isExpressionBody) {
    // Arrow function expression body — the body IS the JSX
    if (body.type === "JSXElement" || body.type === "JSXFragment") {
      return body;
    }
    // Parenthesized expression — sometimes wrapped
    if (body.type === "ParenthesizedExpression") {
      return body.expression ?? null;
    }
    return null;
  }
  // Block body — find the return statement
  const stmts = Array.isArray(body.body) ? body.body : [];
  for (const stmt of stmts) {
    if (stmt.type === "ReturnStatement" && stmt.argument) {
      return stmt.argument;
    }
  }
  return null;
}

/**
 * Find the root JSX element returned by a component function.
 * Searches for function declarations, arrow functions, and export defaults.
 */
function findComponentRootJSX(
  j: JSCodeshift,
  root: Collection,
  componentName: string
): AstPath | null {
  const func =
    findFuncBodyFromFunctionDeclaration(j, root, componentName) ??
    findFuncBodyFromVariableDeclarator(j, root, componentName) ??
    findFuncBodyFromExportDefault(j, root, componentName);
  if (!func) {
    return null;
  }

  const rootJSXNode = findReturnedJSXNode(func);
  if (!rootJSXNode) {
    return null;
  }

  // Convert raw AST node to a jscodeshift path by finding it in the tree.
  // JSXFragment roots have no path here — jscodeshift doesn't easily give
  // paths for fragments, and a structural path assumes a root element.
  if (rootJSXNode.type !== "JSXElement") {
    return null;
  }
  let matchedPath: AstPath | null = null;
  for (const p of root.find(j.JSXElement).paths()) {
    if ((p.node as unknown as AstNode) === rootJSXNode) {
      matchedPath = p as unknown as AstPath;
    }
  }
  return matchedPath;
}

/**
 * Get JSXElement children of a node, filtering out text and expression containers
 * (unless we need expression containers for map-template).
 */
function getJSXElementChildren(node: AstNode): AstNode[] {
  const children = node.children ?? [];
  return children.filter((c) => c.type === "JSXElement");
}

/** Extract the returned/expression body of a `.map()` callback function. */
function mapCallbackJSXBody(mapFn: AstNode): AstNode | null {
  if (
    mapFn.type !== "ArrowFunctionExpression" &&
    mapFn.type !== "FunctionExpression"
  ) {
    return null;
  }
  const body = mapFn.body as AstNode | undefined;
  if (body?.type !== "BlockStatement") {
    // Expression body
    return body ?? null;
  }
  // Find return statement
  const stmts = Array.isArray(body.body) ? body.body : [];
  for (const stmt of stmts) {
    if (stmt.type === "ReturnStatement" && stmt.argument) {
      return stmt.argument;
    }
  }
  return null;
}

/**
 * Unwrap a `.map()` callback's returned JSX (directly, or through a single
 * level of parentheses) and return it if its tag matches `segmentName`.
 */
function matchMapCallbackJSX(
  callbackBody: AstNode | null,
  segmentName: string
): AstNode | null {
  let jsx: AstNode | null = null;
  if (callbackBody?.type === "JSXElement") {
    jsx = callbackBody;
  } else if (
    callbackBody?.type === "ParenthesizedExpression" &&
    callbackBody.expression?.type === "JSXElement"
  ) {
    jsx = callbackBody.expression;
  }
  if (!jsx) {
    return null;
  }
  const tag = getTagName(jsx);
  return tag && tagMatches(tag, segmentName) ? jsx : null;
}

/**
 * Resolve the `.map()`-template discriminator: find a JSXExpressionContainer
 * child whose expression is a `.map(callback)` call, and return the JSX
 * element the callback returns (matching `segment.name`), unwrapping a
 * single level of parentheses if present.
 */
function resolveMapTemplateSegment(
  currentNode: AstNode,
  segment: JSXPathSegment
): AstNode | null {
  const children = currentNode.children ?? [];
  for (const child of children) {
    if (child.type !== "JSXExpressionContainer") {
      continue;
    }
    const expr = child.expression;
    const isMapCall =
      expr?.type === "CallExpression" &&
      expr.callee?.type === "MemberExpression" &&
      expr.callee.property?.name === "map";
    if (!isMapCall) {
      continue;
    }
    const callback = expr.arguments?.[0];
    if (!callback) {
      continue;
    }
    const matched = matchMapCallbackJSX(
      mapCallbackJSXBody(callback),
      segment.name
    );
    if (matched) {
      return matched;
    }
  }
  return null;
}

/**
 * Resolve the `index` discriminator. Validates the positional pick against
 * the captured classHint. Runtime fiber order can diverge from static AST
 * child order (conditionals, fragments, mapped children), so if a single
 * sibling matches the hinted classes strictly better than the positional
 * pick, prefer it. Kept conservative: only override on a unique,
 * unambiguous improvement.
 */
function resolveIndexSegment(
  sameNameChildren: AstNode[],
  index: number,
  hint: string[] | undefined
): AstNode | null {
  const picked = sameNameChildren[index] ?? null;
  if (!hint || hint.length === 0) {
    return picked;
  }
  const score = (child: AstNode): number => {
    const cls = new Set(staticClassesOf(child));
    return hint.filter((h) => cls.has(h)).length;
  };
  const pickedScore = picked ? score(picked) : -1;
  let best = picked;
  let bestScore = pickedScore;
  let tie = false;
  for (const child of sameNameChildren) {
    const s = score(child);
    if (s > bestScore) {
      best = child;
      bestScore = s;
      tie = false;
    } else if (s === bestScore && child !== best) {
      tie = true;
    }
  }
  if (best && best !== picked && bestScore > pickedScore && !tie) {
    return best;
  }
  return picked;
}

/**
 * Resolve a single path segment against the current JSXElement.
 * Returns the matched child JSXElement node (raw AST node, not path), or null.
 */
function resolveSegmentNode(
  currentNode: AstNode,
  segment: JSXPathSegment
): AstNode | null {
  const disc = segment.discriminator;

  if (disc.type === "map-template") {
    return resolveMapTemplateSegment(currentNode, segment);
  }

  // For key, id, index discriminators — filter JSXElement children by name
  const jsxChildren = getJSXElementChildren(currentNode);
  const sameNameChildren = jsxChildren.filter((child) => {
    const tag = getTagName(child);
    return tag !== null && tagMatches(tag, segment.name);
  });

  if (sameNameChildren.length === 0) {
    return null;
  }

  switch (disc.type) {
    case "key": {
      return (
        sameNameChildren.find(
          (child) => getStringAttr(child, "key") === disc.value
        ) ?? null
      );
    }
    case "id": {
      return (
        sameNameChildren.find(
          (child) => getStringAttr(child, "id") === disc.value
        ) ?? null
      );
    }
    case "index": {
      return resolveIndexSegment(
        sameNameChildren,
        disc.value,
        segment.classHint
      );
    }
    case "root": {
      // Should not appear after index 0, but handle gracefully
      return sameNameChildren[0] ?? null;
    }
    default: {
      return null;
    }
  }
}

/**
 * Resolve a JSX structural path to an AST node.
 * Returns the jscodeshift path object for the matched JSXElement, or null if resolution fails.
 */
export function resolveJSXPath(
  j: JSCodeshift,
  root: Collection,
  path: JSXStructuralPath
): AstPath | null {
  if (!path.segments || path.segments.length === 0) {
    return null;
  }

  // Step 1: Find the component's root JSX element
  const rootJSX = findComponentRootJSX(j, root, path.componentName);
  if (!rootJSX) {
    return null;
  }

  // Validate root segment name matches
  const [rootSegment] = path.segments;
  const rootTag = getTagName(rootJSX.node);
  if (rootTag && rootSegment.name && !tagMatches(rootTag, rootSegment.name)) {
    // Root element tag mismatch — path is stale
    return null;
  }

  // If only the root segment, return it
  if (path.segments.length === 1) {
    return rootJSX;
  }

  // Step 2: Walk remaining segments
  let currentNode: AstNode = rootJSX.node;
  let targetNode: AstNode = rootJSX.node;

  for (let i = 1; i < path.segments.length; i += 1) {
    const segment = path.segments[i];
    const nextNode = resolveSegmentNode(currentNode, segment);
    if (!nextNode) {
      return null;
    }
    currentNode = nextNode;
    targetNode = nextNode;
  }

  // Step 3: Convert the raw AST node back to a jscodeshift path
  let matchedPath: AstPath | null = null;
  for (const p of root.find(j.JSXElement).paths()) {
    if ((p.node as unknown as AstNode) === targetNode) {
      matchedPath = p as unknown as AstPath;
    }
  }

  return matchedPath;
}
