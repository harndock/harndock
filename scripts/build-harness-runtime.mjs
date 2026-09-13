import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  lutimes,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessDir = join(root, 'vendor', 'deepseek-harness')
const runtimeDir = join(root, 'runtime')
const manifestTemplate = await readJson(join(runtimeDir, 'manifest.example.json'))
const harnessLock = await readJson(join(runtimeDir, 'harness.lock.json'))
const sourcesLock = await readJson(join(runtimeDir, 'sources.lock.json'))

const { values } = parseArgs({
  options: {
    output: { type: 'string', default: join(root, 'dist', 'runtime') },
    'runtime-version': { type: 'string', default: manifestTemplate.runtimeVersion },
    'keep-staging': { type: 'boolean', default: false },
  },
})
const runtimeVersion = values['runtime-version']
if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]*$/.test(runtimeVersion)) {
  throw new Error(`invalid Runtime version: ${runtimeVersion}`)
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('the v1 Runtime builder currently requires a darwin-arm64 host')
}

const target = sourcesLock.target
const archiveName = `harndock-runtime-${runtimeVersion}-${target}.tar.zst`
const outputDir = resolve(values.output)
const archivePath = join(outputDir, archiveName)
const checksumPath = `${archivePath}.sha256`
for (const path of [archivePath, checksumPath]) {
  if (existsSync(path)) throw new Error(`refusing to overwrite existing artifact: ${path}`)
}

const stagingPath = join(tmpdir(), 'harndock-runtime-build')
if (existsSync(stagingPath)) {
  throw new Error(`Runtime staging path is already in use: ${stagingPath}`)
}
const staging = await realpath(await mkdir(stagingPath, { recursive: false }).then(() => stagingPath))
const cleanHarness = join(staging, 'harness')
const artifactParent = join(staging, 'artifact')
const artifactRoot = join(artifactParent, manifestTemplate.archive.root)
const commandEnvironment = {
  ...process.env,
  CI: '1',
  DSH_TELEMETRY_DISABLED: '1',
  // Upstream build-time API: use our product title without altering vendor code.
  DSH_BUILD_CLIENT_PROFILE: undefined,
  DSH_CLIENT_BUILD_PROFILE: 'local',
  DSH_CLIENT_TITLE: 'harndock',
  DSH_CLIENT_COMMIT_HASH: harnessLock.commit,
  HUSKY: '0',
  LEFTHOOK: '0',
}

