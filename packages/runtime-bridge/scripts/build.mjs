import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(packageDir, 'lib')

await rm(outputDir, { recursive: true, force: true })
await build({
  entryPoints: [resolve(packageDir, 'src/index.js')],
  outfile: resolve(outputDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
})
