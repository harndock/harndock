export type ManagedRuntimePhase =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "failed"
  | "crashed";

export function runtimeCanInstallPlugin(phase: ManagedRuntimePhase): boolean {
  return phase === "stopped" || phase === "failed" || phase === "crashed";
}

export function runtimeShouldResumeAfterPluginInstall(phase: ManagedRuntimePhase): boolean {
  return phase === "ready" || phase === "starting";
}
