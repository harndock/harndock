import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  BASE_BUNDLE,
  DESKTOP_BUNDLE,
  DESKTOP_CLIENT,
  prepareDesktopProfile,
  REMOTE_SYNC,
  RUNTIME_BRIDGE,
  WEB_BUNDLE,
} from './prepare-desktop-profile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessDir = join(root, 'vendor', 'deepseek-harness')
const harnessEntry = join(harnessDir, 'apps', 'cli', 'src', 'bin.ts')
const tsconfig = join(harnessDir, 'tsconfig.json')
const tsxLoaderUrl = pathToFileURL(join(harnessDir, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href
const extraBundle = '@harndock/test-extra-bundle'
const activeChildren = new Set()
const originalTsconfig = process.env.TSX_TSCONFIG_PATH

let testHome

function harnessEnv() {
  return {
    ...process.env,
    DSH_HOME: testHome,
    DSH_AGENTS_HOME: join(testHome, 'agents-home'),
    TSX_TSCONFIG_PATH: tsconfig,
  }
}

function runDsh(args) {
  const result = spawnSync(
    process.execPath,
    ['--import', tsxLoaderUrl, harnessEntry, ...args],
    {
      cwd: testHome,
      env: harnessEnv(),
      encoding: 'utf8',
    },
  )
  if (result.error !== undefined) throw result.error
  assert.equal(
    result.status,
    0,
    `dsh ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return result.stdout
}

async function readManifest() {
  const path = join(testHome, 'profiles', 'desktop', 'package.json')
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeManifest(manifest) {
  const path = join(testHome, 'profiles', 'desktop', 'package.json')
  await writeFile(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  child.kill('SIGTERM')
  const escalation = setTimeout(() => child.kill('SIGKILL'), 5_000)
  escalation.unref()
  await exited
  clearTimeout(escalation)
}

async function startHarness() {
  const child = spawn(
    process.execPath,
    [
      '--import',
      tsxLoaderUrl,
      harnessEntry,
      '--profile',
      'desktop',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ],
    {
      cwd: testHome,
      env: harnessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  activeChildren.add(child)
  child.once('exit', () => activeChildren.delete(child))

  let output = ''
  let settled = false
  const ready = new Promise((resolveReady, rejectReady) => {
    const inspect = chunk => {
      output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?[^\s]+)/)
      if (match !== null && !settled) {
        settled = true
        resolveReady(match[1])
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', error => {
      if (!settled) {
        settled = true
        rejectReady(error)
      }
    })
    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true
        rejectReady(new Error(`Harness exited before readiness (${String(code ?? signal)})\n${output}`))
      }
    })
  })
  const timeout = new Promise((_, rejectTimeout) => {
    const timer = setTimeout(() => rejectTimeout(new Error(`Harness readiness timed out\n${output}`)), 30_000)
    timer.unref()
  })

  try {
    const url = await Promise.race([ready, timeout])
    return { child, url }
  } catch (error) {
    await stopChild(child)
    throw error
  }
}

function bootManifestOf(html) {
  const match = html.match(/globalThis\["__DSH_BOOT__"\] = (.+?);?\s*<\/script>/)
  assert.notEqual(match, null, 'Harness HTML must contain a boot manifest')
  return JSON.parse(match[1])
}

async function probeWeb(expectedDesktopClient) {
  const runtime = await startHarness()
  try {
    const login = await fetch(runtime.url, { redirect: 'manual' })
    assert.ok(login.status === 302 || login.status === 303)
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(cookie)
    const response = await fetch(new URL('/', runtime.url), { headers: { cookie } })
    assert.equal(response.status, 200)
    const boot = bootManifestOf(await response.text())
    const client = boot.entries.find(entry => entry.id === DESKTOP_CLIENT)
    assert.equal(client !== undefined, expectedDesktopClient)
    if (client !== undefined) {
      const bundle = await fetch(new URL(client.url, runtime.url), { headers: { cookie } })
      assert.equal(bundle.status, 200, 'desktop Client bundle must be served')
      const source = await bundle.text()
      assert.match(source, /@harndock\/client-desktop/)
      assert.match(source, /Gateway & Remote Sync/)
      assert.match(source, /\/harndock\/desktop\/settings/)
    }
  } finally {
    await stopChild(runtime.child)
  }
}

async function createExtraBundle() {
  const directory = join(testHome, 'extra-bundle')
  await mkdir(directory)
  await writeFile(join(directory, 'cordis.patch.yml'), '- id: hmr\n  disabled: true\n')
  await writeFile(join(directory, 'package.json'), `${JSON.stringify({
    name: extraBundle,
    version: '0.0.0',
    private: true,
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2)}\n`)
  return directory
}

try {
  process.env.TSX_TSCONFIG_PATH = tsconfig
  testHome = await mkdtemp(join(tmpdir(), 'harndock-desktop-profile-'))
  await mkdir(join(testHome, 'agents-home'))

  const prepared = prepareDesktopProfile({
    dshHome: testHome,
    harnessEntry,
    tsxLoaderUrl,
    workspaceDir: testHome,
  })
  assert.deepEqual(
    prepared.manifest.dsh.profile.bundles,
    [BASE_BUNDLE, WEB_BUNDLE, DESKTOP_BUNDLE],
  )

  const dumped = runDsh(['--profile', 'desktop', '--dump-default-config'])
  assert.match(dumped, /id: harndock-client-desktop/)
  assert.match(dumped, /name: '@harndock\/client-desktop'/)
  assert.match(dumped, /id: harndock-remote-sync/)
  assert.match(dumped, /name: '@harndock\/remote-sync'/)
  await probeWeb(true)

  const withoutDesktop = await readManifest()
  withoutDesktop.dsh.profile.bundles = withoutDesktop.dsh.profile.bundles
    .filter(bundle => bundle !== DESKTOP_BUNDLE)
  await writeManifest(withoutDesktop)
  await probeWeb(false)

  const fixtureDir = await createExtraBundle()
  runDsh(['plugin', '--profile', 'desktop', 'add', '--force', `file:${fixtureDir}`])
  const restored = prepareDesktopProfile({
    dshHome: testHome,
    harnessEntry,
    tsxLoaderUrl,
    workspaceDir: testHome,
  })
  assert.deepEqual(
    restored.manifest.dsh.profile.bundles,
    [BASE_BUNDLE, WEB_BUNDLE, DESKTOP_BUNDLE, extraBundle],
  )

  runDsh(['plugin', '--profile', 'desktop', 'remove', DESKTOP_BUNDLE, DESKTOP_CLIENT, RUNTIME_BRIDGE, REMOTE_SYNC])
  const uninstalled = await readManifest()
  assert.deepEqual(uninstalled.dsh.profile.bundles, [BASE_BUNDLE, WEB_BUNDLE, extraBundle])
  assert.equal(uninstalled.dependencies?.[DESKTOP_BUNDLE], undefined)
  assert.equal(uninstalled.dependencies?.[DESKTOP_CLIENT], undefined)
  assert.equal(uninstalled.dependencies?.[RUNTIME_BRIDGE], undefined)
  assert.equal(uninstalled.dependencies?.[REMOTE_SYNC], undefined)
  await probeWeb(false)

  console.log('Desktop profile integration verified against the real Harness runtime')
} finally {
  await Promise.all([...activeChildren].map(stopChild))
  if (testHome !== undefined) await rm(testHome, { recursive: true, force: true })
  if (originalTsconfig === undefined) delete process.env.TSX_TSCONFIG_PATH
  else process.env.TSX_TSCONFIG_PATH = originalTsconfig
}
