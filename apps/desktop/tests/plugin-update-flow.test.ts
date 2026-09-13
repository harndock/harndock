import assert from "node:assert/strict";
import test from "node:test";
import {
  runtimeCanInstallPlugin,
  runtimeShouldResumeAfterPluginInstall,
  type ManagedRuntimePhase,
} from "../src/plugin-update-flow.ts";

const phases: ManagedRuntimePhase[] = ["stopped", "starting", "ready", "stopping", "failed", "crashed"];

test("only terminal idle phases allow plugin installation", () => {
  const allowed = phases.filter(runtimeCanInstallPlugin);
  assert.deepEqual(allowed, ["stopped", "failed", "crashed"]);
});

test("only an active or starting Runtime resumes after installation", () => {
  const resumable = phases.filter(runtimeShouldResumeAfterPluginInstall);
  assert.deepEqual(resumable, ["starting", "ready"]);
});
