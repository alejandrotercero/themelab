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
