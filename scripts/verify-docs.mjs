import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = join(root, 'docs')
const files = collectMarkdownFiles(docsDir).sort()
const failures = []

function collectMarkdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectMarkdownFiles(path)
    return entry.isFile() && extname(entry.name) === '.md' ? [path] : []
  })
}

for (const path of files) {
  const file = relative(docsDir, path)
  const content = readFileSync(path, 'utf8')
  if (!content.endsWith('\n') || content.endsWith('\n\n')) {
    failures.push(`${file}: expected exactly one trailing newline`)
  }
  const fenceCount = [...content.matchAll(/^```/gm)].length
  if (fenceCount % 2 !== 0) failures.push(`${file}: unbalanced fenced code blocks`)
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (/^(?:[a-z]+:|#)/i.test(target)) continue
    const linkTarget = target.split('#', 1)[0]
    if (linkTarget !== '' && !existsSync(resolve(dirname(path), linkTarget))) {
      failures.push(`${file}: missing relative link target ${target}`)
    }
  }
}

if (failures.length > 0) throw new Error(`Documentation checks failed:\n${failures.join('\n')}`)
console.log(`Documentation verified: ${files.length} Markdown files`)