try {
  await assertHarnessSource()
  await exportHarness(cleanHarness)
  await patchDesktopWebViewAuthentication(cleanHarness)
  const packageMap = await discoverHarnessPackages(cleanHarness)
  const closure = resolveRuntimeClosure(packageMap, '@deepseek-ai/dsh')
  await writeDeployRoot(cleanHarness, closure)

  await mkdir(artifactRoot, { recursive: true })
  await installPinnedTools(artifactRoot)
  const runtimeNode = join(artifactRoot, 'bin', 'node')
  const runtimePnpm = join(artifactRoot, 'tools', 'pnpm', 'bin', 'pnpm.cjs')
  const pinnedEnvironment = {
    ...commandEnvironment,
    PATH: `${dirname(runtimeNode)}${delimiter}${commandEnvironment.PATH ?? ''}`,
  }
  const pnpm = args => run(runtimeNode, [runtimePnpm, 'with', 'current', ...args], {
    cwd: cleanHarness,
    env: pinnedEnvironment,
  })

  console.log(`Runtime builder: installing ${String(closure.length)} Harness workspace packages`)
  await pnpm(['install', '--lockfile-only', '--ignore-scripts'])
  await pnpm(['install', '--frozen-lockfile'])
  await pnpm(['build'])

  await enableInjectedWorkspacePackages(cleanHarness)
  await pnpm(['install', '--lockfile-only', '--ignore-scripts'])
  await pnpm(['install', '--frozen-lockfile'])
  await pnpm([
    '--filter',
    'harndock-runtime-deploy',
    'deploy',
    '--prod',
    '--ignore-scripts',
    join(artifactRoot, 'app'),
  ])

  await normalizeRuntimeGeneratedFiles(artifactRoot)
  await copyProductPackages(artifactRoot)
  await copyRuntimeMetadata(artifactRoot)
  await copyLicenses(artifactRoot, cleanHarness)

  const manifest = { ...manifestTemplate, runtimeVersion }
  await writeFile(join(artifactRoot, 'runtime-manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  await run(process.execPath, [join(root, 'scripts', 'verify-harness-runtime.mjs'), '--directory', artifactRoot], {
    cwd: root,
    env: commandEnvironment,
  })

  const epoch = Number(await capture('git', ['-C', harnessDir, 'show', '-s', '--format=%ct', harnessLock.commit]))
  await normalizeTree(artifactRoot, epoch)
  await mkdir(outputDir, { recursive: true })
  await createArchive(artifactParent, artifactRoot, archivePath, epoch)
  const checksum = await sha256(archivePath)
  await writeFile(checksumPath, `${checksum}  ${archiveName}\n`)
  await run(process.execPath, [join(root, 'scripts', 'verify-harness-runtime.mjs'), archivePath], {
    cwd: root,
    env: commandEnvironment,
  })

  const size = (await stat(archivePath)).size
  console.log(`Runtime artifact: ${archivePath}`)
  console.log(`Runtime SHA-256: ${checksum}`)
  console.log(`Runtime size: ${String(size)} bytes`)
} finally {
  if (values['keep-staging']) console.log(`Runtime staging retained at ${staging}`)
  else await rm(staging, { recursive: true, force: true })
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function run(command, args, options = {}) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} failed (${String(code ?? signal)}): ${args.join(' ')}`))
    })
  })
}

async function capture(command, args, options = {}) {
  return await new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', rejectCapture)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCapture(stdout.trim())
      else rejectCapture(new Error(`${command} failed (${String(code ?? signal)}): ${stderr.trim()}`))
    })
  })
}

async function assertHarnessSource() {
  const commit = await capture('git', ['-C', harnessDir, 'rev-parse', 'HEAD'])
  if (commit !== harnessLock.commit) throw new Error(`Harness commit mismatch: ${commit}`)
  const status = await capture('git', ['-C', harnessDir, 'status', '--porcelain'])
  if (status !== '') throw new Error('Harness submodule must be clean before building a Runtime')
}

async function exportHarness(destination) {
  await mkdir(destination, { recursive: true })
  const sourceArchive = join(staging, 'harness-source.tar')
  await run('git', ['-C', harnessDir, 'archive', '--format=tar', '--output', sourceArchive, harnessLock.commit])
  await run('tar', ['-xf', sourceArchive, '-C', destination])
}

async function patchDesktopWebViewAuthentication(sourceRoot) {
  const path = join(sourceRoot, 'packages', 'client', 'connection', 'src', 'browser-auth.ts')
  const content = await readFile(path, 'utf8')
  const strictCookie = '; HttpOnly; SameSite=Strict'
  const laxCookie = '; HttpOnly; SameSite=Lax'
  const matches = content.split(strictCookie).length - 1
  if (matches !== 1) {
    throw new Error(`desktop WebView authentication patch expected one SameSite=Strict cookie, found ${String(matches)}`)
  }
  await writeFile(path, content.replace(strictCookie, laxCookie))
  console.log('Runtime builder: patched browser-session Cookie for desktop WebView redirects')
}

async function packageDirectories(sourceRoot) {
  const directories = []
  for (const parent of ['vendor', 'apps']) {
    for (const entry of await readdir(join(sourceRoot, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(sourceRoot, parent, entry.name))
    }
  }
  for (const group of await readdir(join(sourceRoot, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of await readdir(join(sourceRoot, 'packages', group.name), { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(sourceRoot, 'packages', group.name, entry.name))
    }
  }
  directories.push(join(sourceRoot, 'native', 'landlock-run'))
  for (const entry of await readdir(join(sourceRoot, 'native', 'landlock-run', 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory()) directories.push(join(sourceRoot, 'native', 'landlock-run', 'packages', entry.name))
  }
  return directories
}

async function discoverHarnessPackages(sourceRoot) {
  const packages = new Map()
  for (const directory of await packageDirectories(sourceRoot)) {
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = await readJson(manifestPath)
    if (typeof manifest.name !== 'string') continue
    if (packages.has(manifest.name)) throw new Error(`duplicate Harness package name: ${manifest.name}`)
    packages.set(manifest.name, { directory, manifest })
  }
  return packages
}

function resolveRuntimeClosure(packageMap, entryName) {
  const selected = new Set()
  const queue = [entryName]
  while (queue.length > 0) {
    const name = queue.shift()
    if (selected.has(name)) continue
    const pkg = packageMap.get(name)
    if (pkg === undefined) throw new Error(`Harness Runtime package is unavailable: ${name}`)
    selected.add(name)
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(pkg.manifest[field] ?? {})) {
        if (packageMap.has(dependency) && !selected.has(dependency)) queue.push(dependency)
      }
    }
  }
  const supported = [...selected].filter(name => supportsCurrentTarget(packageMap.get(name).manifest))
  return supported.sort()
}

function supportsCurrentTarget(manifest) {
  const accepts = (values, current) => {
    if (!Array.isArray(values)) return true
    if (values.includes(`!${current}`)) return false
    const positive = values.filter(value => !value.startsWith('!'))
    return positive.length === 0 || positive.includes(current)
  }
  return accepts(manifest.os, 'darwin') && accepts(manifest.cpu, 'arm64')
}

async function writeDeployRoot(sourceRoot, packageNames) {
  const path = join(sourceRoot, 'python', 'sdk-runtime', 'package.json')
  const manifest = {
    name: 'harndock-runtime-deploy',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(packageNames.map(name => [name, 'workspace:^'])),
  }
  await writeFile(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

async function enableInjectedWorkspacePackages(sourceRoot) {
  const path = join(sourceRoot, 'pnpm-workspace.yaml')
  let workspace = await readFile(path, 'utf8')
  if (/^injectWorkspacePackages:/m.test(workspace)) {
    throw new Error('Harness workspace already defines injectWorkspacePackages; review the Runtime builder override')
  }
  const subprocessBuildRule = "  '@deepseek-ai/dsh-subprocess-local@file:packages/subprocess/subprocess-local': true"
  if (!workspace.includes(subprocessBuildRule)) {
    throw new Error('Harness workspace no longer contains the expected subprocess build allowlist rule')
  }
  workspace = workspace.replace(
    subprocessBuildRule,
    `${subprocessBuildRule}\n  '@deepseek-ai/dsh-subprocess-local': true`,
  )
  await writeFile(path, `${workspace.trimEnd()}\n\ninjectWorkspacePackages: true\n`)
}

async function downloadPinned(source, filename) {
  const cacheDir = join(root, 'node_modules', '.cache', 'harndock-runtime')
  const destination = join(cacheDir, filename)
  await mkdir(cacheDir, { recursive: true })
  if (existsSync(destination) && await sha256(destination) === source.sha256) return destination
  if (existsSync(destination)) await rm(destination, { force: true })

  const temporary = `${destination}.download`
  const response = await fetch(source.url, { redirect: 'follow' })
  if (!response.ok || response.body === null) throw new Error(`could not download ${source.url}: ${String(response.status)}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { mode: 0o600 }))
  const actual = await sha256(temporary)
  if (actual !== source.sha256) {
    await rm(temporary, { force: true })
    throw new Error(`SHA-256 mismatch for ${source.url}: ${actual}`)
  }
  await rename(temporary, destination)
  return destination
}

