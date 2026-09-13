export type MarkdownAlignment = 'left' | 'center' | 'right' | undefined

export interface ParagraphBlock { readonly kind: 'paragraph'; readonly text: string }
export interface HeadingBlock { readonly kind: 'heading'; readonly level: number; readonly text: string }
export interface ListBlock { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly string[] }
export interface QuoteBlock { readonly kind: 'quote'; readonly text: string }
export interface CodeBlock { readonly kind: 'code'; readonly language: string; readonly text: string }
export interface RuleBlock { readonly kind: 'rule' }
export interface TableBlock {
  readonly kind: 'table'
  readonly header: readonly string[]
  readonly alignments: readonly MarkdownAlignment[]
  readonly rows: readonly (readonly string[])[]
}

export type MarkdownBlock = ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | CodeBlock | RuleBlock | TableBlock

export interface MarkdownInline {
  readonly kind: 'text' | 'strong' | 'emphasis' | 'code' | 'strikethrough' | 'link'
  readonly text: string
  readonly href?: string
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') { index += 1; continue }
    const fence = line.match(/^\s*```\s*([^`]*)$/)
    if (fence !== null) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code', language: (fence[1] ?? '').trim(), text: code.join('\n') })
      continue
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' })
      index += 1
      continue
    }
    const nextLine = lines[index + 1]
    if (nextLine !== undefined && isTableRow(line) && isTableDelimiter(nextLine)) {
      const header = splitTableRow(line)
      const delimiter = splitTableRow(nextLine)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(normalizeCells(splitTableRow(lines[index] ?? ''), header.length))
        index += 1
      }
      blocks.push({
        kind: 'table',
        header,
        alignments: normalizeCells(delimiter, header.length).map(tableAlignment),
        rows,
      })
      continue
    }
    if (isHorizontalRule(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', text: quote.join('\n') })
      continue
    }
    const listMatch = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/)
    if (listMatch !== null) {
      const ordered = /^\d/.test(listMatch[1] ?? '')
      const start = ordered ? Number.parseInt(listMatch[1] ?? '1', 10) : 1
      const items: string[] = []
      while (index < lines.length) {
        const entry = (lines[index] ?? '').match(/^\s*([-+*]|\d+[.)])\s+(.+)$/)
        if (entry === null || /^\d/.test(entry[1] ?? '') !== ordered) break
        items.push(entry[2] ?? '')
        index += 1
      }
      blocks.push({ kind: 'list', ordered, start: Number.isFinite(start) ? start : 1, items })
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
  }
  return blocks
}

export function parseMarkdownInline(source: string): MarkdownInline[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|!?\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\))/g
  const result: MarkdownInline[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) result.push({ kind: 'text', text: source.slice(cursor, match.index) })
    const token = match[0] ?? ''
    if (token.startsWith('**') || token.startsWith('__')) {
      result.push({ kind: 'strong', text: token.slice(2, -2) })
    } else if (token.startsWith('~~')) {
      result.push({ kind: 'strikethrough', text: token.slice(2, -2) })
    } else if (token.startsWith('*') || token.startsWith('_')) {
      result.push({ kind: 'emphasis', text: token.slice(1, -1) })
    } else if (token.startsWith('`')) {
      result.push({ kind: 'code', text: token.slice(1, -1) })
    } else {
      const link = token.match(/^(!?)\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/)
      const imageLabel = link?.[1] === '!' ? '图片：' : ''
      result.push({ kind: 'link', href: link?.[3], text: `${imageLabel}${link?.[2] || link?.[3] || token}` })
    }
    cursor = match.index + token.length
  }
  if (cursor < source.length) result.push({ kind: 'text', text: source.slice(cursor) })
  return result
}

export function isSafeMarkdownLink(value: string | undefined): value is string {
  if (value === undefined) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? ''
  if (line.trim() === '') return true
  if (/^\s*```/.test(line) || /^\s*#{1,6}\s+/.test(line) || /^\s*>\s?/.test(line)) return true
  if (/^\s*([-+*]|\d+[.)])\s+/.test(line) || isHorizontalRule(line)) return true
  return isTableRow(line) && isTableDelimiter(lines[index + 1] ?? '')
}

function isHorizontalRule(line: string): boolean {
  const compact = line.trim().replace(/\s/g, '')
  return /^(\*{3,}|-{3,}|_{3,})$/.test(compact)
}

function isTableRow(line: string): boolean {
  return line.includes('|') && splitTableRow(line).length > 1
}

function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

function splitTableRow(line: string): string[] {
  const protectedPipes = line.replace(/\\\|/g, '\u0000')
  const trimmed = protectedPipes.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map(cell => cell.trim().replace(/\u0000/g, '|'))
}

function normalizeCells(cells: readonly string[], length: number): string[] {
  return Array.from({ length }, (_, index) => cells[index] ?? '')
}

function tableAlignment(delimiter: string): MarkdownAlignment {
  const left = delimiter.startsWith(':')
  const right = delimiter.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}
