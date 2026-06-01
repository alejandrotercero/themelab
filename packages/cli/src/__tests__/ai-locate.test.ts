import { describe, it, expect, afterEach } from "vitest";
import {
  executeBatchWithAi,
  readFileTool,
  validateAnswer,
  type LocateFn,
} from "../ai-locate.js";
import { executeBatch } from "../batch-transform.js";
import type { BatchOperation } from "@react-rewrite/shared";
import * as fs from "node:fs";
import * as path from "node:path";

const fixturesDir = path.join(__dirname, "fixtures");

function writeFixture(name: string, content: string) {
  const tmp = path.join(fixturesDir, `_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}`);
  fs.writeFileSync(tmp, content, "utf-8");
  return { filePath: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch {} } };
}

const TWO_CARDS = `export default function App() {
  return (
    <div className="wrap">
      <div className="card">A</div>
      <div className="card">B</div>
    </div>
  );
}`;

function classOp(filePath: string, extra: Partial<any> = {}): BatchOperation {
  return {
    op: "updateClass", file: filePath, line: 999, col: 0,
    tagName: "div", className: "card",
    updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
    ...extra,
  } as BatchOperation;
}

describe("ai-locate: executeBatchWithAi", () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { for (const fn of cleanups) fn(); cleanups = []; });
  function setup(name: string, content: string) {
    const f = writeFixture(name, content); cleanups.push(f.cleanup); return f;
  }

  it("auto-applies a 'direct' resolution to the AI-chosen candidate", async () => {
    const { filePath } = setup("direct.tsx", TWO_CARDS);
    const locate: LocateFn = async (input) => {
      const c = input.candidates[input.candidates.length - 1]; // second card
      return { filePath: input.primaryFile.path, line: c.line, col: c.col, kind: "direct", reasoning: "second card" };
    };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(true);
    expect(res.results[0].resolvedBy).toBe("ai");
    expect(res.results[0].aiKind).toBe("direct");
    const out = fs.readFileSync(filePath, "utf-8");
    expect(out).toMatch(/className="card bg-red-500">B/); // second card edited
    expect(out).not.toMatch(/className="card bg-red-500">A/);
    expect(res.proposals).toBeUndefined();
  });

  it("auto-applies a cross-file 'conditional' resolution and ignores the stale baseline", async () => {
    // The real live case: owner stack pointed at the wrong file (page.tsx has no
    // <p>), the AI located the empty-state <p> in another file's conditional, and
    // the op carried page.tsx's staleness baseline. Must apply to the resolved
    // file without FILE_CHANGED, and without a confirm step (it's the selected element).
    const pageSrc = `export default function Page() {
  return <div className="wrap"><Card /></div>;
}`;
    const compSrc = `export function Card({ items }) {
  if (items.length > 0) return <ul/>;
  return <p className="empty">No active assignments</p>;
}`;
    const page = setup("page.tsx", pageSrc);
    const comp = setup("comp.tsx", compSrc);
    const dir = path.dirname(page.filePath);
    const pageStat = fs.statSync(page.filePath);
    const compRel = path.basename(comp.filePath);
    const locate: LocateFn = async () => ({
      filePath: compRel, line: 3, col: 9, kind: "conditional", reasoning: "else branch of the items check",
    });
    const op = classOp(page.filePath, {
      tagName: "p", className: "", text: "No active assignments",
      fileMtime: pageStat.mtimeMs, fileSize: pageStat.size, // baseline is for page.tsx
    });
    const res = await executeBatchWithAi([op], dir, { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(true); // not blocked by FILE_CHANGED
    expect(res.results[0].resolvedBy).toBe("ai");
    expect(res.results[0].file).toBe(compRel);
    expect(res.proposals).toBeUndefined(); // conditional = the selected element → no confirm
    expect(fs.readFileSync(comp.filePath, "utf-8")).toContain('className="empty bg-red-500"');
    expect(fs.readFileSync(page.filePath, "utf-8")).toBe(pageSrc); // page untouched
  });

  it("returns a proposal (no write) for a structural 'map-template' resolution", async () => {
    const { filePath } = setup("structural.tsx", TWO_CARDS);
    const before = fs.readFileSync(filePath, "utf-8");
    const locate: LocateFn = async (input) => {
      const c = input.candidates[0];
      return { filePath: input.primaryFile.path, line: c.line, col: c.col, kind: "map-template", reasoning: "the .map template" };
    };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(false); // not auto-applied
    expect(res.results[0].aiKind).toBe("map-template");
    expect(res.proposals?.length).toBe(1);
    expect(res.proposals![0].target.kind).toBe("map-template");
    expect(fs.readFileSync(filePath, "utf-8")).toBe(before); // file untouched
  });

  it("stays AMBIGUOUS when the locator returns null", async () => {
    const { filePath } = setup("null.tsx", TWO_CARDS);
    const before = fs.readFileSync(filePath, "utf-8");
    const locate: LocateFn = async () => null;
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toMatch(/AMBIGUOUS/);
    expect(fs.readFileSync(filePath, "utf-8")).toBe(before);
  });

  it("does not invoke the locator when AI is disabled", async () => {
    const { filePath } = setup("disabled.tsx", TWO_CARDS);
    let called = false;
    const locate: LocateFn = async () => { called = true; return null; };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), { apiKey: undefined, enableAi: false, locate });
    expect(called).toBe(false);
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toMatch(/AMBIGUOUS/);
  });

  it("forceAi resolves via the locator even when deterministic would succeed", async () => {
    const src = `export default function App() {
  return (
    <div>
      <button className="btn">One</button>
      <button className="btn2">Two</button>
    </div>
  );
}`;
    const { filePath } = setup("force.tsx", src);
    const lines = src.split("\n");
    const line = lines.findIndex((l) => l.includes("btn2")) + 1;
    let called = false;
    const locate: LocateFn = async (input) => {
      called = true; // forced — picks the SECOND button regardless of the op's coords
      return { filePath: input.primaryFile.path, line, col: lines[line - 1].indexOf("<button"), kind: "direct", reasoning: "forced" };
    };
    const op = classOp(filePath, { tagName: "button", className: "btn", text: "One", line: 4, col: 6 });
    const res = await executeBatchWithAi([op], path.dirname(filePath), { apiKey: "k", enableAi: true, forceAi: true, locate });
    expect(called).toBe(true);
    expect(res.results[0].success).toBe(true);
    expect(res.results[0].resolvedBy).toBe("ai");
    const out = fs.readFileSync(filePath, "utf-8");
    expect(out).toContain('className="btn2 bg-red-500"'); // the AI's pick
    expect(out).not.toContain('className="btn bg-red-500"'); // not the deterministic one
  });

  it("invalidates the cache when an AI-resolved apply fails (so a retry re-resolves)", async () => {
    const src = `export default function App() {
  return <div className="x">hi</div>;
}`;
    const { filePath } = setup("invalidate.tsx", src);
    let calls = 0;
    const locate: LocateFn = async (input) => {
      calls++;
      return { filePath: input.primaryFile.path, line: 1, col: 0, kind: "direct", reasoning: "bad line (no JSX)" };
    };
    const mk = () => classOp(filePath, { tagName: "span", className: "", text: "hi" }); // no <span> → escalates
    const res1 = await executeBatchWithAi([mk()], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res1.results[0].success).toBe(false); // line 1 has no JSX → apply fails
    const res2 = await executeBatchWithAi([mk()], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(calls).toBe(2); // cache was invalidated → re-resolved instead of a cache hit
    expect(res2.results[0].success).toBe(false);
  });

  it("escalates a no-match with ZERO candidates (component-instance case)", async () => {
    // No <p> exists in this file — the element is rendered by a reused component.
    // This is the case the deterministic resolver can't help with, and the one
    // that was wrongly excluded from escalation.
    const src = `export default function Page() {
  return <div className="wrap"><span>hi</span></div>;
}`;
    const { filePath } = setup("no-candidates.tsx", src);
    const before = fs.readFileSync(filePath, "utf-8");
    let seenCandidates: unknown = "unset";
    const locate: LocateFn = async (input) => {
      seenCandidates = input.candidates;
      return { filePath: input.primaryFile.path, line: 2, col: 10, kind: "instance", reasoning: "rendered by a component" };
    };
    const op = classOp(filePath, { tagName: "p", className: "" }); // 0 <p> candidates
    const res = await executeBatchWithAi([op], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(seenCandidates).toEqual([]); // escalated even with no candidates
    expect(res.proposals?.length).toBe(1); // cross-component → proposal, not auto-write
    expect(res.proposals![0].target.kind).toBe("instance");
    expect(fs.readFileSync(filePath, "utf-8")).toBe(before);
  });

  it("does not collide the cache for siblings sharing coords/class but differing in text", async () => {
    // Four <h4 className="font-medium"> all mis-resolve to the same owner-stack
    // coords; only their text differs. Editing a second one must resolve to ITS
    // element, not reuse the first's cached location.
    const src = `export default function Page() {
  return (
    <div>
      <h4 className="font-medium">Application</h4>
      <h4 className="font-medium">Version</h4>
    </div>
  );
}`;
    const { filePath } = setup("siblings.tsx", src);
    const dir = path.dirname(filePath);
    const lines = src.split("\n");
    const lineOf = (t: string) => lines.findIndex((l) => l.includes(`>${t}<`)) + 1;
    const locate: LocateFn = async (input) => {
      const t = input.identity.text ?? "";
      const line = lineOf(t);
      return { filePath: input.primaryFile.path, line, col: lines[line - 1].indexOf("<h4"), kind: "direct", reasoning: t };
    };
    const ai = { apiKey: "k", enableAi: true, locate };
    const resA = await executeBatchWithAi([classOp(filePath, { tagName: "h4", className: "font-medium", text: "Application" })], dir, ai);
    const resB = await executeBatchWithAi([classOp(filePath, { tagName: "h4", className: "font-medium", text: "Version" })], dir, ai);
    expect(resA.results[0].success).toBe(true);
    expect(resB.results[0].success).toBe(true);
    const out = fs.readFileSync(filePath, "utf-8");
    expect(out).toContain('className="font-medium bg-red-500">Application'); // first element
    expect(out).toContain('className="font-medium bg-red-500">Version'); // SECOND element, not a re-edit of the first
  });

  it("keeps undo integrity across a mixed batch (resolvable + AI-resolved, same file)", async () => {
    // op A: the wrapper div, resolvable directly by id; op B: ambiguous card → AI.
    const src = `export default function App() {
  return (
    <div id="wrap" className="wrap">
      <div className="card">A</div>
      <div className="card">B</div>
    </div>
  );
}`;
    const { filePath } = setup("mixed.tsx", src);
    const original = fs.readFileSync(filePath, "utf-8");
    const opA = classOp(filePath, { tagName: "div", className: "wrap", id: "wrap", line: 3,
      updates: [{ tailwindPrefix: "p", tailwindToken: "4", value: "4" }] });
    const opB = classOp(filePath); // ambiguous card
    const locate: LocateFn = async (input) => {
      const c = input.candidates[input.candidates.length - 1];
      return { filePath: input.primaryFile.path, line: c.line, col: c.col, kind: "direct", reasoning: "second" };
    };
    const res = await executeBatchWithAi([opA, opB], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(true);
    expect(res.results[1].success).toBe(true);
    expect(res.results[1].resolvedBy).toBe("ai");
    const out = fs.readFileSync(filePath, "utf-8");
    expect(out).toContain("bg-red-500");
    expect(out).toContain("p-4");
    // undo entries present; reverting them (latest-first) restores the original.
    expect(res.undoEntries.length).toBeGreaterThanOrEqual(1);
    const first = res.undoEntries[0];
    fs.writeFileSync(filePath, first.content, "utf-8");
    expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
  });
});

describe("ai-locate: candidate surfacing (no AI)", () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { for (const fn of cleanups) fn(); cleanups = []; });

  it("attaches candidate locations to an AMBIGUOUS result and none to a success", () => {
    const f = writeFixture("cands.tsx", TWO_CARDS); cleanups.push(f.cleanup);
    const ambiguous = executeBatch([classOp(f.filePath)], path.dirname(f.filePath));
    expect(ambiguous.results[0].success).toBe(false);
    expect(ambiguous.results[0].candidates?.length).toBe(2);
    for (const c of ambiguous.results[0].candidates!) {
      expect(typeof c.line).toBe("number");
      expect(typeof c.col).toBe("number");
    }
    const ok = executeBatch(
      [classOp(f.filePath, { line: 4, col: 6, className: "card", nthOfType: 0 })],
      path.dirname(f.filePath),
    );
    expect(ok.results[0].success).toBe(true);
    expect(ok.results[0].candidates).toBeUndefined();
  });
});