async function installPinnedTools(destination) {
  const nodeArchive = await downloadPinned(sourcesLock.node, `node-${sourcesLock.node.version}-${target}.tar.xz`)
  const nodeExtract = join(staging, 'node-extract')
  await mkdir(nodeExtract)
  await run('tar', ['-xJf', nodeArchive, '-C', nodeExtract])
  await mkdir(join(destination, 'bin'), { recursive: true })
  await copyFile(join(nodeExtract, sourcesLock.node.archiveRoot, 'bin', 'node'), join(destination, 'bin', 'node'))
  await chmod(join(destination, 'bin', 'node'), 0o755)

  const pnpmArchive = await downloadPinned(sourcesLock.pnpm, `pnpm-${sourcesLock.pnpm.version}.tgz`)
  const pnpmExtract = join(staging, 'pnpm-extract')
  await mkdir(pnpmExtract)
  await run('tar', ['-xzf', pnpmArchive, '-C', pnpmExtract])
  await mkdir(join(destination, 'tools'), { recursive: true })
  await cp(join(pnpmExtract, sourcesLock.pnpm.archiveRoot), join(destination, 'tools', 'pnpm'), {
    recursive: true,
    dereference: false,
  })
}

async function copyProductPackages(destination) {
  const packages = [
    ['desktop-bundle', ['package.json', 'cordis.patch.yml']],
    ['client-desktop', ['package.json', 'lib']],
    ['runtime-bridge', ['package.json', 'lib']],
    ['remote-sync', ['package.json', 'lib']],
  ]
  for (const [name, files] of packages) {
    const source = join(root, 'packages', name)
    const targetDirectory = join(destination, 'plugins', name)
    await mkdir(targetDirectory, { recursive: true })
    for (const file of files) {
      const from = join(source, file)
      if (!existsSync(from)) throw new Error(`${name} is not built: missing ${file}`)
      await cp(from, join(targetDirectory, file), { recursive: true, dereference: false })
    }
  }
}

