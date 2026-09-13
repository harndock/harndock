import { rm } from 'node:fs/promises'
import { build } from 'esbuild'
import ts from 'typescript'

await rm(new URL('../lib', import.meta.url), { recursive: true, force: true })

const parsed = ts.getParsedCommandLineOfConfigFile(
  new URL('../tsconfig.json', import.meta.url).pathname,
  { emitDeclarationOnly: true },
  ts.sys,
)
if (parsed === undefined) throw new Error('could not load remote-sync tsconfig')
const program = ts.createProgram(parsed.fileNames, parsed.options)
const result = program.emit()
const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics)
if (diagnostics.length > 0) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  }))
}

await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../lib/index.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['ws'],
})
