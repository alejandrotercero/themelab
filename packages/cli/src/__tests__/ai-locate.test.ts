import { describe, it, expect, afterEach } from "vitest";
import {
  executeBatchWithAi,
  readFileTool,
  findComponentDefinitionTool,
  validateAnswer,
  type LocateFn,
  type LocateAttemptOptions,
} from "../ai-locate.js";
import { executeBatch } from "../batch-transform.js";
import type { BatchOperation } from "@themelab/shared";
import * as fs from "node:fs";
import * as os from "node:os";
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

  it("surfaces an AI failure message when the locator returns null", async () => {
    const { filePath } = setup("null.tsx", TWO_CARDS);
    const before = fs.readFileSync(filePath, "utf-8");
    const locate: LocateFn = async () => null;
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toMatch(/AI couldn't pinpoint/i); // AI ran and failed → AI message
    expect(fs.readFileSync(filePath, "utf-8")).toBe(before);
  });

  it("surfaces the AI's reason when it calls cannot_locate", async () => {
    const { filePath } = setup("cant.tsx", TWO_CARDS);
    const locate: LocateFn = async () => ({ cannotLocate: "the value is generated from server data not in the codebase" });
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toMatch(/AI couldn't locate this element — the value is generated/i);
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

  it("moveSibling escalates to the AI (cross-file) and applies the swap", async () => {
    const pageSrc = `export default function Page() { return <div><Items/></div>; }`;
    const realSrc = `export function Items() {
  return (
    <ul>
      <li className="row">Alpha</li>
      <li className="row">Beta</li>
    </ul>
  );
}`;
    const page = setup("mvpage.tsx", pageSrc);
    const real = setup("mvitems.tsx", realSrc);
    const dir = path.dirname(page.filePath);
    const rLines = realSrc.split("\n");
    const betaLine = rLines.findIndex((l) => l.includes("Beta")) + 1;
    const realRel = path.basename(real.filePath);
    const locate: LocateFn = async () => ({ filePath: realRel, line: betaLine, col: rLines[betaLine - 1].indexOf("<li"), kind: "direct", reasoning: "Beta li" });
    // owner stack pointed at page.tsx (no <li>) → 0 candidates → escalate
    const op = { op: "moveSibling", file: page.filePath, line: 999, col: 0, direction: "up", tagName: "li", className: "row", text: "Beta" } as BatchOperation;
    const res = await executeBatchWithAi([op], dir, { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(true);
    const out = fs.readFileSync(real.filePath, "utf-8");
    expect(out.indexOf("Beta")).toBeLessThan(out.indexOf("Alpha")); // Beta moved up
    expect(fs.readFileSync(page.filePath, "utf-8")).toBe(pageSrc); // page untouched
  });

  it("moveSibling escalates when it resolves a no-sibling component root", async () => {
    // Selecting a <Card> resolves to the Card primitive's root <div> (no
    // siblings) → swap throws "no sibling container" → escalate → AI finds the
    // <Card> USAGE in the grid (which has siblings).
    const cardSrc = `export function Card(props) {
  return <div className="bg-card">{props.children}</div>;
}`;
    const dashSrc = `import { Card } from "./card";
export default function Dash() {
  return (
    <div className="grid">
      <Card>Total Parts</Card>
      <Card>Users</Card>
    </div>
  );
}`;
    const card = setup("card.tsx", cardSrc);
    const dash = setup("dash.tsx", dashSrc);
    const dir = path.dirname(card.filePath);
    const cLines = cardSrc.split("\n");
    const dLines = dashSrc.split("\n");
    const divLine = cLines.findIndex((l) => l.includes("bg-card")) + 1;
    const tpLine = dLines.findIndex((l) => l.includes("Total Parts")) + 1;
    const dashRel = path.basename(dash.filePath);
    const locate: LocateFn = async () => ({ filePath: dashRel, line: tpLine, col: dLines[tpLine - 1].indexOf("<Card"), kind: "direct", reasoning: "the <Card> usage in the grid" });
    const op = { op: "moveSibling", file: card.filePath, line: divLine, col: cLines[divLine - 1].indexOf("<div"), direction: "down", tagName: "div", className: "bg-card", componentName: "Card", text: "Total Parts" } as BatchOperation;
    const res = await executeBatchWithAi([op], dir, { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(true);
    const out = fs.readFileSync(dash.filePath, "utf-8");
    expect(out.indexOf("Users")).toBeLessThan(out.indexOf("Total Parts")); // Total Parts moved down past Users
    expect(fs.readFileSync(card.filePath, "utf-8")).toBe(cardSrc); // primitive untouched
  });

  it("moveSibling on a .map() item is reported (map-template), nothing moved", async () => {
    const src = `export function Nav() {
  return (
    <nav>
      {links.map((l) => <a key={l.href} className="link">{l.label}</a>)}
      <div className="footer">Logout</div>
    </nav>
  );
}`;
    const { filePath } = setup("mapmove.tsx", src);
    const before = fs.readFileSync(filePath, "utf-8");
    const lines = src.split("\n");
    const aLine = lines.findIndex((l) => l.includes("<a ")) + 1;
    const locate: LocateFn = async (input) => ({ filePath: input.primaryFile.path, line: aLine, col: lines[aLine - 1].indexOf("<a"), kind: "map-template", reasoning: "the mapped <a> template — not JSX-reorderable" });
    const op = { op: "moveSibling", file: filePath, line: 999, col: 0, direction: "down", tagName: "a", className: "link", text: "Users" } as BatchOperation;
    const res = await executeBatchWithAi([op], path.dirname(filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].aiKind).toBe("map-template"); // surfaced as a list item
    expect(fs.readFileSync(filePath, "utf-8")).toBe(before); // nothing moved
  });

  it("reorderArrayItem swaps adjacent array elements", () => {
    const src = `export const links = [
  { href: "/", label: "Dashboard" },
  { href: "/users", label: "Users" },
  { href: "/parts", label: "Parts" },
];`;
    const f = writeFixture("arr.tsx", src); cleanups.push(f.cleanup);
    const usersLine = src.split("\n").findIndex((l) => l.includes('"Users"')) + 1;
    const res = executeBatch(
      [{ op: "reorderArrayItem", file: f.filePath, line: usersLine, col: src.split("\n")[usersLine - 1].indexOf("{"), direction: "down" }],
      path.dirname(f.filePath),
    );
    expect(res.results[0].success).toBe(true);
    const out = fs.readFileSync(f.filePath, "utf-8");
    expect(out.indexOf("Parts")).toBeLessThan(out.indexOf("Users")); // Users moved down past Parts
  });

  it("moveSibling on a mapped item proposes an array reorder, applied on confirm", async () => {
    const src = `export function Nav() {
  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/users", label: "Users" },
  ];
  return <nav>{links.map((l) => <a key={l.href} className="link">{l.label}</a>)}</nav>;
}`;
    const f = setup("navarr.tsx", src);
    const before = fs.readFileSync(f.filePath, "utf-8");
    const lines = src.split("\n");
    const arrLine = lines.findIndex((l) => l.includes('"Users"')) + 1;
    const locate: LocateFn = async (input) => ({ filePath: input.primaryFile.path, line: arrLine, col: lines[arrLine - 1].indexOf("{"), kind: "array-item", reasoning: "the Users entry in the links array" });
    const op = { op: "moveSibling", file: f.filePath, line: 999, col: 0, direction: "up", tagName: "a", className: "link", text: "Users" } as BatchOperation;
    const res = await executeBatchWithAi([op], path.dirname(f.filePath), { apiKey: "k", enableAi: true, locate });
    expect(res.results[0].success).toBe(false); // proposal, not auto-applied
    expect(res.proposals?.[0].op.op).toBe("reorderArrayItem");
    expect(fs.readFileSync(f.filePath, "utf-8")).toBe(before); // unchanged until confirm

    // Simulate confirm: apply the proposal's op at the resolved location.
    const p = res.proposals![0];
    const applied = executeBatch([{ ...p.op, file: p.target.filePath, line: p.target.line, col: p.target.col } as BatchOperation], path.dirname(f.filePath));
    expect(applied.results[0].success).toBe(true);
    const out = fs.readFileSync(f.filePath, "utf-8");
    expect(out.indexOf("Users")).toBeLessThan(out.indexOf("Dashboard")); // Users moved up
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

describe("ai-locate: read_file window + computed-value grep", () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { for (const fn of cleanups) fn(); cleanups = []; });

  it("read_file honors offset/limit and keeps real line numbers", () => {
    const f = writeFixture("big.tsx", Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n"));
    cleanups.push(f.cleanup);
    const out = readFileTool({ path: path.basename(f.filePath), offset: 10, limit: 3 }, path.dirname(f.filePath));
    expect(out).toContain("10: line 10");
    expect(out).toContain("12: line 12");
    expect(out).not.toContain("1: line 1\n"); // not dumped from the top
    expect(out).toMatch(/more lines/); // tail hint for paging
  });

  it("seeds the locator via a surrounding label when the element text is computed", async () => {
    const src = `export default function Dash() {
  return (
    <div>
      <h3 className="text-sm font-medium">Total Parts XYZ</h3>
      <div className="text-base">{count}</div>
    </div>
  );
}`;
    const f = writeFixture("computed.tsx", src); cleanups.push(f.cleanup);
    let seen: Array<{ text: string }> | undefined;
    const locate: LocateFn = async (input) => { seen = input.textMatches; return null; };
    const op = {
      op: "updateClass", file: f.filePath, line: 999, col: 0,
      tagName: "div", className: "text-base", text: "20", contextText: "Total Parts XYZ 20",
      updates: [{ tailwindPrefix: "text", tailwindToken: "2xl", value: "" }],
    } as BatchOperation;
    await executeBatchWithAi([op], path.dirname(f.filePath), { apiKey: "k", enableAi: true, forceAi: true, locate });
    expect(seen?.some((m) => m.text.includes("Total Parts XYZ"))).toBe(true);
  });
});

describe("ai-locate: tiered escalation", () => {
  let cleanups: Array<() => void> = [];
  afterEach(() => { for (const fn of cleanups) fn(); cleanups = []; });
  function setup(name: string, content: string) {
    const f = writeFixture(name, content); cleanups.push(f.cleanup); return f;
  }

  it("escalates to tier 2 on a tier-1 null and applies its resolution", async () => {
    const { filePath } = setup("tier-null.tsx", TWO_CARDS);
    const tiersSeen: number[] = [];
    const escalateTiers: number[] = [];
    const locate: LocateFn = async (input, opts) => {
      tiersSeen.push(opts.tier);
      if (opts.tier === 1) return null;
      const c = input.candidates[input.candidates.length - 1];
      return { filePath: input.primaryFile.path, line: c.line, col: c.col, kind: "direct", reasoning: "tier-2 pick" };
    };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), {
      apiKey: "k", enableAi: true, locate,
      escalation: { enabled: true },
      onEscalate: (tier) => escalateTiers.push(tier),
    });
    expect(tiersSeen).toEqual([1, 2]);
    expect(escalateTiers).toEqual([1, 2]);
    expect(res.results[0].success).toBe(true);
    expect(res.results[0].resolvedBy).toBe("ai");
  });

  it("does not run tier 2 when tier 1 succeeds", async () => {
    const { filePath } = setup("tier-ok.tsx", TWO_CARDS);
    const tiersSeen: number[] = [];
    const locate: LocateFn = async (input, opts) => {
      tiersSeen.push(opts.tier);
      const c = input.candidates[0];
      return { filePath: input.primaryFile.path, line: c.line, col: c.col, kind: "direct", reasoning: "tier-1 pick" };
    };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), {
      apiKey: "k", enableAi: true, locate, escalation: { enabled: true },
    });
    expect(tiersSeen).toEqual([1]);
    expect(res.results[0].success).toBe(true);
  });

  it("escalates a tier-1 cannot_locate refusal; a tier-2 refusal is final and surfaced", async () => {
    const { filePath } = setup("tier-refuse.tsx", TWO_CARDS);
    const tiersSeen: number[] = [];
    let tier2Prior: LocateAttemptOptions["priorAttempt"];
    const locate: LocateFn = async (_input, opts) => {
      tiersSeen.push(opts.tier);
      if (opts.tier === 2) tier2Prior = opts.priorAttempt;
      return { cannotLocate: opts.tier === 1 ? "tier-1 gives up" : "genuinely server data" };
    };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), {
      apiKey: "k", enableAi: true, locate, escalation: { enabled: true },
    });
    expect(tiersSeen).toEqual([1, 2]);
    expect(tier2Prior?.failure).toMatch(/tier 1 refused: tier-1 gives up/);
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toMatch(/AI couldn't locate this element — genuinely server data/);
  });

  it("kill switch: escalation disabled means a single tier-1 attempt", async () => {
    const { filePath } = setup("tier-off.tsx", TWO_CARDS);
    const tiersSeen: number[] = [];
    const locate: LocateFn = async (_input, opts) => { tiersSeen.push(opts.tier); return null; };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), {
      apiKey: "k", enableAi: true, locate, escalation: { enabled: false },
    });
    expect(tiersSeen).toEqual([1]);
    expect(res.results[0].success).toBe(false);
  });

  it("a tier-1-only negative does not block tier 2 once escalation is on; a tier-2 negative caches", async () => {
    const { filePath } = setup("tier-cache.tsx", TWO_CARDS);
    const dir = path.dirname(filePath);
    let calls = 0;
    const locate: LocateFn = async () => { calls++; return null; };
    // Run 1: escalation off → negative cached at maxTierTried 1.
    await executeBatchWithAi([classOp(filePath)], dir, { apiKey: "k", enableAi: true, locate, escalation: { enabled: false } });
    expect(calls).toBe(1);
    // Run 2: escalation on → tier-1 negative must NOT satisfy the cache; both tiers run.
    await executeBatchWithAi([classOp(filePath)], dir, { apiKey: "k", enableAi: true, locate, escalation: { enabled: true } });
    expect(calls).toBe(3); // +tier1 +tier2
    // Run 3: the tier-2 negative is now cached (within TTL) → no new calls.
    await executeBatchWithAi([classOp(filePath)], dir, { apiKey: "k", enableAi: true, locate, escalation: { enabled: true } });
    expect(calls).toBe(3);
  });

  it("tier 2 receives tier 1's tool-call trace as priorAttempt", async () => {
    const { filePath } = setup("tier-trace.tsx", TWO_CARDS);
    let tier2Prior: LocateAttemptOptions["priorAttempt"];
    const locate: LocateFn = async (_input, opts) => {
      if (opts.tier === 1) {
        opts.trace?.push("grep /Total Parts/ → 3 hits");
        return null;
      }
      tier2Prior = opts.priorAttempt;
      return null;
    };
    await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), {
      apiKey: "k", enableAi: true, locate, escalation: { enabled: true },
    });
    expect(tier2Prior?.trace).toContain("grep /Total Parts/ → 3 hits");
    expect(tier2Prior?.failure).toMatch(/exhausted exploration/);
  });

  it("forceAi composes with escalation (tier-1 null → tier 2 resolves)", async () => {
    const { filePath } = setup("tier-force.tsx", TWO_CARDS);
    const tiersSeen: number[] = [];
    const locate: LocateFn = async (input, opts) => {
      tiersSeen.push(opts.tier);
      if (opts.tier === 1) return null;
      const lines = TWO_CARDS.split("\n");
      const line = lines.findIndex((l) => l.includes(">B<")) + 1;
      return { filePath: input.primaryFile.path, line, col: lines[line - 1].indexOf("<div"), kind: "direct", reasoning: "B card" };
    };
    const res = await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), {
      apiKey: "k", enableAi: true, forceAi: true, locate, escalation: { enabled: true },
    });
    expect(tiersSeen).toEqual([1, 2]);
    expect(res.results[0].success).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toMatch(/className="card bg-red-500">B/);
  });

  it("passes per-tier budgets and default models through to the locator", async () => {
    const { filePath } = setup("tier-budget.tsx", TWO_CARDS);
    const seen: Array<{ tier: number; maxSteps: number; maxTokens: number; model?: string }> = [];
    const locate: LocateFn = async (_input, opts) => {
      seen.push({ tier: opts.tier, maxSteps: opts.maxSteps, maxTokens: opts.maxTokens, model: opts.model });
      return null;
    };
    await executeBatchWithAi([classOp(filePath)], path.dirname(filePath), {
      apiKey: "k", enableAi: true, locate, escalation: { enabled: true, model: "custom-strong-model" },
    });
    expect(seen[0]).toEqual({ tier: 1, maxSteps: 8, maxTokens: 2048, model: "claude-haiku-4-5-20251001" });
    expect(seen[1]).toEqual({ tier: 2, maxSteps: 16, maxTokens: 4096, model: "custom-strong-model" });
  });

  it("find_component_definition resolves a component's defining file (read-only)", async () => {
    // Own temp dir: grepping the shared fixtures dir races with other test
    // files creating/deleting their temp fixtures (grep exits non-zero when a
    // file vanishes mid-walk).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-find-comp-"));
    cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
    fs.writeFileSync(path.join(dir, "zq-widget.tsx"), `export function ZqEscalationWidget() {\n  return <div/>;\n}\n`, "utf-8");
    const found = await findComponentDefinitionTool({ componentName: "ZqEscalationWidget" }, dir);
    expect(found).toContain("zq-widget.tsx");
    const missing = await findComponentDefinitionTool({ componentName: "NoSuchComponentZzz" }, dir);
    expect(missing).toBe("(not found)");
    expect(await findComponentDefinitionTool({}, dir)).toMatch(/ERROR/);
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