async function normalizeRuntimeGeneratedFiles(destination) {
  for (const file of [
    'app/node_modules/.modules.yaml',
    'app/node_modules/.pnpm-workspace-state-v1.json',
  ]) await rm(join(destination, file), { force: true })

  // Rolldown's parallel client build can vary the order of CSS module map keys.
  // The generated object is a string-to-string map, so sorting its properties
  // removes that build race without changing runtime behavior.
  for (const path of await walk(join(destination, 'app'))) {
    if (basename(path) !== 'client.js') continue
    const content = await readFile(path, 'utf8')
    const normalized = content.replace(
      /(\bvar\s+[A-Za-z0-9_$]+_module_css_default\s*=\s*\{\n)([\s\S]*?)(\n\s*\};)/g,
      (_match, prefix, body, suffix) => {
        const lines = body.split('\n').filter(line => line.trim() !== '')
        const entries = lines.map(line => {
          const match = line.match(/^(\s*)("(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*")\s*,?$/)
          if (match === null) return null
          return {
            indent: match[1],
            key: JSON.parse(match[2]),
            value: JSON.parse(match[3]),
          }
        })
        if (entries.some(entry => entry === null) || entries.length === 0) return _match
        entries.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
        const indent = entries[0].indent
        const sortedBody = entries.map((entry, index) => (
          `${indent}${JSON.stringify(entry.key)}: ${JSON.stringify(entry.value)}${index === entries.length - 1 ? '' : ','}`
        )).join('\n')
        return `${prefix}${sortedBody}${suffix}`
      },
    )
    if (normalized !== content) await writeFile(path, normalized)
  }
}

async function copyRuntimeMetadata(destination) {
  for (const file of [
    'manifest.schema.json',
    'control-protocol.schema.json',
    'sources.lock.json',
  ]) await copyFile(join(runtimeDir, file), join(destination, file))
}

async function copyLicenses(destination, sourceRoot) {
  const licenses = join(destination, 'licenses')
  await mkdir(licenses, { recursive: true })
  await copyFile(join(sourceRoot, 'LICENSE'), join(licenses, 'deepseek-harness-LICENSE'))
  await copyFile(join(sourceRoot, 'THIRD_PARTY_NOTICES.md'), join(licenses, 'deepseek-harness-THIRD_PARTY_NOTICES.md'))
  await copyFile(join(staging, 'node-extract', sourcesLock.node.archiveRoot, 'LICENSE'), join(licenses, 'node-LICENSE'))
  await copyFile(join(staging, 'pnpm-extract', sourcesLock.pnpm.archiveRoot, 'LICENSE'), join(licenses, 'pnpm-LICENSE'))
}

async function sha256(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk)
      yield chunk
    }
  }, async function* (source) {
    for await (const _chunk of source) {}
  })
  return hash.digest('hex')
}

async function walk(path, entries = []) {
  const info = await lstat(path)
  entries.push(path)
  if (info.isDirectory()) {
    const children = await readdir(path)
    children.sort()
    for (const child of children) await walk(join(path, child), entries)
  }
  return entries
}

async function normalizeTree(directory, epochSeconds) {
  const timestamp = new Date(epochSeconds * 1_000)
  const entries = await walk(directory)
  for (const path of entries.reverse()) {
    let info = await lstat(path)
    if (info.isFile()) {
      const mode = info.mode & 0o111 ? 0o755 : 0o644
      if (info.nlink > 1) {
        const replacement = `${path}.harndock-copy`
        await copyFile(path, replacement)
        await chmod(replacement, mode)
        await rename(replacement, path)
        info = await lstat(path)
      }
      await chmod(path, mode)
      await utimes(path, timestamp, timestamp)
    } else if (info.isDirectory()) {
      await chmod(path, 0o755)
      await utimes(path, timestamp, timestamp)
    } else if (info.isSymbolicLink()) {
      await lutimes(path, timestamp, timestamp)
    } else {
      throw new Error(`unsupported artifact entry type: ${path}`)
    }
  }
}

