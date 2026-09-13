import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessDir = join(root, 'vendor', 'deepseek-harness')
const lock = JSON.parse(readFileSync(join(root, 'runtime', 'harness.lock.json'), 'utf8'))

function git(args) {
  return execFileSync('git', ['-C', harnessDir, ...args], { encoding: 'utf8' }).trim()
}

const actualCommit = git(['rev-parse', 'HEAD'])
if (actualCommit !== lock.commit) {
  throw new Error(`Harness commit mismatch: lock has ${lock.commit}, submodule has ${actualCommit}`)
}

const manifest = JSON.parse(readFileSync(join(harnessDir, 'package.json'), 'utf8'))
if (manifest.version !== lock.upstreamVersion) {
  throw new Error(`Harness version mismatch: lock has ${lock.upstreamVersion}, package.json has ${String(manifest.version)}`)
}

const configuredUrl = execFileSync(
  'git',
  ['config', '--file', join(root, '.gitmodules'), '--get', 'submodule.vendor/deepseek-harness.url'],
  { encoding: 'utf8' },
).trim()
if (configuredUrl !== lock.repository) {
  throw new Error(`Harness repository mismatch: lock has ${lock.repository}, .gitmodules has ${configuredUrl}`)
}

console.log(`Harness lock verified: ${lock.upstreamVersion} (${actualCommit.slice(0, 12)})`)
