import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, readdir, readlink, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Ajv2020 from 'ajv/dist/2020.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values, positionals } = parseArgs({
  options: { directory: { type: 'string' } },
  allowPositionals: true,
})
if ((values.directory === undefined) === (positionals.length === 0)) {
  throw new Error('usage: verify-harness-runtime.mjs --directory <root> | <archive.tar.zst>')
}

let temporary
try {
  let runtimeRoot
  if (values.directory !== undefined) runtimeRoot = resolve(values.directory)
  else {
    const archive = resolve(positionals[0])
    await verifyArchive(archive)
    temporary = await mkdtemp(join(tmpdir(), 'harndock-runtime-verify-'))
    run('tar', ['-xf', archive, '-C', temporary])
    runtimeRoot = join(temporary, 'harndock-runtime')
  }
  const manifest = await verifyDirectory(runtimeRoot)
  console.log(`Runtime artifact verified: ${manifest.runtimeVersion} ${manifest.target}`)
} finally {
  if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} failed (${String(result.status ?? result.signal)}):\n${result.stderr}`)
  }
  return result.stdout.trim()
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
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

async function verifyArchive(archive) {
  assert.equal(existsSync(archive), true, `Runtime archive is unavailable: ${archive}`)
  const checksumFile = `${archive}.sha256`
  const checksumLine = (await readFile(checksumFile, 'utf8')).trim()
  const match = checksumLine.match(/^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/)
  assert.notEqual(match, null, 'Runtime checksum file has an invalid format')
  assert.equal(match[2], basename(archive))
  assert.equal(await sha256(archive), match[1], 'Runtime archive SHA-256 mismatch')

  const names = run('tar', ['-tf', archive]).split('\n').filter(Boolean)
  assert.ok(names.length > 0, 'Runtime archive is empty')
  assert.equal(new Set(names).size, names.length, 'Runtime archive contains duplicate paths')
  for (const name of names) {
    assert.equal(isAbsolute(name), false, `absolute archive path: ${name}`)
    assert.equal(name.includes('\\'), false, `backslash archive path: ${name}`)
    assert.equal(name.split('/').includes('..'), false, `escaping archive path: ${name}`)
    assert.ok(name === 'harndock-runtime' || name.startsWith('harndock-runtime/'), `unexpected archive root: ${name}`)
  }

  const details = run('tar', ['-tvf', archive]).split('\n').filter(Boolean)
  for (const line of details) {
    assert.ok(['-', 'd', 'l'].includes(line[0]), `unsupported archive entry: ${line}`)
    if (line[0] === 'l') {
      const marker = line.lastIndexOf(' -> ')
      assert.ok(marker !== -1, `could not parse archive symlink: ${line}`)
      const entry = names
        .filter(name => line.slice(0, marker).endsWith(name))
        .sort((left, right) => right.length - left.length)[0]
      assert.notEqual(entry, undefined, `could not identify archive symlink path: ${line}`)
      const target = line.slice(marker + 4)
      assert.equal(isAbsolute(target), false, `absolute archive symlink: ${target}`)
      const resolved = normalize(join(dirname(entry), target))
      assert.ok(
        resolved === 'harndock-runtime' || resolved.startsWith('harndock-runtime/'),
        `archive symlink escapes root: ${entry} -> ${target}`,
      )
    }
  }
}

async function verifyDirectory(runtimeRoot) {
  const manifestPath = join(runtimeRoot, 'runtime-manifest.json')
  const schema = await readJson(join(runtimeRoot, 'manifest.schema.json'))
  const manifest = await readJson(manifestPath)
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors, undefined, 2))

  for (const path of [
    manifest.launch.node,
    manifest.launch.packageManagerEntrypoint,
    manifest.launch.harnessEntrypoint,
    manifest.launch.cwd,
    manifest.control.schema,
    ...manifest.productPackages.map(entry => entry.path),
  ]) assertWithin(runtimeRoot, path)

  const node = join(runtimeRoot, manifest.launch.node)
  const pnpm = join(runtimeRoot, manifest.launch.packageManagerEntrypoint)
  const dsh = join(runtimeRoot, manifest.launch.harnessEntrypoint)
  assert.ok((await stat(node)).mode & 0o111, 'bundled Node must be executable')
  assert.equal(run(node, ['--version']), `v${manifest.components.node.version}`)
  assert.equal(run(node, [pnpm, '--version'], { cwd: join(runtimeRoot, manifest.launch.cwd) }), manifest.components.pnpm.version)
  assert.equal(run(node, [dsh, '--version'], { cwd: join(runtimeRoot, manifest.launch.cwd), env: cleanEnvironment(runtimeRoot) }), manifest.components.harness.version)

  for (const product of manifest.productPackages) {
    const packageManifest = await readJson(join(runtimeRoot, product.path, 'package.json'))
    assert.equal(packageManifest.name, product.name)
  }
  for (const packageName of ['typescript', 'tsx', 'vitest', 'lefthook', 'esbuild']) {
    assert.equal(existsSync(join(runtimeRoot, 'app', 'node_modules', packageName)), false, `development package leaked into Runtime: ${packageName}`)
  }
  await verifyTree(runtimeRoot)
  return manifest
}

function assertWithin(rootDirectory, artifactPath) {
  assert.equal(isAbsolute(artifactPath), false)
  const path = resolve(rootDirectory, artifactPath)
  const prefix = rootDirectory.endsWith(sep) ? rootDirectory : `${rootDirectory}${sep}`
  assert.ok(path.startsWith(prefix), `artifact path escapes root: ${artifactPath}`)
  assert.equal(existsSync(path), true, `manifest path is unavailable: ${artifactPath}`)
}

function cleanEnvironment(runtimeRoot) {
  const environment = {
    ...process.env,
    DSH_HOME: join(runtimeRoot, '.self-check-home'),
    DSH_AGENTS_HOME: join(runtimeRoot, '.self-check-agents'),
    DSH_TELEMETRY_DISABLED: '1',
  }
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  delete environment.TSX_TSCONFIG_PATH
  return environment
}

async function verifyTree(runtimeRoot) {
  async function visit(path) {
    const info = await lstat(path)
    const relativePath = relative(runtimeRoot, path)
    const segments = relativePath.split(sep)
    for (const banned of ['.git', '__pycache__']) {
      assert.equal(segments.includes(banned), false, `forbidden Runtime path: ${relativePath}`)
    }
    if (info.isSymbolicLink()) {
      const target = await readlink(path)
      assert.equal(isAbsolute(target), false, `absolute Runtime symlink: ${relativePath}`)
      const resolved = resolve(dirname(path), target)
      const prefix = runtimeRoot.endsWith(sep) ? runtimeRoot : `${runtimeRoot}${sep}`
      assert.ok(resolved.startsWith(prefix), `Runtime symlink escapes root: ${relativePath} -> ${target}`)
      return
    }
    if (!info.isDirectory()) return
    const entries = await readdir(path)
    for (const entry of entries) await visit(join(path, entry))
  }
  await visit(runtimeRoot)
}
