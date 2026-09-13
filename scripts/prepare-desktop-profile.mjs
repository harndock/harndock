import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DESKTOP_PROFILE = 'desktop'
export const BASE_BUNDLE = '@deepseek-ai/dsh-base'
export const WEB_BUNDLE = '@deepseek-ai/dsh-web-app'
export const DESKTOP_BUNDLE = '@harndock/desktop-bundle'
export const DESKTOP_CLIENT = '@harndock/client-desktop'
export const RUNTIME_BRIDGE = '@harndock/runtime-bridge'
export const REMOTE_SYNC = '@harndock/remote-sync'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultBundleDir = join(root, 'packages', 'desktop-bundle')
const defaultClientDir = join(root, 'packages', 'client-desktop')
const defaultBridgeDir = join(root, 'packages', 'runtime-bridge')
const defaultRemoteSyncDir = join(root, 'packages', 'remote-sync')
const packageFiles = new Map([
  [DESKTOP_BUNDLE, ['package.json', 'cordis.patch.yml']],
  [DESKTOP_CLIENT, ['package.json', 'lib/index.js', 'lib/client.js']],
  [RUNTIME_BRIDGE, ['package.json', 'lib/index.js']],
  [REMOTE_SYNC, ['package.json', 'lib/index.js']],
])

function fingerprint(directory, files) {
  const hash = createHash('sha256')
  for (const file of files) {
    const path = join(directory, file)
    if (!existsSync(path)) return undefined
    hash.update(file)
    hash.update(readFileSync(path))
  }
  return hash.digest('hex')
}

function packageIsCurrent(profileDir, packageName, sourceDir) {
  const files = packageFiles.get(packageName)
  if (files === undefined) throw new Error(`unknown desktop package ${packageName}`)
  const installedDir = join(profileDir, 'node_modules', ...packageName.split('/'))
  return fingerprint(sourceDir, files) !== undefined
    && fingerprint(sourceDir, files) === fingerprint(installedDir, files)
}

function requireSourceArtifacts(bundleDir, clientDir, bridgeDir, remoteSyncDir) {
  for (const [packageName, directory] of [
    [DESKTOP_BUNDLE, bundleDir],
    [DESKTOP_CLIENT, clientDir],
    [RUNTIME_BRIDGE, bridgeDir],
    [REMOTE_SYNC, remoteSyncDir],
  ]) {
    const files = packageFiles.get(packageName)
    if (files === undefined || fingerprint(directory, files) === undefined) {
      throw new Error(`${packageName} is not built; run pnpm build:plugins before starting harndock`)
    }
  }
}

function installDesktopPackages(options, profileDir, bundleDir, clientDir, bridgeDir, remoteSyncDir) {
  const result = spawnSync(
    options.nodeExecutable,
    [
      '--import',
      options.tsxLoaderUrl,
      options.harnessEntry,
      'plugin',
      '--profile',
      DESKTOP_PROFILE,
      'add',
      '--force',
      `file:${bundleDir}`,
      `file:${clientDir}`,
      `file:${bridgeDir}`,
      `file:${remoteSyncDir}`,
    ],
    {
      cwd: options.workspaceDir,
      env: { ...process.env, DSH_HOME: options.dshHome },
      stdio: 'inherit',
    },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`dsh plugin failed while preparing the desktop profile (exit ${String(result.status)})`)
  }
  if (!existsSync(join(profileDir, 'package.json'))) {
    throw new Error('dsh plugin completed without creating the desktop profile manifest')
  }
}

function orderProductLayers(profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const existing = manifest.dsh?.profile?.bundles
  if (!Array.isArray(existing) || existing.some(bundle => typeof bundle !== 'string')) {
    throw new Error('desktop profile manifest has an invalid dsh.profile.bundles list')
  }
  const product = new Set([BASE_BUNDLE, WEB_BUNDLE, DESKTOP_BUNDLE])
  const thirdParty = existing.filter(bundle => !product.has(bundle))
  const bundles = [BASE_BUNDLE, WEB_BUNDLE, DESKTOP_BUNDLE, ...thirdParty]
  if (JSON.stringify(existing) === JSON.stringify(bundles)) return manifest
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  return manifest
}

export function prepareDesktopProfile(overrides = {}) {
  const options = {
    dshHome: overrides.dshHome ?? process.env.DSH_HOME,
    harnessEntry: overrides.harnessEntry ?? process.env.HARNDOCK_HARNESS_ENTRY,
    tsxLoaderUrl: overrides.tsxLoaderUrl ?? process.env.HARNDOCK_TSX_LOADER_URL,
    nodeExecutable: overrides.nodeExecutable ?? process.execPath,
    workspaceDir: overrides.workspaceDir ?? process.cwd(),
    bundleDir: overrides.bundleDir ?? defaultBundleDir,
    clientDir: overrides.clientDir ?? defaultClientDir,
    bridgeDir: overrides.bridgeDir ?? defaultBridgeDir,
    remoteSyncDir: overrides.remoteSyncDir ?? defaultRemoteSyncDir,
  }
  for (const key of ['dshHome', 'harnessEntry', 'tsxLoaderUrl']) {
    if (options[key] === undefined || options[key] === '') throw new Error(`${key} is required to prepare the desktop profile`)
  }
  const bundleDir = resolve(options.bundleDir)
  const clientDir = resolve(options.clientDir)
  const bridgeDir = resolve(options.bridgeDir)
  const remoteSyncDir = resolve(options.remoteSyncDir)
  const profileDir = join(options.dshHome, 'profiles', DESKTOP_PROFILE)
  requireSourceArtifacts(bundleDir, clientDir, bridgeDir, remoteSyncDir)

  if (!packageIsCurrent(profileDir, DESKTOP_BUNDLE, bundleDir)
    || !packageIsCurrent(profileDir, DESKTOP_CLIENT, clientDir)
    || !packageIsCurrent(profileDir, RUNTIME_BRIDGE, bridgeDir)
    || !packageIsCurrent(profileDir, REMOTE_SYNC, remoteSyncDir)) {
    installDesktopPackages(options, profileDir, bundleDir, clientDir, bridgeDir, remoteSyncDir)
  }
  const manifest = orderProductLayers(profileDir)
  return { profileDir, manifest }
}
