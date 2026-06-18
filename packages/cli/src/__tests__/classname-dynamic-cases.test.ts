/**
 * Characterization tests for dynamic/conditional className shapes.
 *
 * These tests lock in the CURRENT behavior of `mutateClassName` / `updateClassName`
 * for each className shape. They do NOT assert what is "correct" — they assert
 * what the code actually does today. Cases marked GAP are shapes where a class
 * is silently handled without an error even though the class cannot be safely
 * mutated (e.g., it lives in an object expression or identifier arg that the
 * transform cannot statically resolve).
 *
 * See plan 009 for the investigation brief and findings report.
 */

import { describe, it, expect } from "vitest";
import { updateClassName } from "../transform.js";
import * as fs from "node:fs";
import * as path from "node:path";

const fixturesDir = path.join(__dirname, "fixtures");

function findElement(fixture: string, tag: string): { line: number; col: number } {
  const content = fs.readFileSync(path.join(fixturesDir, fixture), "utf-8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const col = lines[i].indexOf(`<${tag}`);
    if (col !== -1) return { line: i + 1, col };
  }
  throw new Error(`<${tag}> not found in ${fixture}`);
}

// ---------------------------------------------------------------------------
// Shape 1: cn() with logical-AND conditional  → cond && "gap-4"
// PREDICTION: checkConflictingConditional covers LogicalExpression.right →
//             throws CONFLICTING_CLASS (GUARDED).
// ---------------------------------------------------------------------------
describe("cn() with logical-AND conditional arg (cond && 'gap-4')", () => {
  it("throws CONFLICTING_CLASS when editing a prefix that is in the && branch", () => {
    const { line, col } = findElement("classname-cn-logical-and.tsx", "div");
    expect(() =>
      updateClassName(
        path.join(fixturesDir, "classname-cn-logical-and.tsx"),
        line,
        col,
        [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
      )
    ).toThrow(/CONFLICTING_CLASS/);
  });

  it("does NOT throw when editing a prefix that is NOT in the && branch (safe literal)", () => {
    const { line, col } = findElement("classname-cn-logical-and.tsx", "div");
    // "flex" is in the first StringLiteral arg — safe to edit.
    // We replace it with a token-bearing class to get a clean replacement.
    const result = updateClassName(
      path.join(fixturesDir, "classname-cn-logical-and.tsx"),
      line,
      col,
      [{ tailwindPrefix: "flex", tailwindToken: "1", value: "flex-1", relatedPrefixes: [] }]
    );
    // "flex" in the literal is replaced with "flex-1"
    expect(result).toContain("flex-1");
    // The && conditional arg is untouched (gap-4 still present)
    expect(result).toContain('isMobile && "gap-4"');
  });
});

// ---------------------------------------------------------------------------
// Shape 2: cn() with ternary conditional  → cond ? "gap-2" : "gap-4"
// PREDICTION: checkConflictingConditional covers ConditionalExpression both
//             branches → throws CONFLICTING_CLASS (GUARDED).
// ---------------------------------------------------------------------------
describe("cn() with ternary conditional arg (cond ? 'a' : 'b')", () => {
  it("throws CONFLICTING_CLASS when editing a prefix found in the consequent branch", () => {
    const { line, col } = findElement("classname-cn-ternary.tsx", "div");
    expect(() =>
      updateClassName(
        path.join(fixturesDir, "classname-cn-ternary.tsx"),
        line,
        col,
        [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
      )
    ).toThrow(/CONFLICTING_CLASS/);
  });

  it("throws CONFLICTING_CLASS when editing a prefix found in the alternate branch", () => {
    // Both "gap-2" and "gap-4" share the "gap" prefix — same call
    const { line, col } = findElement("classname-cn-ternary.tsx", "div");
    expect(() =>
      updateClassName(
        path.join(fixturesDir, "classname-cn-ternary.tsx"),
        line,
        col,
        [{ tailwindPrefix: "gap", tailwindToken: "8", value: "32px", relatedPrefixes: [] }]
      )
    ).toThrow(/CONFLICTING_CLASS/);
  });
});

// ---------------------------------------------------------------------------
// Shape 3: clsx() with object-expression arg  → { "gap-4": cond }
// GAP: ObjectExpression is not a LogicalExpression or ConditionalExpression,
//      so checkConflictingConditional returns false. The code then looks for a
//      StringLiteral arg to mutate. "flex" is found but doesn't match "gap",
//      so found=false and the new class is APPENDED TO "flex" silently — the
//      object entry is untouched and no error is raised.
// ---------------------------------------------------------------------------
describe("clsx() with object-expression arg ({ 'gap-4': cond }) — GAP", () => {
  it("does NOT throw even though gap lives in an object expression", () => {
    const { line, col } = findElement("classname-cn-object.tsx", "div");
    // Should throw CONFLICTING_CLASS or DYNAMIC_CLASSNAME, but currently does not.
    expect(() =>
      updateClassName(
        path.join(fixturesDir, "classname-cn-object.tsx"),
        line,
        col,
        [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
      )
    ).not.toThrow();
  });

  it("silently appends the new gap class to the first StringLiteral arg instead of erroring", () => {
    const { line, col } = findElement("classname-cn-object.tsx", "div");
    const result = updateClassName(
      path.join(fixturesDir, "classname-cn-object.tsx"),
      line,
      col,
      [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
    );
    // The new class is appended to the "flex" literal, NOT replacing the object entry
    expect(result).toContain("flex gap-6");
    // The object form { "gap-4": isMobile } is still present in the output
    expect(result).toContain('"gap-4": isMobile');
    // Both gap-4 (in object) and gap-6 (newly appended) now coexist — silent duplication
    expect(result).toContain("gap-4");
    expect(result).toContain("gap-6");
  });
});

// ---------------------------------------------------------------------------
// Shape 4: cn() with identifier arg  → cn(base, "flex")
// GAP: The identifier `base` is not a StringLiteral, so the prefix check skips
//      it. If the target prefix isn't in the literal "flex" arg either, the
//      code appends to the first StringLiteral it finds ("flex"), bypassing
//      `base` entirely. No error is raised.
// ---------------------------------------------------------------------------
describe("cn() with identifier arg (cn(base, 'flex')) — GAP", () => {
  it("does NOT throw when editing a prefix that might be in the identifier arg", () => {
    const { line, col } = findElement("classname-cn-identifier.tsx", "div");
    expect(() =>
      updateClassName(
        path.join(fixturesDir, "classname-cn-identifier.tsx"),
        line,
        col,
        [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
      )
    ).not.toThrow();
  });

  it("silently appends new class to the first StringLiteral arg rather than updating the identifier", () => {
    const { line, col } = findElement("classname-cn-identifier.tsx", "div");
    const result = updateClassName(
      path.join(fixturesDir, "classname-cn-identifier.tsx"),
      line,
      col,
      [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
    );
    // New class is appended to the "flex" string literal (the only StringLiteral arg)
    expect(result).toContain("flex gap-6");
    // The identifier `base` is still present and unchanged
    expect(result).toContain("base");
  });
});

// ---------------------------------------------------------------------------
// Shape 5: cn() with spread element arg  → cn("flex", ...extraClasses)
// GAP: SpreadElement is not handled by checkConflictingConditional and is not
//      a StringLiteral, so it is silently skipped. The new class is appended
//      to the first StringLiteral arg ("flex") if no literal matches the prefix.
// ---------------------------------------------------------------------------
describe("cn() with spread element arg (cn('flex', ...extraClasses)) — GAP", () => {
  it("does NOT throw when editing a prefix that might be in the spread", () => {
    const { line, col } = findElement("classname-cn-spread.tsx", "div");
    expect(() =>
      updateClassName(
        path.join(fixturesDir, "classname-cn-spread.tsx"),
        line,
        col,
        [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
      )
    ).not.toThrow();
  });

  it("silently appends new class to the first StringLiteral arg rather than erroring", () => {
    const { line, col } = findElement("classname-cn-spread.tsx", "div");
    const result = updateClassName(
      path.join(fixturesDir, "classname-cn-spread.tsx"),
      line,
      col,
      [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
    );
    // Appended to "flex" (first StringLiteral), the spread is not examined
    expect(result).toContain("flex gap-6");
    // The spread is still present
    expect(result).toContain("...extraClasses");
  });
});

// ---------------------------------------------------------------------------
// Shape 6: Template literal — editing a class in the STATIC quasi
// SAFE: The code scans each quasi, finds a match, and calls updateClassString.
//       The interpolation expressions are not mutated.
// ---------------------------------------------------------------------------
describe("template literal — editing a class in a static quasi", () => {
  it("replaces the class in the static part and preserves the interpolation", () => {
    const { line, col } = findElement("classname-template-interpolation.tsx", "span");
    const result = updateClassName(
      path.join(fixturesDir, "classname-template-interpolation.tsx"),
      line,
      col,
      [{ tailwindPrefix: "gap", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
    );
    // Static quasi is updated
    expect(result).toContain("gap-6");
    expect(result).not.toContain("gap-4");
    // The interpolation ${color} is preserved in the output source
    expect(result).toContain("${color}");
  });
});

// ---------------------------------------------------------------------------
// Shape 7: Template literal — editing a class present ONLY in an interpolation
// SAFE: No quasi matches, so the code appends to the LAST quasi (tail).
//       The interpolation itself is not mutated — the new class is a static
//       addition at the end of the template string.
// ---------------------------------------------------------------------------
describe("template literal — editing a class that only exists in an interpolation", () => {
  it("appends new class to last quasi and preserves the interpolation", () => {
    const { line, col } = findElement("classname-template-interpolation.tsx", "span");
    // "color" prefix won't match "flex" or "gap-4" in any quasi
    // We'll edit a prefix that does NOT appear in any static quasi
    const result = updateClassName(
      path.join(fixturesDir, "classname-template-interpolation.tsx"),
      line,
      col,
      [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "#ef4444", relatedPrefixes: [] }]
    );
    // New class is appended after the interpolation
    expect(result).toContain("bg-red-500");
    // The interpolation is preserved (not mutated)
    expect(result).toContain("${color}");
  });
});

// ---------------------------------------------------------------------------
// Shape 8: cn() with ONLY literal args — no conditional (baseline safe case)
// SAFE: The existing test suite covers this in update-classname.test.ts ("cn()/clsx() className").
//       Included here for completeness as the control case.
// ---------------------------------------------------------------------------
describe("cn() with only string literal args (baseline safe case)", () => {
  it("replaces the class in the correct literal arg without error", () => {
    const { line, col } = findElement("classname-cn.tsx", "button");
    const result = updateClassName(
      path.join(fixturesDir, "classname-cn.tsx"),
      line,
      col,
      [{ tailwindPrefix: "p", tailwindToken: "6", value: "24px", relatedPrefixes: [] }]
    );
    expect(result).toContain("p-6");
    expect(result).not.toContain("p-4");
  });
});

// ---------------------------------------------------------------------------
// Shape 9: cn() with existing ternary guard check (already in update-classname.test.ts)
// Verified again here to confirm the guard does cover this via checkConflictingConditional.
// The existing fixture classname-cn.tsx has `active && "bg-blue-500"` as a logical arg.
// ---------------------------------------------------------------------------
describe("cn() with logical-AND in existing fixture (coverage confirmation)", () => {
  it("throws CONFLICTING_CLASS for logical-AND in classname-cn.tsx fixture", () => {
    const { line, col } = findElement("classname-cn.tsx", "button");
    expect(() =>
      updateClassName(
        path.join(fixturesDir, "classname-cn.tsx"),
        line,
        col,
        [{ tailwindPrefix: "bg", tailwindToken: "red-500", value: "#ef4444", relatedPrefixes: [] }]
      )
    ).toThrow(/CONFLICTING_CLASS/);
  });
});
