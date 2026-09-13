import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./App.css";
import { runtimeCanInstallPlugin, runtimeShouldResumeAfterPluginInstall } from "./plugin-update-flow";
import { pluginVersionState, type PluginVersionState } from "./plugin-version";

type ThemeMode = "system" | "light" | "dark";

const themeStorageKey = "harndock-theme";

function readThemeMode(): ThemeMode {
  const value = window.localStorage.getItem(themeStorageKey);
  return value === "light" || value === "dark" ? value : "system";
}

type RuntimePhase =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "failed"
  | "crashed";

interface RuntimeFailure {
  kind: string;
  message: string;
}

interface RuntimeSnapshot {
  phase: RuntimePhase;
  profile: string;
  url: string | null;
  pid: number | null;
  error: RuntimeFailure | null;
  remoteSync: RemoteSyncRuntimeStatus;
}

type RemoteSyncConnectionState =
  | "stopped"
  | "connecting"
  | "handshaking"
  | "connected"
  | "reconnecting";

interface RemoteSyncRuntimeStatus {
  connectionState: RemoteSyncConnectionState;
  gatewayConnected: boolean;
  runtimeOnline: boolean;
  lastHeartbeatAtMs: number | null;
  observedAtMs: number | null;
}

interface RuntimeLogLine {
  sequence: number;
  stream: "stdout" | "stderr" | "shell";
  line: string;
}

interface PluginCatalogItem {
  pluginId: string;
  name: string;
  slug: string;
  author: string;
  category: string;
  summary: string;
  iconUrl: string | null;
  latestPublishedVersion: string | null;
  updatedAt: string;
}

interface PluginCatalogPage {
  items: PluginCatalogItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

interface PluginCatalogDetail extends PluginCatalogItem {
  description: string | null;
}

interface PluginReleaseDetail {
  pluginId: string;
  version: string;
  status: string;
  pluginTypes: string[];
  summary?: string;
  description?: string;
  permissions: Record<string, string[]>;
  harnessMinVersion: string;
  runtimeApi: number;
  platforms: string[];
  createdAt: string;
  publishedAt: string | null;
}

interface PluginMarketplaceDetail {
  plugin: PluginCatalogDetail;
  releases: PluginReleaseDetail[];
}

type PluginDownloadPhase = "fetchingDeclaration" | "downloading" | "ready" | "cancelling" | "cancelled" | "failed" | "installed";
type PluginInstallStage = "idle" | "stoppingRuntime" | "installing" | "startingRuntime" | "restoringRuntime";

interface PluginDownloadSnapshot {
  taskId: string;
  pluginId: string;
  version: string;
  phase: PluginDownloadPhase;
  downloadedBytes: number;
  totalBytes: number | null;
  artifactName: string | null;
  manifestName: string | null;
  artifactSha256: string | null;
  error: string | null;
  updatedAtMs: number;
}

interface PluginInstallResult {
  taskId: string;
  pluginId: string;
  version: string;
  health: "pending" | "healthy";
}

interface PluginInstallPreview {
  taskId: string;
  pluginId: string;
  version: string;
  sourceRepository: string;
  sourceReleaseTag: string;
  sourceCommitSha: string;
  artifactSha256: string;
  artifactSize: number;
  pluginTypes: string[];
  permissions: Record<string, string[]>;
  target: string;
  harnessMinVersion: string;
  runtimeApi: number;
  entryCount: number;
  unpackedBytes: number;
  containsSymlinks: boolean;
  signatureKeyId: string;
}

type PluginHealth = "pending" | "healthy";

interface InstalledPluginSnapshot {
  pluginId: string;
  version: string;
  previousVersion: string | null;
  health: PluginHealth;
  enabled: boolean;
}

interface RemoteSyncStatus {
  configured: boolean;
  accountId: string | null;
  deviceId: string | null;
  runtimeId: string | null;
  gatewayUrl: string | null;
}

interface PairingForm {
  gatewayUrl: string;
  code: string;
  deviceName: string;
  platform: "macos" | "windows" | "linux";
}

const initialRemoteSyncStatus: RemoteSyncStatus = {
  configured: false,
  accountId: null,
  deviceId: null,
  runtimeId: null,
  gatewayUrl: null,
};

function hostPlatform(): PairingForm["platform"] {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("linux")) return "linux";
  return "macos";
}

function initialView(): "startup" | "plugins" {
  return new URLSearchParams(window.location.search).get("view") === "plugins" ? "plugins" : "startup";
}

function pluginIdFromDeepLink(value: string): string | null {
  try {
    const url = new URL(value);
    const pluginId = url.pathname.slice(1);
    if (url.protocol !== "harndock:" || url.hostname !== "plugins" || url.username || url.password || url.port || url.search || url.hash) return null;
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(pluginId) ? pluginId : null;
  } catch {
    return null;
  }
}

function validPluginId(value: string | null): string | null {
  return value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : null;
}

function pluginIdFromDeepLinks(urls: string[]): string | null {
  return urls.map(pluginIdFromDeepLink).find((value): value is string => value !== null) ?? null;
}