describe("ai-locate: trustLocation re-run", () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { for (const fn of cleanups) fn(); cleanups = []; });

  it("applies at the AI location across a DOM≠source tag mismatch (<Link>→<a>)", () => {
    // The nav link is a <Link> in source but an <a> in the DOM. A normal resolve
    // finds 0 <a> candidates; once the AI points at the <Link>, the re-run must
    // trust it and apply despite the tag mismatch — and tolerate a column that's
    // slightly off (col 15 vs the real 14).
    const src = `export function Sidebar() {
  return <nav><Link href="/x" className="px-3 py-2">Home</Link></nav>;
}`;
    const f = writeFixture("link.tsx", src); cleanups.push(f.cleanup);
    const res = executeBatch(
      [{
        op: "updateClass", file: f.filePath, line: 2, col: 15,
        tagName: "a", className: "px-3 py-2", trustLocation: true,
        updates: [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "" }],
      }],
      path.dirname(f.filePath),
    );
    expect(res.results[0].success).toBe(true);
    const out = fs.readFileSync(f.filePath, "utf-8");
    expect(out).toContain('className="px-3 py-2 bg-red-500"');
    expect(out).toContain("</Link>"); // edited the Link, structure intact
  });
});

describe("ai-locate: tool guardrails", () => {
  it("read_file rejects paths outside the project root", () => {
    const out = readFileTool({ path: "../../../../etc/passwd" }, fixturesDir);
    expect(out).toMatch(/ERROR/);
  });

  it("validateAnswer rejects out-of-project paths and bad kinds", () => {
    expect(validateAnswer({ filePath: "../../x.tsx", line: 1, col: 0, kind: "direct" }, fixturesDir)).toBeNull();
    expect(validateAnswer({ filePath: "a.tsx", line: 1, col: 0, kind: "nope" }, fixturesDir)).toBeNull();
    expect(validateAnswer({ filePath: "a.tsx", line: 0, col: 0, kind: "direct" }, fixturesDir)).toBeNull();
    const ok = validateAnswer({ filePath: "a.tsx", line: 3, col: 4, kind: "map-template", reasoning: "x" }, fixturesDir);
    expect(ok).toEqual({ filePath: "a.tsx", line: 3, col: 4, kind: "map-template", reasoning: "x" });
  });
});
