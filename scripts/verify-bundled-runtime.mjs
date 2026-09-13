import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = join(root, 'runtime')
const descriptor = JSON.parse(readFileSync(join(runtimeDir, 'bundled-runtime.json'), 'utf8'))
const schema = JSON.parse(readFileSync(join(runtimeDir, 'bundled-runtime.schema.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(runtimeDir, 'manifest.example.json'), 'utf8'))
const releaseConfig = JSON.parse(readFileSync(
  join(root, 'apps', 'desktop', 'src-tauri', 'tauri.release.conf.json'),
  'utf8',
))
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
assert.equal(validate(descriptor), true, JSON.stringify(validate.errors, undefined, 2))
assert.equal(descriptor.runtimeVersion, manifest.runtimeVersion)
assert.equal(descriptor.target, manifest.target)
assert.equal(descriptor.archive, `harndock-runtime-${descriptor.runtimeVersion}-${descriptor.target}.tar.zst`)

assert.deepEqual(releaseConfig.bundle?.resources, {
  [`../../../dist/runtime/${descriptor.archive}`]: `runtime/${descriptor.archive}`,
  [`../../../dist/runtime/${descriptor.archive}.sha256`]: `runtime/${descriptor.archive}.sha256`,
  '../../../runtime/bundled-runtime.json': 'runtime/bundled-runtime.json',
  '../../../runtime/bundled-runtime.schema.json': 'runtime/bundled-runtime.schema.json',
}, 'the release config must bundle the pinned Runtime and descriptor')

const archive = join(root, 'dist', 'runtime', descriptor.archive)
const checksumPath = `${archive}.sha256`
const checksum = readFileSync(checksumPath, 'utf8').trim()
const match = checksum.match(/^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/)
assert.notEqual(match, null, 'bundled Runtime checksum has an invalid format')
assert.equal(match[2], basename(archive))
const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
assert.equal(actual, match[1], 'bundled Runtime archive SHA-256 mismatch')

const extracted = spawnSync(
  'tar',
  ['--use-compress-program=unzstd', '-xOf', archive, 'harndock-runtime/runtime-manifest.json'],
  { encoding: 'utf8' },
)
assert.equal(extracted.status, 0, `could not read bundled Runtime manifest: ${extracted.stderr}`)
const bundledManifest = JSON.parse(extracted.stdout)
assert.deepEqual(bundledManifest, manifest, 'bundled Runtime manifest does not match the source contract')

console.log(`Bundled Runtime verified: ${descriptor.runtimeVersion} ${descriptor.target}`)