function pairingGatewayUrl(websocketUrl: string): string {
  try {
    const value = new URL(websocketUrl);
    if (value.pathname !== "/v1/ws") return "";
    value.protocol = value.protocol === "wss:" ? "https:" : "http:";
    value.pathname = "/";
    return value.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const initialPairingForm: PairingForm = {
  gatewayUrl: "",
  code: "",
  deviceName: "My desktop",
  platform: hostPlatform(),
};

const initialSnapshot: RuntimeSnapshot = {
  phase: "stopped",
  profile: "desktop",
  url: null,
  pid: null,
  error: null,
  remoteSync: {
    connectionState: "stopped",
    gatewayConnected: false,
    runtimeOnline: false,
    lastHeartbeatAtMs: null,
    observedAtMs: null,
  },
};

const phaseCopy: Record<RuntimePhase, { eyebrow: string; title: string; detail: string }> = {
  stopped: {
    eyebrow: "Runtime stopped",
    title: "Preparing your workspace",
    detail: "Waiting to start the local Harndock runtime.",
  },
  starting: {
    eyebrow: "Runtime starting",
    title: "Preparing your workspace",
    detail: "Loading the Harness desktop profile and its plugin graph.",
  },
  ready: {
    eyebrow: "Runtime ready",
    title: "Opening Harndock",
    detail: "The local runtime is ready. Opening its web interface.",
  },
  stopping: {
    eyebrow: "Runtime stopping",
    title: "Closing the local runtime",
    detail: "Waiting for Harness to release its processes and port.",
  },
  failed: {
    eyebrow: "Startup failed",
    title: "Harness could not start",
    detail: "Review the runtime error and try starting it again.",
  },
  crashed: {
    eyebrow: "Runtime stopped unexpectedly",
    title: "Harness needs to restart",
    detail: "The desktop host recovered the window after the runtime exited.",
  },
};

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "The desktop runtime manager did not return a usable error.";
}

function localRuntimeStatus(phase: RuntimePhase): { label: string; tone: string } {
  if (phase === "ready") return { label: "Ready", tone: "online" };
  if (phase === "starting" || phase === "stopping") return { label: phase === "starting" ? "Starting" : "Stopping", tone: "pending" };
  if (phase === "failed" || phase === "crashed") return { label: "Unavailable", tone: "offline" };
  return { label: "Stopped", tone: "offline" };
}

function gatewayStatus(status: RemoteSyncRuntimeStatus): { label: string; tone: string } {
  if (status.connectionState === "connected") return { label: "Connected", tone: "online" };
  if (status.connectionState === "handshaking") return { label: "Secure handshake", tone: "pending" };
  if (status.connectionState === "reconnecting") return { label: "Reconnecting", tone: "pending" };
  if (status.connectionState === "connecting") return { label: "Connecting", tone: "pending" };
  return { label: "Disconnected", tone: "offline" };
}

function formatHeartbeat(value: number | null): string {
  if (value === null) return "Waiting for first heartbeat";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function App() {
  const [activeView, setActiveView] = useState<"startup" | "plugins">(initialView);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [logs, setLogs] = useState<RuntimeLogLine[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [remoteSync, setRemoteSync] = useState(initialRemoteSyncStatus);
  const [remoteSyncLoaded, setRemoteSyncLoaded] = useState(false);
  const [pairingForm, setPairingForm] = useState(initialPairingForm);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [unpairConfirming, setUnpairConfirming] = useState(false);
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const [pluginQuery, setPluginQuery] = useState("");
  const [pluginItems, setPluginItems] = useState<PluginCatalogItem[]>([]);
  const [pluginCatalogLoaded, setPluginCatalogLoaded] = useState(false);
  const [pluginCatalogBusy, setPluginCatalogBusy] = useState(false);
  const [pluginCatalogOffset, setPluginCatalogOffset] = useState(0);
  const [pluginCatalogLimit, setPluginCatalogLimit] = useState(24);
  const [pluginCatalogHasMore, setPluginCatalogHasMore] = useState(false);
  const pluginCatalogLoadingRef = useRef(false);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginTask, setPluginTask] = useState<PluginDownloadSnapshot | null>(null);
  const [pluginDownloadBusy, setPluginDownloadBusy] = useState(false);
  const [pluginInstallBusy, setPluginInstallBusy] = useState(false);
  const [pluginInstallStage, setPluginInstallStage] = useState<PluginInstallStage>("idle");
  const [pluginPreflightBusy, setPluginPreflightBusy] = useState(false);
  const [pluginInstallPreview, setPluginInstallPreview] = useState<PluginInstallPreview | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginSnapshot[]>([]);
  const [installedPluginsLoaded, setInstalledPluginsLoaded] = useState(false);
  const [installedPluginsBusy, setInstalledPluginsBusy] = useState(false);
  const installedPluginsLoadingRef = useRef(false);
  const [rollbackBusy, setRollbackBusy] = useState<string | null>(null);
  const [pluginLifecycleBusy, setPluginLifecycleBusy] = useState<string | null>(null);
  const [pluginDetail, setPluginDetail] = useState<PluginMarketplaceDetail | null>(null);
  const [pluginDetailBusy, setPluginDetailBusy] = useState(false);
  const [installCandidate, setInstallCandidate] = useState<PluginCatalogItem | null>(null);
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false);
  const [deepLinkPluginId, setDeepLinkPluginId] = useState<string | null>(() => validPluginId(new URLSearchParams(window.location.search).get("pluginId")));
  const copy = phaseCopy[snapshot.phase];
  const visibleLogs = useMemo(() => logs.slice(-12), [logs]);
  const installedPluginById = useMemo(
    () => new Map(installedPlugins.map((plugin) => [plugin.pluginId, plugin])),
    [installedPlugins],
  );
  const localStatus = localRuntimeStatus(snapshot.phase);
  const gatewayConnection = gatewayStatus(snapshot.remoteSync);

  useEffect(() => {
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined };
    const applyTheme = () => {
      const dark = themeMode === "dark" || (themeMode === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const openUrls = (urls: string[]) => {
      const pluginId = pluginIdFromDeepLinks(urls);
      if (!disposed && pluginId) {
        setActiveView("plugins");
        setDeepLinkPluginId(pluginId);
      }
    };
    async function listenForDeepLinks() {
      try {
        openUrls((await getCurrent()) ?? []);
        unlisten = await onOpenUrl(openUrls);
      } catch (error) {
        if (!disposed) setPluginError(errorText(error));
      }
    }
    void listenForDeepLinks();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function cycleTheme() {
    const next: ThemeMode = themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
    setThemeMode(next);
    window.localStorage.setItem(themeStorageKey, next);
  }

  useEffect(() => {
    let disposed = false;
    let unlistenState: UnlistenFn | undefined;
    let unlistenLog: UnlistenFn | undefined;
    let unlistenPluginHealth: UnlistenFn | undefined;

    async function initialize() {
      try {
        const currentDeepLinkPluginId = pluginIdFromDeepLinks((await getCurrent()) ?? []);
        const [stopState, stopLog, stopPluginHealth] = await Promise.all([
          listen<RuntimeSnapshot>("runtime://state", (event) => {
            if (!disposed) setSnapshot(event.payload);
          }),
          listen<RuntimeLogLine>("runtime://log", (event) => {
            if (!disposed) {
              setLogs((current) => [...current.slice(-199), event.payload]);
            }
          }),
          listen<InstalledPluginSnapshot[]>("plugin://health", (event) => {
            if (!disposed) {
              setInstalledPlugins(event.payload);
              setInstalledPluginsLoaded(true);
            }
          }),
        ]);
        if (disposed) {
          stopState();
          stopLog();
          stopPluginHealth();
          return;
        }
        unlistenState = stopState;
        unlistenLog = stopLog;
        unlistenPluginHealth = stopPluginHealth;

        const [current, existingLogs, remoteSyncStatus] = await Promise.all([
          invoke<RuntimeSnapshot>("runtime_status"),
          invoke<RuntimeLogLine[]>("runtime_logs"),
          invoke<RemoteSyncStatus>("remote_sync_status"),
        ]);
        if (disposed) return;
        setSnapshot(current);
        setLogs(existingLogs);
        setRemoteSync(remoteSyncStatus);
        setRemoteSyncLoaded(true);
        if (remoteSyncStatus.gatewayUrl !== null) {
          const gatewayUrl = pairingGatewayUrl(remoteSyncStatus.gatewayUrl);
          if (gatewayUrl !== "") setPairingForm((form) => ({ ...form, gatewayUrl }));
        }
        if (current.phase === "stopped" && remoteSyncStatus.configured && initialView() !== "plugins" && currentDeepLinkPluginId === null) {
          setSnapshot(await invoke<RuntimeSnapshot>("start_runtime"));
        }
      } catch (error) {
        if (!disposed) {
          setRemoteSyncLoaded(true);
          setCommandError(errorText(error));
        }
      }
    }

    void initialize();
    return () => {
      disposed = true;
      unlistenState?.();
      unlistenLog?.();
      unlistenPluginHealth?.();
    };
  }, []);

  async function retryRuntime() {
    setRetrying(true);
    setCommandError(null);
    try {
      setSnapshot(await invoke<RuntimeSnapshot>("start_runtime"));
    } catch (error) {
      setCommandError(errorText(error));
    } finally {
      setRetrying(false);
    }
  }

  async function returnToRuntime() {
    setCommandError(null);
    try {
      setSnapshot(await invoke<RuntimeSnapshot>("show_runtime"));
    } catch (error) {
      setCommandError(errorText(error));
    }
  }

  async function continueWithoutRemoteSync() {
    setRetrying(true);
    setCommandError(null);
    try {
      if (snapshot.phase === "ready") {
        setSnapshot(await invoke<RuntimeSnapshot>("show_runtime"));
      } else {
        setSnapshot(await invoke<RuntimeSnapshot>("start_runtime"));
      }
    } catch (error) {
      setCommandError(errorText(error));
    } finally {
      setRetrying(false);
    }
  }

  async function waitForRuntimeStopped() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      let current = await invoke<RuntimeSnapshot>("runtime_status");
      setSnapshot(current);
      if (current.phase === "stopped" || current.phase === "failed" || current.phase === "crashed") return current;
      if (current.phase === "starting" || current.phase === "ready") {
        current = await invoke<RuntimeSnapshot>("stop_runtime");
        setSnapshot(current);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error("The local runtime did not stop in time");
  }

  async function waitForRuntimeReady() {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const current = await invoke<RuntimeSnapshot>("runtime_status");
      setSnapshot(current);
      if (current.phase === "ready") return current;
      if (current.phase === "failed" || current.phase === "crashed" || current.phase === "stopped") {
        throw new Error(current.error?.message ?? "Runtime stopped before the plugin passed its health check");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    throw new Error("Runtime did not become ready after the plugin update");
  }

  async function pairRemoteSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPairingBusy(true);
    setPairingMessage(null);
    setCommandError(null);
    try {
      const status = await invoke<RemoteSyncStatus>("pair_remote_sync", { request: pairingForm });
      setRemoteSync(status);
      if (snapshot.phase !== "stopped") {
        await invoke<RuntimeSnapshot>("stop_runtime");
        await waitForRuntimeStopped();
      }
      setSnapshot(await invoke<RuntimeSnapshot>("start_runtime"));
      setPairingMessage("配对成功，远程同步已随 Runtime 重启启用。");
    } catch (error) {
      setPairingMessage(null);
      setCommandError(errorText(error));
    } finally {
      setPairingBusy(false);
    }
  }

  async function unpairRemoteSync() {
    setUnpairConfirming(false);
    setPairingBusy(true);
    setPairingMessage(null);
    setCommandError(null);
    try {
      if (snapshot.phase !== "stopped") {
        await invoke<RuntimeSnapshot>("stop_runtime");
        await waitForRuntimeStopped();
      }
      await invoke("unpair_remote_sync");
      setRemoteSync(initialRemoteSyncStatus);
      setPairingForm((form) => ({ ...form, gatewayUrl: "", code: "" }));
      setSnapshot(await invoke<RuntimeSnapshot>("runtime_status"));
      setPairingMessage("已移除本机配对身份和待发送队列；重新配对需要新的单次配对码。");
    } catch (error) {
      setCommandError(errorText(error));
    } finally {
      setPairingBusy(false);
    }
  }

  async function loadPluginCatalog(nextQuery = pluginQuery, nextOffset = 0) {
    if (pluginCatalogLoadingRef.current) return;
    pluginCatalogLoadingRef.current = true;
    setPluginCatalogBusy(true);
    setPluginError(null);
    try {
      const page = await invoke<PluginCatalogPage>("plugin_marketplace_list", {
        query: nextQuery.trim() || null,
        offset: nextOffset,
      });
      setPluginItems(page.items);
      setPluginCatalogOffset(page.offset);
      setPluginCatalogLimit(page.limit || 24);
      setPluginCatalogHasMore(page.hasMore);
      setPluginCatalogLoaded(true);
    } catch (error) {
      setPluginError(errorText(error));
    } finally {
      pluginCatalogLoadingRef.current = false;
      setPluginCatalogBusy(false);
    }
  }

  async function openPluginCenter() {
    setActiveView("plugins");
    void loadPluginCenterData();
  }

  function loadPluginCenterData() {
    void loadPluginCatalog();
    void loadInstalledPlugins();
  }

  async function leavePluginCenter() {
    setActiveView("startup");
    setCommandError(null);
    try {
      if (snapshot.phase === "ready") {
        setSnapshot(await invoke<RuntimeSnapshot>("show_runtime"));
      } else if (snapshot.phase === "stopped" && remoteSync.configured) {
        setRetrying(true);
        setSnapshot(await invoke<RuntimeSnapshot>("start_runtime"));
      }
    } catch (error) {
      setCommandError(errorText(error));
    } finally {
      setRetrying(false);
    }
  }

  async function loadInstalledPlugins() {
    if (installedPluginsLoadingRef.current) return;
    installedPluginsLoadingRef.current = true;
    setInstalledPluginsBusy(true);
    setPluginError(null);
    try {
      setInstalledPlugins(await invoke<InstalledPluginSnapshot[]>("plugin_installed_list"));
      setInstalledPluginsLoaded(true);
    } catch (error) {
      setPluginError(errorText(error));
    } finally {
      installedPluginsLoadingRef.current = false;
      setInstalledPluginsBusy(false);
    }
  }

  async function openPluginDetails(plugin: PluginCatalogItem) {
    await openPluginDetailsById(plugin.pluginId);
  }

  async function openPluginDetailsById(pluginId: string) {
    setPluginDetailBusy(true);
    setPluginError(null);
    try {
      setPluginDetail(await invoke<PluginMarketplaceDetail>("plugin_marketplace_detail", { pluginId }));
    } catch (error) {
      setPluginError(errorText(error));
    } finally {
      setPluginDetailBusy(false);
    }
  }

  useEffect(() => {
    if (activeView !== "plugins") return;
    loadPluginCenterData();
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "plugins" || !deepLinkPluginId) return;
    const pluginId = deepLinkPluginId;
    setDeepLinkPluginId(null);
    setPluginQuery(pluginId);
    void openPluginDetailsById(pluginId);
  }, [activeView, deepLinkPluginId]);

  async function downloadPlugin(plugin: PluginCatalogItem) {
    if (!plugin.latestPublishedVersion || pluginDownloadBusy) return;
    setPluginDownloadBusy(true);
    setInstallCandidate(plugin);
    setPluginInstallPreview(null);
    setInstallConfirmOpen(false);
    setPluginError(null);
    try {
      let current = await invoke<PluginDownloadSnapshot>("plugin_download_start", {
        pluginId: plugin.pluginId,
        version: plugin.latestPublishedVersion,
      });
      setPluginTask(current);
      while (current.phase !== "ready" && current.phase !== "failed" && current.phase !== "cancelled") {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        current = await invoke<PluginDownloadSnapshot>("plugin_download_status", { taskId: current.taskId });
        setPluginTask(current);
      }
      if (current.phase === "ready") {
        await preparePluginInstall(current.taskId);
      }
      if (current.phase === "failed") setPluginError(current.error ?? "插件下载失败");
    } catch (error) {
      setPluginError(errorText(error));
    } finally {
      setPluginDownloadBusy(false);
    }
  }

  function catalogVersionState(plugin: PluginCatalogItem): PluginVersionState {
    return pluginVersionState(plugin.latestPublishedVersion, installedPluginById.get(plugin.pluginId)?.version);
  }

  function catalogActionLabel(state: PluginVersionState): string {
    if (state === "not-installed") return "获取插件";
    if (state === "update-available") return "更新";
    if (state === "latest") return "已是最新";
    if (state === "local-newer") return "本地版本较新";
    return "暂无法检查";
  }

  async function cancelPluginDownload() {
    if (!pluginTask || !pluginDownloadBusy) return;
    try {
      setPluginTask(await invoke<PluginDownloadSnapshot>("plugin_download_cancel", { taskId: pluginTask.taskId }));
    } catch (error) {
      setPluginError(errorText(error));
    }
  }

  async function preparePluginInstall(taskId: string) {
    if (pluginPreflightBusy) return;
    setPluginPreflightBusy(true);
    setPluginError(null);
    try {
      const preview = await invoke<PluginInstallPreview>("plugin_install_preflight", { taskId });
      setPluginInstallPreview(preview);
      setInstallConfirmOpen(true);
    } catch (error) {
      setPluginInstallPreview(null);
      setPluginError(errorText(error));
    } finally {
      setPluginPreflightBusy(false);
    }
  }

  async function installPlugin() {
    if (!pluginTask || pluginTask.phase !== "ready" || pluginInstallBusy) return;
    setPluginInstallBusy(true);
    setPluginInstallStage("idle");
    setPluginError(null);
    const pluginId = pluginTask.pluginId;
    const targetVersion = pluginTask.version;
    let shouldRestartRuntime = false;
    let runtimeStoppedForInstall = false;
    try {
      const runtimeBeforeInstall = await invoke<RuntimeSnapshot>("runtime_status");
      setSnapshot(runtimeBeforeInstall);
      shouldRestartRuntime = runtimeShouldResumeAfterPluginInstall(runtimeBeforeInstall.phase);
      if (!runtimeCanInstallPlugin(runtimeBeforeInstall.phase)) {
        setPluginInstallStage("stoppingRuntime");
        setSnapshot(await invoke<RuntimeSnapshot>("stop_runtime"));
        await waitForRuntimeStopped();
        runtimeStoppedForInstall = true;
      }

      setPluginInstallStage("installing");
      await invoke<PluginInstallResult>("plugin_install", { taskId: pluginTask.taskId });
      setPluginTask((current) => current ? { ...current, phase: "installed", error: null } : current);
      setInstallConfirmOpen(false);
      await loadInstalledPlugins();

      if (shouldRestartRuntime) {
        setPluginInstallStage("startingRuntime");
        setSnapshot(await invoke<RuntimeSnapshot>("start_runtime"));
        await waitForRuntimeReady();
        await loadInstalledPlugins();
      }
    } catch (error) {
      const updateFailure = errorText(error);
      if (shouldRestartRuntime && runtimeStoppedForInstall) {
        try {
          setPluginInstallStage("restoringRuntime");
          const currentPlugins = await invoke<InstalledPluginSnapshot[]>("plugin_installed_list");
          const currentPlugin = currentPlugins.find((plugin) => plugin.pluginId === pluginId);
          if (currentPlugin?.version === targetVersion) {
            if (currentPlugin.previousVersion) {
              await invoke<InstalledPluginSnapshot>("plugin_rollback", { pluginId });
            } else {
              await invoke<InstalledPluginSnapshot[]>("plugin_uninstall", { pluginId });
            }
          }
          await loadInstalledPlugins();
          setSnapshot(await invoke<RuntimeSnapshot>("start_runtime"));
          await waitForRuntimeReady();
          await loadInstalledPlugins();
        } catch (recoveryError) {
          setPluginError(`插件更新失败：${updateFailure}。旧版本恢复启动失败：${errorText(recoveryError)}`);
          return;
        }
      }
      setPluginError(`插件更新失败：${updateFailure}`);
    } finally {
      setPluginInstallBusy(false);
      setPluginInstallStage("idle");
    }
  }

  function pluginInstallStageLabel(): string {
    if (pluginInstallStage === "stoppingRuntime") return "正在停止 Runtime...";
    if (pluginInstallStage === "installing") return "正在写入新版本...";
    if (pluginInstallStage === "startingRuntime") return "正在启动 Runtime 并检查插件...";
    if (pluginInstallStage === "restoringRuntime") return "正在恢复旧版本并重启 Runtime...";
    return installedPluginById.has(installCandidate?.pluginId ?? "") ? "确认更新" : "安装插件";
  }

  function pluginTaskStatusLabel(task: PluginDownloadSnapshot): string {
    if (pluginInstallStage === "stoppingRuntime") return "正在停止 Runtime，当前插件版本仍保持可用";
    if (pluginInstallStage === "installing") return "正在原子写入新版本";
    if (pluginInstallStage === "startingRuntime") return "新版本已安装，正在启动 Runtime 并等待健康检查";
    if (pluginInstallStage === "restoringRuntime") return "新版本未通过，正在恢复旧版本并重新启动 Runtime";
    if (task.phase === "fetchingDeclaration") return "正在读取 Center 安装声明";
    if (task.phase === "downloading") return `正在从 GitHub 下载 ${task.artifactName ?? "插件包"}`;
    if (task.phase === "ready") return "已下载并完成 SHA-256 校验，等待安装安全门禁";
    if (task.phase === "installed") return installedPluginById.get(task.pluginId)?.health === "healthy" ? "已安装并通过 Runtime 健康检查" : "已安装，等待 Runtime 健康检查";
    if (task.phase === "cancelled") return "下载已取消";
    if (task.phase === "failed") return "下载失败";
    return "正在取消下载";
  }

  function closePluginDetails() {
    setPluginDetail(null);
  }

  async function rollbackPlugin(plugin: InstalledPluginSnapshot) {
    if (!plugin.previousVersion || rollbackBusy || pluginLifecycleBusy || !canManageInstalledPlugins) return;
    setRollbackBusy(plugin.pluginId);
    setPluginError(null);
    try {
      const current = await invoke<InstalledPluginSnapshot>("plugin_rollback", { pluginId: plugin.pluginId });
      setInstalledPlugins((items) => items.map((item) => item.pluginId === current.pluginId ? current : item));
    } catch (error) {
      setPluginError(errorText(error));
    } finally {
      setRollbackBusy(null);
    }
  }

  const canManageInstalledPlugins = snapshot.phase === "stopped" || snapshot.phase === "failed" || snapshot.phase === "crashed";

  async function setPluginEnabled(plugin: InstalledPluginSnapshot) {
    if (plugin.health !== "healthy" || pluginLifecycleBusy || !canManageInstalledPlugins) return;
    setPluginLifecycleBusy(plugin.pluginId);
    setPluginError(null);
    try {
      const command = plugin.enabled ? "plugin_disable" : "plugin_enable";
      const current = await invoke<InstalledPluginSnapshot>(command, { pluginId: plugin.pluginId });
      setInstalledPlugins((items) => items.map((item) => item.pluginId === current.pluginId ? current : item));
      setPluginError("插件状态已更新，重启 Runtime 后生效。");
    } catch (error) {
      setPluginError(errorText(error));
    } finally {
      setPluginLifecycleBusy(null);
    }
  }

  async function uninstallPlugin(plugin: InstalledPluginSnapshot) {
    if (pluginLifecycleBusy || !canManageInstalledPlugins) return;
    if (!window.confirm(`确定卸载 ${plugin.pluginId} v${plugin.version} 吗？`)) return;
    setPluginLifecycleBusy(plugin.pluginId);
    setPluginError(null);
    try {
      await invoke<InstalledPluginSnapshot[]>("plugin_uninstall", { pluginId: plugin.pluginId });
      await loadInstalledPlugins();
      setPluginError("插件已卸载，重启 Runtime 后生效。");
    } catch (error) {
      setPluginError(errorText(error));
    } finally {
      setPluginLifecycleBusy(null);
    }
  }

  const failure = snapshot.error?.message ?? commandError;
  const showRecovery = snapshot.phase === "failed" || snapshot.phase === "crashed" || commandError !== null;
  const showOnboarding = remoteSyncLoaded && !remoteSync.configured && snapshot.phase === "stopped" && !showRecovery;

  return (
    <main className="bootstrap-shell" data-phase={snapshot.phase}>
      <header className="product-bar">
        <img className="product-mark" src={themeMode === "dark" ? "/branding/harndock-logo-dark-high-contrast.svg" : "/branding/harndock-logo-indigo-light.svg"} alt="" aria-hidden="true" />
        <div className="product-name">
          <strong>Harndock</strong>
          <span>Desktop</span>
        </div>
        <button className="theme-toggle" type="button" onClick={cycleTheme} aria-label={`Theme: ${themeMode}. Change theme`}>
          Theme: {themeMode}
        </button>
        <button className={`view-toggle ${activeView === "plugins" ? "active" : ""}`} type="button" onClick={() => void openPluginCenter()}>
          Plugin Center
        </button>
        <span className="build-label">Shell 0.1.0</span>
      </header>

      {activeView === "startup" ? <section className="startup-stage" aria-labelledby="startup-title">
        <div className="activity" aria-hidden="true">
          <span className="activity-ring" />
          <span className="activity-core" />
        </div>
        <p className="eyebrow">{showOnboarding ? "Gateway setup" : copy.eyebrow}</p>
        <h1 id="startup-title">{showOnboarding ? "Connect Gateway or continue locally" : copy.title}</h1>
        <p className="summary">{failure ?? (showOnboarding ? "Remote sync is optional. Pair this desktop now, or explicitly continue into Harness without a Gateway connection." : copy.detail)}</p>

        <div className="status-line" role="status" aria-live="polite">
          <span className="status-indicator" aria-hidden="true" />
          <div>
            <strong>Harness {snapshot.profile} profile</strong>
            <span>{snapshot.pid === null ? copy.detail : `Local process ${snapshot.pid}`}</span>
          </div>
        </div>

        {showRecovery && (
          <div className="recovery-actions">
            <button type="button" onClick={() => void retryRuntime()} disabled={retrying}>
              {retrying ? "Starting..." : "Retry runtime"}
            </button>
            {visibleLogs.length > 0 && (
              <details className="runtime-log">
                <summary>Recent runtime log</summary>
                <pre>{visibleLogs.map((entry) => `[${entry.stream}] ${entry.line}`).join("\n")}</pre>
              </details>
            )}
          </div>
        )}

        <section className="remote-sync-card" aria-labelledby="remote-sync-title">
          <div className="remote-sync-heading">
            <div>
              <p className="eyebrow">Remote sync</p>
              <h2 id="remote-sync-title">Gateway & Remote Sync</h2>
            </div>
            <span className={remoteSync.configured ? "sync-badge connected" : "sync-badge"}>
              {remoteSync.configured ? "Paired" : "Not paired"}
            </span>
          </div>
          {remoteSync.configured ? (
            <div className="remote-sync-connected">
              <p className="remote-sync-detail">
                Device {remoteSync.deviceId?.slice(0, 16)} · Runtime {remoteSync.runtimeId?.slice(0, 16)}
              </p>
              <dl className="remote-status-grid" aria-label="Remote sync connection status">
                <div>
                  <dt>Local Runtime</dt>
                  <dd className={`remote-status-value ${localStatus.tone}`}>
                    <span aria-hidden="true" />{localStatus.label}
                  </dd>
                </div>
                <div>
                  <dt>Gateway</dt>
                  <dd className={`remote-status-value ${gatewayConnection.tone}`}>
                    <span aria-hidden="true" />{gatewayConnection.label}
                  </dd>
                </div>
                <div>
                  <dt>Remote Runtime</dt>
                  <dd className={`remote-status-value ${snapshot.remoteSync.runtimeOnline ? "online" : "offline"}`}>
                    <span aria-hidden="true" />{snapshot.remoteSync.runtimeOnline ? "Online" : "Offline"}
                  </dd>
                </div>
                <div>
                  <dt>Latest heartbeat</dt>
                  <dd className="remote-heartbeat">{formatHeartbeat(snapshot.remoteSync.lastHeartbeatAtMs)}</dd>
                </div>
              </dl>
              <p className="remote-sync-detail">
                Unpair before connecting this desktop to another account or Gateway.
              </p>
              {unpairConfirming ? (
                <div className="unpair-confirmation" role="alert">
                  <p className="remote-sync-detail">
                    Remove the local identity and pending outbox? The remote Device remains registered until revoked from account settings.
                  </p>
                  <div className="unpair-actions">
                    <button
                      className="cancel-unpair-button"
                      type="button"
                      disabled={pairingBusy}
                      onClick={() => setUnpairConfirming(false)}
                    >
                      Cancel
                    </button>
                    <button className="unpair-button" type="button" disabled={pairingBusy} onClick={() => void unpairRemoteSync()}>
                      {pairingBusy ? "Unpairing..." : "Confirm unpair"}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="unpair-button" type="button" disabled={pairingBusy} onClick={() => setUnpairConfirming(true)}>
                  Unpair desktop
                </button>
              )}
            </div>
          ) : (
            <form className="pairing-form" onSubmit={(event) => void pairRemoteSync(event)}>
              <label>
                Gateway URL
                <input
                  type="url"
                  required
                  placeholder="https://sync.example.com"
                  value={pairingForm.gatewayUrl}
                  onChange={(event) => setPairingForm((form) => ({ ...form, gatewayUrl: event.target.value }))}
                />
              </label>
              <label>
                One-time pairing code
                <input
                  required
                  minLength={16}
                  maxLength={128}
                  autoComplete="off"
                  value={pairingForm.code}
                  onChange={(event) => setPairingForm((form) => ({ ...form, code: event.target.value }))}
                />
              </label>
              <div className="pairing-row">
                <label>
                  Device name
                  <input
                    required
                    maxLength={100}
                    value={pairingForm.deviceName}
                    onChange={(event) => setPairingForm((form) => ({ ...form, deviceName: event.target.value }))}
                  />
                </label>
                <label>
                  Platform
                  <select
                    value={pairingForm.platform}
                    onChange={(event) => setPairingForm((form) => ({ ...form, platform: event.target.value as PairingForm["platform"] }))}
                  >
                    <option value="macos">macOS</option>
                    <option value="windows">Windows</option>
                    <option value="linux">Linux</option>
                  </select>
                </label>
              </div>
              <button type="submit" disabled={pairingBusy}>
                {pairingBusy ? "Pairing..." : "Pair desktop"}
              </button>
            </form>
          )}
          {pairingMessage && <p className="remote-sync-success" role="status">{pairingMessage}</p>}
          {!remoteSync.configured && snapshot.phase === "stopped" && (
            <button className="continue-local-button" type="button" disabled={!remoteSyncLoaded || retrying || pairingBusy} onClick={() => void continueWithoutRemoteSync()}>
              {retrying ? "Starting Harness..." : "Skip for now and open Harness"}
            </button>
          )}
        </section>
        {snapshot.phase === "ready" && (
          <button className="return-runtime-button" type="button" onClick={() => void returnToRuntime()}>
            Return to Harness
          </button>
        )}
      </section> : <section className="plugin-center-stage" aria-labelledby="plugin-center-title">
        <div className="plugin-center-header">
          <div>
            <p className="eyebrow">Marketplace</p>
            <h1 id="plugin-center-title">Plugin Center</h1>
            <p className="summary">从已发布目录发现插件。安装包由 GitHub Release 提供，Desktop 会在本地完成完整性校验。</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void leavePluginCenter()}>返回启动页</button>
        </div>
        <form className="plugin-search" onSubmit={(event) => { event.preventDefault(); void loadPluginCatalog(); }}>
          <input aria-label="搜索插件" value={pluginQuery} onChange={(event) => setPluginQuery(event.target.value)} placeholder="搜索插件名称、作者或简介" />
          <button type="submit" disabled={pluginCatalogBusy}>{pluginCatalogBusy ? "搜索中..." : "搜索"}</button>
        </form>
        {pluginError && <p className="plugin-error" role="alert">{pluginError}</p>}
        {pluginTask && (
          <div className={`plugin-task ${pluginTask.phase}`} role="status" aria-live="polite">
            <div>
              <strong>{pluginTask.pluginId} · v{pluginTask.version}</strong>
              <span>{pluginTaskStatusLabel(pluginTask)}</span>
            </div>
            {pluginTask.phase === "downloading" && pluginTask.totalBytes ? <div className="plugin-progress"><span style={{ width: `${Math.min(100, (pluginTask.downloadedBytes / pluginTask.totalBytes) * 100)}%` }} /></div> : null}
            {(pluginTask.phase === "downloading" || pluginTask.phase === "fetchingDeclaration") && <button className="secondary-button" type="button" onClick={() => void cancelPluginDownload()}>取消</button>}
            {(pluginTask.phase === "failed" || pluginTask.phase === "cancelled") && installCandidate?.pluginId === pluginTask.pluginId && <button className="secondary-button" type="button" disabled={pluginDownloadBusy} onClick={() => void downloadPlugin(installCandidate)}>重试</button>}
            {pluginTask.phase === "ready" && installCandidate && pluginInstallPreview && <button className="secondary-button" type="button" onClick={() => setInstallConfirmOpen(true)}>查看安装条件</button>}
            {pluginTask.phase === "ready" && installCandidate && !pluginInstallPreview && <button className="secondary-button" type="button" disabled={pluginPreflightBusy} onClick={() => void preparePluginInstall(pluginTask.taskId)}>{pluginPreflightBusy ? "检查中..." : "重新安全检查"}</button>}
          </div>
        )}
        <section className="installed-plugins" aria-labelledby="installed-plugins-title">
          <div className="installed-heading">
            <div><p className="eyebrow">Local inventory</p><h2 id="installed-plugins-title">已安装插件</h2></div>
            <button className="secondary-button" type="button" disabled={installedPluginsBusy} onClick={() => void loadInstalledPlugins()}>{installedPluginsBusy ? "刷新中..." : "刷新"}</button>
          </div>
          {!installedPluginsLoaded && (installedPluginsBusy || !pluginError) ? <p className="installed-empty">正在读取本机插件...</p> : installedPlugins.length > 0 ? <div className="installed-list">{installedPlugins.map((plugin) => {
            const catalogPlugin = pluginItems.find((item) => item.pluginId === plugin.pluginId);
            const updateState = catalogPlugin ? catalogVersionState(catalogPlugin) : "unavailable";
            return (
              <article className="installed-row" key={plugin.pluginId}>
                <div><strong>{plugin.pluginId}</strong><span>当前版本 v{plugin.version}{catalogPlugin?.latestPublishedVersion ? ` · 目录 v${catalogPlugin.latestPublishedVersion}` : ""}</span></div>
                <div className="installed-row-actions">
                  <span className={`health-badge ${plugin.health}`}>{plugin.health === "healthy" ? "健康" : "待健康检查"}</span>
                  <span className={`enabled-badge ${plugin.enabled ? "on" : "off"}`}>{plugin.enabled ? "已启用" : "已禁用"}</span>
                  {plugin.health === "healthy" && <button className="secondary-button" type="button" disabled={pluginLifecycleBusy !== null || !canManageInstalledPlugins} onClick={() => void setPluginEnabled(plugin)}>{pluginLifecycleBusy === plugin.pluginId ? "处理中..." : plugin.enabled ? "禁用" : "启用"}</button>}
                  {plugin.previousVersion && <button className="secondary-button" type="button" disabled={rollbackBusy !== null || pluginLifecycleBusy !== null || !canManageInstalledPlugins} onClick={() => void rollbackPlugin(plugin)}>{rollbackBusy === plugin.pluginId ? "回滚中..." : `回滚到 v${plugin.previousVersion}`}</button>}
                  {updateState === "update-available" && catalogPlugin && <button type="button" disabled={pluginDownloadBusy} onClick={() => void downloadPlugin(catalogPlugin)}>{pluginDownloadBusy && pluginTask?.pluginId === plugin.pluginId ? "下载中..." : "更新"}</button>}
                  <button className="secondary-button danger-button" type="button" disabled={pluginLifecycleBusy !== null || !canManageInstalledPlugins} onClick={() => void uninstallPlugin(plugin)}>卸载</button>
                </div>
              </article>
            );
          })}</div> : installedPluginsLoaded ? <p className="installed-empty">尚未安装插件。下载并通过安全门禁后，插件会出现在这里。</p> : <p className="installed-empty">无法读取本机插件，请点击刷新重试。</p>}
        </section>
        <div className="plugin-grid">
          {pluginItems.map((plugin) => {
            const versionState = catalogVersionState(plugin);
            const actionDisabled = !plugin.latestPublishedVersion || pluginDownloadBusy || versionState === "latest" || versionState === "local-newer" || versionState === "unavailable";
            return (
              <article className="plugin-card" key={plugin.pluginId}>
                <div className="plugin-card-icon">{plugin.name.slice(0, 1).toUpperCase()}</div>
                <div className="plugin-card-body">
                  <div className="plugin-card-heading"><div><h2>{plugin.name}</h2><span>{plugin.pluginId}</span></div><em>{plugin.category}</em></div>
                  <p>{plugin.summary}</p>
                  <div className="plugin-card-meta"><span>{plugin.author}</span><span>{plugin.latestPublishedVersion ? `v${plugin.latestPublishedVersion}` : "暂无版本"}</span>{versionState === "update-available" && <strong>有新版本</strong>}{versionState === "latest" && <strong>已是最新</strong>}{versionState === "local-newer" && <strong>本地版本较新</strong>}</div>
                  <div className="plugin-card-actions">
                    <button className="secondary-button" type="button" onClick={() => void openPluginDetails(plugin)} disabled={pluginDetailBusy}>查看详情</button>
                    <button type="button" disabled={actionDisabled} onClick={() => void downloadPlugin(plugin)}>{pluginDownloadBusy && pluginTask?.pluginId === plugin.pluginId ? "下载中..." : catalogActionLabel(versionState)}</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {pluginCatalogLoaded && (pluginCatalogOffset > 0 || pluginCatalogHasMore) && <nav className="plugin-pagination" aria-label="插件目录分页">
          <button className="secondary-button" type="button" disabled={pluginCatalogBusy || pluginCatalogOffset === 0} onClick={() => void loadPluginCatalog(pluginQuery, Math.max(0, pluginCatalogOffset - pluginCatalogLimit))}>上一页</button>
          <span>第 {Math.floor(pluginCatalogOffset / Math.max(1, pluginCatalogLimit)) + 1} 页</span>
          <button className="secondary-button" type="button" disabled={pluginCatalogBusy || !pluginCatalogHasMore} onClick={() => void loadPluginCatalog(pluginQuery, pluginCatalogOffset + pluginCatalogLimit)}>下一页</button>
        </nav>}
        {!pluginCatalogBusy && pluginCatalogLoaded && pluginItems.length === 0 && <div className="plugin-empty">没有找到已发布插件</div>}
        {!pluginCatalogLoaded && (pluginCatalogBusy || !pluginError) && <div className="plugin-empty">正在加载插件目录...</div>}
        {!pluginCatalogLoaded && !pluginCatalogBusy && pluginError && <div className="plugin-empty">插件目录加载失败，请点击搜索重试</div>}

        {pluginDetail && (
          <div className="plugin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePluginDetails(); }}>
            <section className="plugin-modal" role="dialog" aria-modal="true" aria-labelledby="plugin-detail-title">
              <div className="plugin-modal-header">
                <div>
                  <p className="eyebrow">Plugin details</p>
                  <h2 id="plugin-detail-title">{pluginDetail.plugin.name}</h2>
                  <span className="plugin-detail-id">{pluginDetail.plugin.pluginId} · {pluginDetail.plugin.author}</span>
                </div>
                <button className="secondary-button" type="button" onClick={closePluginDetails}>关闭</button>
              </div>
              <p className="plugin-detail-description">{pluginDetail.plugin.description || pluginDetail.plugin.summary}</p>
              {pluginDetail.releases.map((release) => (
                <article className="plugin-release" key={release.version}>
                  <div className="plugin-release-heading">
                    <div><strong>v{release.version}</strong><span>{release.pluginTypes.join(" · ")}</span></div>
                    <span>{release.platforms.join(", ")}</span>
                  </div>
                  <p>{release.description || release.summary}</p>
                  <dl className="plugin-detail-grid">
                    <div><dt>Harness</dt><dd>≥ {release.harnessMinVersion}</dd></div>
                    <div><dt>Runtime API</dt><dd>v{release.runtimeApi}</dd></div>
                    <div><dt>状态</dt><dd>{release.status === "published" ? "已发布" : release.status}</dd></div>
                  </dl>
                  <div className="permission-section">
                    <strong>申请权限</strong>
                    {Object.entries(release.permissions).length > 0 ? <ul className="permission-list">{Object.entries(release.permissions).map(([scope, values]) => <li key={scope}><span>{scope}</span><small>{values.join("、")}</small></li>)}</ul> : <p>此版本未声明额外权限</p>}
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}

        {installConfirmOpen && installCandidate && pluginTask?.phase === "ready" && pluginInstallPreview && (
          <div className="plugin-modal-backdrop" role="presentation">
            <section className="plugin-modal install-modal" role="dialog" aria-modal="true" aria-labelledby="install-confirm-title">
              <div className="plugin-modal-header">
                <div>
                  <p className="eyebrow">安全安装检查</p>
                  <h2 id="install-confirm-title">{installedPluginById.has(installCandidate.pluginId) ? "准备更新" : "准备安装"} {installCandidate.name}</h2>
                </div>
                <button className="secondary-button" type="button" disabled={pluginInstallBusy} onClick={() => setInstallConfirmOpen(false)}>稍后处理</button>
              </div>
              <p className="plugin-detail-description">插件包已从 GitHub 下载并完成 SHA-256 校验。安装器会在写入本地插件目录前再次验证 Manifest、签名、权限和 Runtime 兼容性。</p>
              {pluginError && <p className="plugin-error" role="alert">{pluginError}</p>}
              <dl className="plugin-detail-grid install-version-summary">
                <div><dt>当前版本</dt><dd>{installedPluginById.get(installCandidate.pluginId)?.version ? `v${installedPluginById.get(installCandidate.pluginId)?.version}` : "未安装"}</dd></div>
                <div><dt>目标版本</dt><dd>v{pluginInstallPreview.version}</dd></div>
                <div><dt>来源</dt><dd>{pluginInstallPreview.sourceRepository} · {pluginInstallPreview.sourceReleaseTag}</dd></div>
                <div><dt>Commit</dt><dd>{pluginInstallPreview.sourceCommitSha.slice(0, 12)}…</dd></div>
              </dl>
              <div className="permission-section install-permissions">
                <strong>本次申请权限</strong>
                {Object.entries(pluginInstallPreview.permissions).length > 0 ? <ul className="permission-list">{Object.entries(pluginInstallPreview.permissions).map(([scope, values]) => <li key={scope}><span>{scope}</span><small>{values.join("、")}</small></li>)}</ul> : <p>已验证的 Manifest 未声明额外权限。</p>}
              </div>
              <dl className="plugin-detail-grid install-preview-meta">
                <div><dt>目标平台</dt><dd>{pluginInstallPreview.target}</dd></div>
                <div><dt>插件类型</dt><dd>{pluginInstallPreview.pluginTypes.join(" · ")}</dd></div>
                <div><dt>签名密钥</dt><dd>{pluginInstallPreview.signatureKeyId}</dd></div>
                <div><dt>包大小</dt><dd>{formatBytes(pluginInstallPreview.artifactSize)}</dd></div>
                <div><dt>SHA-256</dt><dd className="install-hash">{pluginInstallPreview.artifactSha256}</dd></div>
              </dl>
              <ol className="install-gate-list">
                <li className="complete"><span>✓</span><div><strong>Center 安装声明</strong><small>已读取插件版本、来源和完整性信息</small></div></li>
                <li className="complete"><span>✓</span><div><strong>归档完整性</strong><small>SHA-256 与声明一致</small></div></li>
                <li className="complete"><span>✓</span><div><strong>签名与 Manifest</strong><small>Ed25519 验签通过，权限来自已验证 Manifest</small></div></li>
                <li className="complete"><span>✓</span><div><strong>归档与兼容性预检</strong><small>{pluginInstallPreview.entryCount} 个条目，Runtime API v{pluginInstallPreview.runtimeApi}，Harness ≥ {pluginInstallPreview.harnessMinVersion}</small></div></li>
                <li className="pending"><span>5</span><div><strong>原子安装</strong><small>确认后写入版本目录并更新 active 指针</small></div></li>
                {snapshot.phase === "ready" || snapshot.phase === "starting" ? <li className="pending"><span>6</span><div><strong>Runtime 重启和健康检查</strong><small>更新前停止 Runtime，完成后自动重启；启动失败将恢复旧版本</small></div></li> : null}
              </ol>
              <div className="install-modal-actions">
                <button className="secondary-button" type="button" disabled={pluginInstallBusy} onClick={() => setInstallConfirmOpen(false)}>关闭</button>
                <button type="button" disabled={pluginInstallBusy} onClick={() => void installPlugin()}>{pluginInstallStageLabel()}</button>
              </div>
            </section>
          </div>
        )}
      </section>}

      <footer className="bootstrap-footer">
        <span>Local runtime</span>
        <span className="footer-separator" aria-hidden="true" />
        <span>Plugin-ready profile</span>
      </footer>
    </main>
  );
}

export default App;
