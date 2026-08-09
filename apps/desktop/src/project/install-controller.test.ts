import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { createInstallController, type InstallState, type OwnedInstall } from "./install-controller.js";
import type { InstallPlan } from "./dependency-service.js";

const plan: InstallPlan = { projectId: "project-a", executable: "/usr/bin/npm", args: ["ci"], cwd: "/workspace", displayCommand: "npm ci", lockfileMode: "frozen", mutatesLockfile: false };

function fixture() {
  const states: InstallState[] = [];
  const child = new EventEmitter() as OwnedInstall["child"];
  let stopped = 0;
  const controller = createInstallController({
    start: () => ({ child, stop: async () => { stopped++; } }),
    verify: async () => true,
    onState: (state) => states.push(state),
    createId: (() => { let current = 0; return () => `operation-${++current}`; })(),
  });
  return { controller, child, states, stopped: () => stopped };
}

describe("InstallController", () => {
  it("requires a generated plan and explicit confirmation", () => {
    const { controller, states } = fixture();
    expect(controller.confirm("project-a", "unknown")).toMatchObject({ status: "error" });
    const pending = controller.plan(plan);
    expect(pending).toMatchObject({ status: "needs-confirmation", planId: "operation-1" });
    expect(controller.confirm("another-project", "operation-1")).toMatchObject({ status: "error" });
    expect(states).toHaveLength(3);
  });

  it("rechecks dependency readiness after a successful install", async () => {
    const { controller, child, states } = fixture();
    const pending = controller.plan(plan);
    const started = controller.confirm("project-a", "planId" in pending ? pending.planId : "");
    expect(started).toMatchObject({ status: "installing", operationId: "operation-2" });
    child.emit("exit", 0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(states.at(-1)).toMatchObject({ status: "ready", operationId: "operation-2" });
  });

  it("cancels the owned process and ignores its later exit", async () => {
    const { controller, child, states, stopped } = fixture();
    const pending = controller.plan(plan);
    controller.confirm("project-a", "planId" in pending ? pending.planId : "");
    await controller.cancel();
    child.emit("exit", 143);
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped()).toBe(1);
    expect(states.at(-1)).toMatchObject({ status: "cancelled" });
  });

  it("does not publish a late ready result after close cancels verification", async () => {
    const states: InstallState[] = [];
    const child = new EventEmitter() as OwnedInstall["child"];
    let release: ((value: boolean) => void) | null = null;
    const controller = createInstallController({
      start: () => ({ child, stop: async () => undefined }),
      verify: () => new Promise<boolean>((resolve) => { release = resolve; }),
      onState: (state) => states.push(state),
      createId: (() => { let current = 0; return () => `operation-${++current}`; })(),
    });
    const pending = controller.plan(plan);
    controller.confirm("project-a", "planId" in pending ? pending.planId : "");
    child.emit("exit", 0);
    await new Promise((resolve) => setImmediate(resolve));
    await controller.stopForProjectChange();
    release?.(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(states.at(-1)).toMatchObject({ status: "cancelled" });
  });
});
