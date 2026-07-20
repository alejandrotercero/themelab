import type { JSXStructuralPath, JSXPathSegment } from "@themelab/shared";
import {
  getFiberFromHostInstance,
  getDisplayName,
  isCompositeFiber,
} from "bippy";
import type { Fiber } from "bippy";

// HTML tag names for filtering out React internals
const HTML_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "base",
  "bdi",
  "bdo",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "map",
  "mark",
  "menu",
  "meta",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "search",
  "section",
  "select",
  "slot",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

/**
 * Determine the path-segment name for a fiber, or null if this fiber should
 * be skipped (not a host element or not a user-level composite component).
 */
function getSegmentName(
  current: Fiber,
  fiberType: Fiber["type"]
): string | null {
  if (typeof fiberType === "string") {
    // Host fiber (div, span, etc.)
    return fiberType;
  }
  if (isCompositeFiber(current)) {
    // Composite fiber — get display name
    const displayName = getDisplayName(current);
    // Only include user-level components (uppercase first letter)
    if (
      displayName &&
      displayName[0] === displayName[0].toUpperCase() &&
      /^[A-Z]/.test(displayName)
    ) {
      return displayName;
    }
  }
  return null;
}

/** Compute the discriminator (explicit key or sibling index) for a segment. */
function computeDiscriminator(
  current: Fiber,
  fiberType: Fiber["type"]
): JSXPathSegment["discriminator"] {
  if (
    current.key !== null &&
    current.key !== undefined &&
    !String(current.key).startsWith(".")
  ) {
    // Explicit key (not auto-generated)
    return { type: "key", value: String(current.key) };
  }

  // Compute sibling index: count same-type fibers before this one
  let siblingIndex = 0;
  if (current.return) {
    const { child: firstSibling } = current.return;
    let sibling = firstSibling;
    while (sibling && sibling !== current) {
      // Match by type: === for functions, string comparison for host elements
      if (sibling.type === fiberType) {
        siblingIndex += 1;
      }
      ({ sibling } = sibling);
    }
  }
  return { type: "index", value: siblingIndex };
}

/** First 3 classes if the fiber has a DOM element, otherwise undefined. */
function computeClassHint(current: Fiber): string[] | undefined {
  if (!(current.stateNode instanceof HTMLElement)) {
    return undefined;
  }
  const { className } = current.stateNode;
  if (className && typeof className === "string") {
    const classes = className.split(/\s+/).filter(Boolean).slice(0, 3);
    if (classes.length > 0) {
      return classes;
    }
  }
  return undefined;
}

/**
 * Build a deterministic JSX structural path from a DOM element up to its
 * owning component boundary.
 *
 * Returns null if the fiber tree can't be walked or the component boundary
 * isn't found.
 */
export function buildJSXPath(
  element: HTMLElement,
  filePath: string,
  componentName: string
): JSXStructuralPath | null {
  const fiber = getFiberFromHostInstance(element);
  if (!fiber) {
    return null;
  }

  const segments: JSXPathSegment[] = [];
  let current: typeof fiber | null = fiber;
  let foundBoundary = false;

  while (current) {
    // Check if this is the component boundary (composite fiber matching componentName)
    if (isCompositeFiber(current)) {
      const name = getDisplayName(current);
      if (name === componentName) {
        foundBoundary = true;
        break;
      }
    }

    // Determine if this fiber should be included as a path segment
    const fiberType = current.type;

    // Skip fibers with symbol types (Fragment, StrictMode, Suspense, Context, etc.)
    if (typeof fiberType === "symbol") {
      current = current.return;
      continue;
    }

    const name = getSegmentName(current, fiberType);

    if (name === null) {
      current = current.return;
      continue;
    }

    // Skip non-HTML lowercase names that slipped through (e.g. from non-string non-symbol types)
    if (name[0] === name[0].toLowerCase() && !HTML_TAGS.has(name)) {
      current = current.return;
      continue;
    }

    const discriminator = computeDiscriminator(current, fiberType);
    const classHint = computeClassHint(current);

    segments.push({ name, discriminator, classHint });

    current = current.return;
  }

  if (!foundBoundary) {
    return null;
  }

  // Walk was bottom-up; path should be top-down
  segments.reverse();

  // Set the first segment's discriminator to root
  if (segments.length > 0) {
    segments[0].discriminator = { type: "root" };
  }

  return {
    componentName,
    filePath,
    segments,
  };
}
