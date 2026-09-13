import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gatewayRoot = resolve(root, '../dsh-sync-server/apps/gateway-console')
const mobileI18n = join(root, 'apps/mobile/src/i18n/index.tsx')
const gatewayI18n = join(gatewayRoot, 'src/i18n/index.tsx')
const failures = []

if (existsSync(gatewayI18n)) {
  checkDictionary(readFileSync(mobileI18n, 'utf8'), 'Mobile')
  checkDictionary(readFileSync(gatewayI18n, 'utf8'), 'Gateway')
} else {
  checkDictionary(readFileSync(mobileI18n, 'utf8'), 'Mobile')
  console.warn(`Gateway dictionary not found; checked Mobile only: ${gatewayI18n}`)
}

for (const file of mobileUiFiles()) scanUiFile(file, root)
if (existsSync(gatewayRoot)) scanUiFile(join(gatewayRoot, 'src/App.tsx'), gatewayRoot)

if (failures.length > 0) throw new Error(`Internationalization checks failed:\n${failures.join('\n')}`)
console.log('Internationalization checks passed')

function checkDictionary(source, name) {
  const zh = extractLocaleKeys(source, 'zh')
  const en = extractLocaleKeys(source, 'en')
  if (zh.size === 0 || en.size === 0) {
    failures.push(`${name} dictionary has no extractable zh/en keys`)
    return
  }
  compareKeys(zh, en, `${name}.zh`, `${name}.en`)
}

function compareKeys(left, right, leftName, rightName) {
  const missing = [...left].filter(key => !right.has(key))
  const extra = [...right].filter(key => !left.has(key))
  if (missing.length > 0) failures.push(`${rightName} dictionary missing keys: ${missing.join(', ')}`)
  if (extra.length > 0) failures.push(`${rightName} dictionary has extra keys: ${extra.join(', ')}`)
  if (left.size === 0) failures.push(`${leftName} dictionary has no extractable keys`)
}

function extractLocaleKeys(source, locale) {
  const marker = locale === 'zh' ? /const zh[^=]*=\s*\{/ : /const en[^=]*=\s*\{/i
  const start = source.search(marker)
  if (start < 0) return new Set()
  const bodyStart = source.indexOf('{', start)
  const bodyEnd = source.indexOf('\n}', bodyStart)
  if (bodyEnd < 0) return new Set()
  return new Set([...source.slice(bodyStart, bodyEnd).matchAll(/^\s*["']([^"']+)["']\s*:/gm)].map(match => match[1]))
}

function mobileUiFiles() {
  return [
    join(root, 'apps/mobile/src/components'),
    join(root, 'apps/mobile/src/screens'),
  ].flatMap(directory => collect(directory)).filter(file => !file.endsWith('i18n/index.tsx'))
}

function collect(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collect(path) : [path]
  })
}

function scanUiFile(file, workspace) {
  if (!/\.(tsx|ts)$/.test(file)) return
  let original = readFileSync(file, 'utf8')
  if (file.endsWith('App.tsx') && file.includes('gateway-console')) {
    const helperStart = original.indexOf('function formatTimestamp(')
    if (helperStart >= 0) {
      const helperEnd = original.indexOf('\n}\n', helperStart)
      if (helperEnd >= 0) original = original.slice(0, helperStart) + original.slice(helperEnd + 3)
    }
  }
  const source = stripComments(original)
  source.split('\n').forEach((line, index) => {
    if (/[\u4e00-\u9fff]/.test(line)) failures.push(`${relative(workspace, file)}:${index + 1}: Chinese UI literal; use t(...)`)
  })
}

function stripComments(source) {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
