import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = join(root, 'runtime')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function validationError(label, validate) {
  return `${label} failed schema validation:\n${JSON.stringify(validate.errors, undefined, 2)}`
}

function semverTriplet(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  assert.notEqual(match, null, `expected a semantic version, got ${version}`)
  return match.slice(1).map(Number)
}

function compareSemver(left, right) {
  const a = semverTriplet(left)
  const b = semverTriplet(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function assertArtifactPath(path) {
  assert.equal(posix.isAbsolute(path), false, `${path} must be relative to the artifact root`)
  assert.equal(path.includes('\\'), false, `${path} must use archive separators`)
  assert.equal(path.split('/').includes('..'), false, `${path} must not escape the artifact root`)
  assert.equal(posix.normalize(path), path, `${path} must be normalized`)
}

const manifestSchema = readJson(join(runtimeDir, 'manifest.schema.json'))
const manifest = readJson(join(runtimeDir, 'manifest.example.json'))
const brandingSchema = readJson(join(runtimeDir, 'branding.schema.json'))
const branding = readJson(join(runtimeDir, 'branding.json'))
const controlSchema = readJson(join(runtimeDir, 'control-protocol.schema.json'))
const control = readJson(join(runtimeDir, 'control-protocol.example.json'))
const harnessLock = readJson(join(runtimeDir, 'harness.lock.json'))
const sourcesLock = readJson(join(runtimeDir, 'sources.lock.json'))
const rootPackage = readJson(join(root, 'package.json'))

const ajv = new Ajv2020({ allErrors: true, strict: true })
const validateManifest = ajv.compile(manifestSchema)
const validateBranding = ajv.compile(brandingSchema)
const validateControl = ajv.compile(controlSchema)
assert.equal(validateManifest(manifest), true, validationError('Runtime manifest example', validateManifest))
assert.equal(validateBranding(branding), true, validationError('Branding config', validateBranding))
assert.equal(branding.productName, 'Harndock')
assert.ok(branding.baseName.length > 0)
assert.equal(validateControl(control), true, validationError('Runtime control example', validateControl))

const invalidManifest = structuredClone(manifest)
invalidManifest.launch.node = '../bin/node'
assert.equal(validateManifest(invalidManifest), false, 'manifest schema must reject artifact path traversal')
const invalidControl = { ...control, url: 'http://localhost:43127/' }
assert.equal(validateControl(invalidControl), false, 'control schema must reject non-literal loopback URLs')
const invalidPort = { ...control, url: 'http://127.0.0.1:65536/' }
assert.equal(validateControl(invalidPort), false, 'control schema must reject ports above 65535')
const invalidPackages = structuredClone(manifest)
invalidPackages.productPackages[0].name = '@harndock/not-the-product-bundle'
assert.equal(validateManifest(invalidPackages), false, 'manifest schema must pin the product package set')

for (const path of [
  manifest.launch.node,
  manifest.launch.packageManagerEntrypoint,
  manifest.launch.harnessEntrypoint,
  manifest.launch.cwd,
  manifest.control.schema,
  ...manifest.productPackages.map(entry => entry.path),
]) assertArtifactPath(path)

assert.equal(manifest.runtimeApi, harnessLock.runtimeApi)
assert.equal(manifest.components.node.version, harnessLock.node)
assert.equal(manifest.components.harness.version, harnessLock.upstreamVersion)
assert.equal(manifest.components.harness.commit, harnessLock.commit)
assert.equal(manifest.archive.format, 'tar.zst')
assert.equal(manifest.archive.root, 'harndock-runtime')
assert.equal(manifest.target, 'darwin-aarch64')
assert.equal(manifest.control.schema, 'control-protocol.schema.json')
assert.equal(sourcesLock.target, manifest.target)
assert.equal(sourcesLock.node.version, manifest.components.node.version)
assert.equal(sourcesLock.pnpm.version, manifest.components.pnpm.version)
for (const source of [sourcesLock.node, sourcesLock.pnpm]) {
  assert.match(source.url, /^https:\/\//)
  assert.match(source.sha256, /^[0-9a-f]{64}$/)
  assert.match(source.archiveRoot, /^[A-Za-z0-9._-]+$/)
}

const packageManager = rootPackage.packageManager?.match(/^pnpm@(.+)$/)
assert.notEqual(packageManager, null, 'root packageManager must pin pnpm')
assert.equal(manifest.components.pnpm.version, packageManager[1])
assert.ok(compareSemver(rootPackage.version, manifest.shellCompatibility.minVersion) >= 0)
assert.ok(compareSemver(rootPackage.version, manifest.shellCompatibility.maxVersionExclusive) < 0)

const expectedPackages = new Map([
  ['@harndock/desktop-bundle', 'bundle'],
  ['@harndock/client-desktop', 'client'],
  ['@harndock/runtime-bridge', 'host'],
  ['@harndock/remote-sync', 'host'],
])
assert.equal(new Set(manifest.productPackages.map(entry => entry.name)).size, expectedPackages.size)
for (const entry of manifest.productPackages) assert.equal(entry.role, expectedPackages.get(entry.name))

assert.equal(control.protocolVersion, manifest.control.protocolVersion)
assert.equal(control.runtimeVersion, manifest.runtimeVersion)
assert.equal(control.runtimeApi, manifest.runtimeApi)
assert.equal(control.profile, manifest.profile.name)
assert.equal(control.harnessCommit, manifest.components.harness.commit)

console.log(`Runtime contract verified: ${manifest.runtimeVersion} ${manifest.target} API ${manifest.runtimeApi}`)