async function createArchive(parent, directory, destination, epochSeconds) {
  const paths = await walk(directory)
  const names = paths
    .map(path => relative(parent, path).split(sep).join('/'))
    .sort()
  if (names.some(name => name.includes('\n'))) throw new Error('artifact paths must not contain newlines')
  const tarPath = join(staging, 'runtime.tar')
  await writeDeterministicTar(parent, paths, tarPath, epochSeconds)
  await run('zstd', ['-q', '-19', '-T1', '--no-progress', '-f', tarPath, '-o', destination])
}

async function writeDeterministicTar(parent, paths, destination, epochSeconds) {
  const output = createWriteStream(destination, { mode: 0o600 })
  let paxIndex = 0
  try {
    for (const path of paths) {
      const info = await lstat(path)
      const name = relative(parent, path).split(sep).join('/')
      const linkTarget = info.isSymbolicLink() ? await readlink(path) : ''
      const needsLongLink = Buffer.byteLength(linkTarget) > 100
      const needsPax = Buffer.byteLength(name) > 100 || needsLongLink
      const paxName = String(paxIndex++)
      const headerName = needsPax ? `././@PaxHeader/${paxName}` : name
      if (needsPax) {
        const records = [`path=${name}`]
        if (linkTarget !== '') records.push(`linkpath=${linkTarget}`)
        const payload = Buffer.from(records.map(paxRecord).join(''), 'utf8')
        await writeTarChunk(output, createTarHeader(`PaxHeader/${paxName}`, 0o644, payload.length, epochSeconds, 'x'))
        await writeTarChunk(output, payload)
        await writeTarPadding(output, payload.length)
      }

      const type = info.isFile() ? '0' : info.isDirectory() ? '5' : info.isSymbolicLink() ? '2' : null
      if (type === null) throw new Error(`unsupported artifact entry type: ${path}`)
      const size = info.isFile() ? info.size : 0
      await writeTarChunk(output, createTarHeader(
        headerName,
        info.mode & 0o7777,
        size,
        epochSeconds,
        type,
        needsLongLink ? '' : linkTarget,
      ))
      if (info.isFile()) {
        for await (const chunk of createReadStream(path)) await writeTarChunk(output, chunk)
        await writeTarPadding(output, size)
      }
    }
    await writeTarChunk(output, Buffer.alloc(1024))
  } finally {
    output.end()
    await once(output, 'close')
  }
}

function paxRecord(value) {
  const payload = `${value}\n`
  const payloadLength = Buffer.byteLength(payload)
  let length = payloadLength + 2
  while (length !== String(length).length + 1 + payloadLength) {
    length = String(length).length + 1 + payloadLength
  }
  return `${String(length)} ${payload}`
}

function createTarHeader(name, mode, size, epochSeconds, type, linkName = '') {
  const header = Buffer.alloc(512)
  writeTarField(header, 0, 100, name)
  writeTarField(header, 100, 8, octalField(mode, 8))
  writeTarField(header, 108, 8, octalField(0, 8))
  writeTarField(header, 116, 8, octalField(0, 8))
  writeTarField(header, 124, 12, octalField(size, 12))
  writeTarField(header, 136, 12, octalField(epochSeconds, 12))
  header.fill(0x20, 148, 156)
  writeTarField(header, 156, 1, type)
  writeTarField(header, 157, 100, linkName)
  writeTarField(header, 257, 6, 'ustar\0')
  writeTarField(header, 263, 2, '00')
  writeTarField(header, 265, 32, 'root')
  writeTarField(header, 297, 32, 'root')
  writeTarField(header, 329, 8, octalField(0, 8))
  writeTarField(header, 337, 8, octalField(0, 8))
  const checksum = [...header].reduce((total, byte) => total + byte, 0)
  writeTarField(header, 148, 8, `${Math.trunc(checksum).toString(8).padStart(6, '0')}\0 `)
  return header
}

function writeTarField(buffer, offset, length, value) {
  const field = Buffer.from(value, 'utf8')
  if (field.length > length) throw new Error(`tar field is too long: ${value}`)
  field.copy(buffer, offset)
}

function octalField(value, length) {
  const encoded = Math.trunc(value).toString(8)
  if (encoded.length + 1 > length) throw new Error(`tar numeric field is too large: ${String(value)}`)
  return `${'0'.repeat(length - encoded.length - 1)}${encoded}\0`
}

async function writeTarChunk(output, chunk) {
  if (output.write(chunk)) return
  await once(output, 'drain')
}

async function writeTarPadding(output, size) {
  const padding = (512 - (size % 512)) % 512
  if (padding > 0) await writeTarChunk(output, Buffer.alloc(padding))
}
