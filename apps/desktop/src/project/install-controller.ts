import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { InstallPlan } from "./dependency-service.js";

export type InstallState =
  | { status: "idle" }
  | { status: "needs-confirmation"; planId: string; plan: InstallPlan }
  | { status: "installing"; operationId: string; plan: InstallPlan }
  | { status: "ready"; operationId: string; plan: InstallPlan }
  | { status: "cancelled"; operationId: string; plan: InstallPlan }
  | { status: "error"; operationId?: string; plan?: InstallPlan; message: string; exitCode?: number | null };

export interface OwnedInstall {
  child: Pick<ChildProcessWithoutNullStreams, "on" | "once">;
  stop(): Promise<void>;
}

export interface InstallControllerDependencies {
  start(plan: InstallPlan, operationId: string): OwnedInstall;
  verify(projectId: string): Promise<boolean>;
  onState(state: InstallState): void;
  createId(): string;
}

export class InstallController {
  private pending = new Map<string, InstallPlan>();
  private running: { operationId: string; plan: InstallPlan; process: OwnedInstall; cancelled: boolean } | null = null;

  constructor(private readonly dependencies: InstallControllerDependencies) {}

  plan(plan: InstallPlan): InstallState {
    this.pending.clear();
    const planId = this.dependencies.createId();
    this.pending.set(planId, plan);
    const state: InstallState = { status: "needs-confirmation", planId, plan };
    this.dependencies.onState(state);
    return state;
  }

  confirm(projectId: string, planId: unknown): InstallState {
    if (typeof planId !== "string") return this.error("Choose an install plan first.");
    if (this.running) return this.error("ThemeLab is already installing dependencies for this project.");
    const plan = this.pending.get(planId);
    if (!plan || plan.projectId !== projectId) return this.error("That install plan is no longer valid for the active project.");
    this.pending.delete(planId);
    const operationId = this.dependencies.createId();
    let process: OwnedInstall;
    try { process = this.dependencies.start(plan, operationId); } catch (error) { return this.error(error instanceof Error ? error.message : "Could not start dependency installation.", plan); }
    const running = { operationId, plan, process, cancelled: false };
    this.running = running;
    const state: InstallState = { status: "installing", operationId, plan };
    this.dependencies.onState(state);
    process.child.once("error", (error) => this.finish(running, { error: error instanceof Error ? error.message : "Dependency installation failed." }));
    process.child.once("exit", (code) => this.finish(running, { code }));
    return state;
  }

  async cancel(): Promise<InstallState> {
    const running = this.running;
    if (!running) return this.error("No dependency install is running.");
    running.cancelled = true;
    await running.process.stop();
    if (this.running === running) {
      this.running = null;
      const state: InstallState = { status: "cancelled", operationId: running.operationId, plan: running.plan };
      this.dependencies.onState(state);
      return state;
    }
    return { status: "cancelled", operationId: running.operationId, plan: running.plan };
  }

  async stopForProjectChange(): Promise<void> {
    this.pending.clear();
    if (this.running) await this.cancel();
  }

  private async finish(running: NonNullable<InstallController["running"]>, result: { code?: number | null; error?: string }): Promise<void> {
    if (this.running !== running) return;
    if (running.cancelled) return;
    if (result.error || result.code !== 0) {
      this.running = null;
      this.dependencies.onState({ status: "error", operationId: running.operationId, plan: running.plan, message: result.error ?? `Install exited with code ${result.code ?? "unknown"}.`, exitCode: result.code });
      return;
    }
    const ready = await this.dependencies.verify(running.plan.projectId);
    if (this.running !== running || running.cancelled) return;
    this.running = null;
    this.dependencies.onState(ready
      ? { status: "ready", operationId: running.operationId, plan: running.plan }
      : { status: "error", operationId: running.operationId, plan: running.plan, message: "Install finished, but ThemeLab could not resolve the app dependencies yet.", exitCode: result.code });
  }

  private error(message: string, plan?: InstallPlan): InstallState {
    const state: InstallState = { status: "error", message, ...(plan ? { plan } : {}) };
    this.dependencies.onState(state);
    return state;
  }
}

export function createInstallController(dependencies: Omit<InstallControllerDependencies, "createId"> & { createId?: () => string }): InstallController {
  return new InstallController({ ...dependencies, createId: dependencies.createId ?? randomUUID });
}
