import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(packageDir, 'lib')
const pluginId = '@harndock/client-desktop'
const brandingPath = resolve(packageDir, '../../runtime/branding.json')
const branding = JSON.parse(await readFile(brandingPath, 'utf8'))
if (typeof branding.baseName !== 'string' || branding.baseName.length === 0) {
  throw new Error(`branding config ${brandingPath} must define a non-empty baseName`)
}

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

await build({
  entryPoints: [resolve(packageDir, 'src/index.js')],
  outfile: resolve(outputDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
})

const client = await build({
  entryPoints: [resolve(packageDir, 'src/client.js')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  define: {
    'process.env.HARNDOCK_BASE_NAME': JSON.stringify(branding.baseName),
  },
  legalComments: 'none',
  write: false,
})
const body = client.outputFiles[0]?.text
if (body === undefined) throw new Error('esbuild did not produce the desktop Client plugin')

const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pluginId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body.split('\n').map(line => `    ${line}`).join('\n')}
    return module.exports;
  }
});
`
await writeFile(resolve(outputDir, 'client.js'), wrapped)
