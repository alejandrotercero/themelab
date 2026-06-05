import { describe, it, expect, afterEach } from "vitest";
import { executeBatch } from "../batch-transform.js";
import type { BatchOperation } from "@themelab/shared";
import * as fs from "node:fs";
import * as path from "node:path";

const fixturesDir = path.join(__dirname, "fixtures");

/** Write a temp fixture and return helpers. */
function writeFixture(name: string, content: string) {
  const tmp = path.join(fixturesDir, `_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}`);
  fs.writeFileSync(tmp, content, "utf-8");
  return {
    filePath: tmp,
    cleanup: () => {
      try { fs.unlinkSync(tmp); } catch {}
    },
  };
}

describe("element-resolution: deterministic chain", () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups) fn();
    cleanups = [];
  });

  function setup(name: string, content: string) {
    const f = writeFixture(name, content);
    cleanups.push(f.cleanup);
    return f;
  }

  // ── 1. Exact line:col match ─────────────────────────────────────────

  it("resolves element at exact line:col (happy path)", () => {
    const src = `export default function App() {
  return (
    <div className="p-4">
      <span className="text-red-500">Hello</span>
    </div>
  );
}`;
    const { filePath } = setup("exact-match.tsx", src);
    // <span> is at line 4, col 6
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 4, col: 6,
        tagName: "span", className: "text-red-500",
        updates: [{ tailwindPrefix: "text", tailwindToken: "blue-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain("text-blue-500");
  });

  // ── 2. Fallback: fuzzy resolution within component scope ────────────

  it("resolves via fallback when line:col drifts but hints match", () => {
    const src = `export default function App() {
  return (
    <div className="p-4">
      <span id="greeting" className="text-red-500">Hello</span>
    </div>
  );
}`;
    const { filePath } = setup("fallback-match.tsx", src);
    // Give a wrong line (999) but correct hints
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 6,
        tagName: "span", id: "greeting", className: "text-red-500",
        updates: [{ tailwindPrefix: "text", tailwindToken: "blue-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain("text-blue-500");
  });

  // ── 3. Disambiguation by nthOfType ──────────────────────────────────

  it("disambiguates multiple <div> siblings by nthOfType", () => {
    const src = `export default function App() {
  return (
    <div className="container">
      <div className="first">A</div>
      <div className="second">B</div>
      <div className="third">C</div>
    </div>
  );
}`;
    const { filePath } = setup("nth-of-type.tsx", src);
    // Target the second <div> child (nthOfType=1, 0-indexed)
    // Give wrong line so it falls through to fuzzy
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 6,
        tagName: "div", className: "second", nthOfType: 1,
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    // "second" div should get bg-red-500, not "first" or "third"
    expect(updated).toContain('className="second bg-red-500"');
    expect(updated).not.toMatch(/className="first[^"]*bg-red-500/);
    expect(updated).not.toMatch(/className="third[^"]*bg-red-500/);
  });

  // ── 4. Disambiguation by id ─────────────────────────────────────────

  it("disambiguates by id attribute", () => {
    const src = `export default function App() {
  return (
    <div className="wrapper">
      <div className="card" id="card-a">A</div>
      <div className="card" id="card-b">B</div>
    </div>
  );
}`;
    const { filePath } = setup("id-disambig.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        tagName: "div", id: "card-b", className: "card",
        updates: [{ tailwindPrefix: "bg", tailwindToken: "blue-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    // The className appears before id in the source, so check both are present on that element
    expect(updated).toContain('className="card bg-blue-500" id="card-b"');
    expect(updated).not.toContain('className="card bg-blue-500" id="card-a"');
  });

  // ── 5. Disambiguation by jsxKey ─────────────────────────────────────

  it("disambiguates by key prop", () => {
    const src = `export default function App() {
  return (
    <ul>
      <li key="alpha" className="item">Alpha</li>
      <li key="beta" className="item">Beta</li>
    </ul>
  );
}`;
    const { filePath } = setup("key-disambig.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        tagName: "li", jsxKey: "beta", className: "item",
        updates: [{ tailwindPrefix: "bg", tailwindToken: "green-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    // Only the beta item should get bg-green-500
    expect(updated).toMatch(/key="beta"[^>]*bg-green-500/);
    expect(updated).not.toMatch(/key="alpha"[^>]*bg-green-500/);
  });

  // ── 6. Staleness detection ──────────────────────────────────────────

  it("fails with staleness error when mtime/size mismatch", () => {
    const src = `export default function App() {
  return <div className="p-4">Hi</div>;
}`;
    const { filePath } = setup("stale.tsx", src);
    // Pass a deliberately wrong mtime to trigger staleness
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 2, col: 9,
        tagName: "div",
        fileMtime: 1, // deliberately stale
        fileSize: 999, // deliberately wrong
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toMatch(/stale|modified/i);
  });

  // ── 7. No match at all → loud failure ───────────────────────────────

  it("fails loudly when no element matches any hint", () => {
    const src = `export default function App() {
  return <div className="p-4">Only one div</div>;
}`;
    const { filePath } = setup("no-match.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        tagName: "section", className: "nonexistent",
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toBeDefined();
  });

  // ── 8. moveSpacing: negative margin cleanup ─────────────────────────

  it("cleans existing translate before applying new translate", () => {
    const src = `export default function App() {
  return <div className="-translate-y-4 p-2">Content</div>;
}`;
    const { filePath } = setup("neg-translate.tsx", src);
    const result = executeBatch(
      [{
        op: "moveSpacing", file: filePath, line: 2, col: 9,
        axis: "y", token: "8", pxDelta: 48, direction: "positive", layoutContext: "block",
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain("translate-y-8");
    expect(updated).not.toContain("-translate-y-4");
  });

  it("applies negative translate for negative direction", () => {
    const src = `export default function App() {
  return <div className="translate-y-4 p-2">Content</div>;
}`;
    const { filePath } = setup("pos-to-neg-translate.tsx", src);
    const result = executeBatch(
      [{
        op: "moveSpacing", file: filePath, line: 2, col: 9,
        axis: "y", token: "8", pxDelta: -48, direction: "negative", layoutContext: "block",
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain("-translate-y-8");
    expect(updated).not.toContain("translate-y-4");
  });

  // ── 9. Staleness guards the structural path ─────────────────────────

  it("rejects a stale edit even when the structural path resolves", () => {
    const src = `export default function App() {
  return <div className="p-4">Hi</div>;
}`;
    const { filePath } = setup("stale-path.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 2, col: 9,
        tagName: "div",
        // A structural path that WOULD resolve — proving staleness now runs first.
        jsxPath: { componentName: "App", filePath, segments: [{ name: "div", discriminator: { type: "root" } }] },
        fileMtime: 1, fileSize: 999, // deliberately stale
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toMatch(/FILE_CHANGED|stale|modified/i);
    expect(fs.readFileSync(filePath, "utf-8")).not.toContain("bg-red-500");
  });

  it("succeeds when the staleness baseline matches the current file", () => {
    const src = `export default function App() {
  return <div className="p-4">Hi</div>;
}`;
    const { filePath } = setup("fresh-stat.tsx", src);
    const stat = fs.statSync(filePath);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 2, col: 9,
        tagName: "div",
        fileMtime: stat.mtimeMs, fileSize: stat.size, // accurate baseline
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toContain("bg-red-500");
  });

  // ── 10. Subset matching beats bidirectional overlap ─────────────────

  it("prefers the subset match over a sibling with higher raw class overlap", () => {
    // DOM className includes runtime-injected classes (bg-blue-500, px-2) that
    // the source does NOT have. The true node's static classes are a subset of
    // the DOM set; the decoy sibling shares MORE raw classes with the DOM but
    // isn't a subset (its bg-red-500 isn't in the DOM). Old overlap scoring
    // picked the decoy; subset matching picks the true node.
    const src = `export default function App() {
  return (
    <section>
      <div className="flex gap-4">A</div>
      <div className="flex gap-4 bg-red-500 px-2">B</div>
    </section>
  );
}`;
    const { filePath } = setup("subset-vs-overlap.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        tagName: "div", className: "flex gap-4 bg-blue-500 px-2",
        updates: [{ tailwindPrefix: "text", tailwindToken: "white", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain('className="flex gap-4 text-white"'); // true node
    expect(updated).not.toMatch(/bg-red-500[^"]*text-white/); // not the decoy
  });

  // ── 10b. Class edit disambiguated by visible text ───────────────────

  it("disambiguates identical-class siblings by visible text on a class edit", () => {
    const src = `export default function App() {
  return (
    <div className="row">
      <button className="btn">Save</button>
      <button className="btn">Cancel</button>
    </div>
  );
}`;
    const { filePath } = setup("text-hint.tsx", src);
    // Both buttons share className "btn" — only the text tells them apart.
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        tagName: "button", className: "btn", text: "Cancel",
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toMatch(/className="btn bg-red-500">Cancel/);
    expect(updated).not.toMatch(/className="btn bg-red-500">Save/);
  });

  // ── 11. Genuine ambiguity fails loudly (no silent guess) ────────────

  it("fails with AMBIGUOUS when identical siblings can't be disambiguated", () => {
    const src = `export default function App() {
  return (
    <div className="wrap">
      <div className="card">A</div>
      <div className="card">B</div>
    </div>
  );
}`;
    const { filePath } = setup("ambiguous.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        tagName: "div", className: "card", // no id/key/nthOfType to break the tie
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toMatch(/AMBIGUOUS/);
    expect(fs.readFileSync(filePath, "utf-8")).not.toContain("bg-red-500");
  });

  // ── 12. Structural path gated by identity (tag), then falls through ──

  it("rejects a tag-contradicting structural path and resolves via fuzzy", () => {
    const src = `export default function App() {
  return (
    <div className="wrapper">
      <span className="target text-red-500">Hi</span>
    </div>
  );
}`;
    const { filePath } = setup("path-tag-gate.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        // Path resolves to the root <div>, but the captured element is a <span>.
        // verifyIdentity rejects on tag, so it falls through to fuzzy hints.
        tagName: "span", className: "target text-red-500",
        jsxPath: { componentName: "App", filePath, segments: [{ name: "div", discriminator: { type: "root" } }] },
        updates: [{ tailwindPrefix: "text", tailwindToken: "blue-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain("text-blue-500");
    expect(updated).toContain('className="wrapper"'); // div untouched
  });

  // ── 13. classHint corrects fiber-vs-AST index drift ─────────────────

  it("uses classHint to correct a wrong positional index in the structural path", () => {
    const src = `export default function App() {
  return (
    <ul>
      <li className="a">A</li>
      <li className="b">B</li>
    </ul>
  );
}`;
    const { filePath } = setup("classhint-index.tsx", src);
    const result = executeBatch(
      [{
        op: "updateClass", file: filePath, line: 999, col: 0,
        tagName: "li", className: "b",
        // index points at the FIRST <li> (a), but classHint identifies the second.
        jsxPath: {
          componentName: "App", filePath,
          segments: [
            { name: "ul", discriminator: { type: "root" } },
            { name: "li", discriminator: { type: "index", value: 0 }, classHint: ["b"] },
          ],
        },
        updates: [{ tailwindPrefix: "bg", tailwindToken: "green-500", value: "" }],
      }],
      path.dirname(filePath),
    );
    expect(result.results[0].success).toBe(true);
    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toMatch(/className="b bg-green-500"/);
    expect(updated).not.toMatch(/className="a bg-green-500"/);
  });
});
