import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isSafeMarkdownLink,
  parseMarkdownBlocks,
  parseMarkdownInline,
} from '../src/features/conversation/markdown-model.ts'

test('Markdown blocks preserve Harness replies as readable mobile structures', () => {
  const blocks = parseMarkdownBlocks([
    '# 结果',
    '',
    '5. 第五项',
    '6. 第六项',
    '',
    '- [x] 已完成',
    '- [ ] 待处理',
    '',
    '> 安全摘要',
    '',
    '---',
    '',
    '```ts',
    'const answer = 42',
    '```',
  ].join('\n'))

  assert.deepEqual(blocks, [
    { kind: 'heading', level: 1, text: '结果' },
    { kind: 'list', ordered: true, start: 5, items: ['第五项', '第六项'] },
    { kind: 'list', ordered: false, start: 1, items: ['[x] 已完成', '[ ] 待处理'] },
    { kind: 'quote', text: '安全摘要' },
    { kind: 'rule' },
    { kind: 'code', language: 'ts', text: 'const answer = 42' },
  ])
})

test('Markdown tables keep alignment and normalize short rows for horizontal rendering', () => {
  const blocks = parseMarkdownBlocks([
    '| 名称 | 数量 | 说明 |',
    '| :--- | ---: | :---: |',
    '| A | 2 | 正常 |',
    '| B | 3 |',
  ].join('\n'))

  assert.deepEqual(blocks, [{
    kind: 'table',
    header: ['名称', '数量', '说明'],
    alignments: ['left', 'right', 'center'],
    rows: [['A', '2', '正常'], ['B', '3', '']],
  }])
})

test('Markdown inline parsing styles common reply fragments and keeps destinations explicit', () => {
  assert.deepEqual(parseMarkdownInline('**粗体**、*斜体*、~~旧值~~、`code`、[文档](https://example.com/docs)'), [
    { kind: 'strong', text: '粗体' },
    { kind: 'text', text: '、' },
    { kind: 'emphasis', text: '斜体' },
    { kind: 'text', text: '、' },
    { kind: 'strikethrough', text: '旧值' },
    { kind: 'text', text: '、' },
    { kind: 'code', text: 'code' },
    { kind: 'text', text: '、' },
    { kind: 'link', href: 'https://example.com/docs', text: '文档' },
  ])
})

test('Markdown links only open explicit HTTP and HTTPS destinations', () => {
  assert.equal(isSafeMarkdownLink('https://example.com'), true)
  assert.equal(isSafeMarkdownLink('http://127.0.0.1:7019/health'), true)
  assert.equal(isSafeMarkdownLink('javascript:alert(1)'), false)
  assert.equal(isSafeMarkdownLink('file:///private/data'), false)
  assert.equal(isSafeMarkdownLink('/relative/path'), false)
})
