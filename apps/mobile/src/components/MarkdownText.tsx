import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  isSafeMarkdownLink,
  parseMarkdownBlocks,
  parseMarkdownInline,
  type MarkdownBlock,
  type MarkdownInline,
} from '../features/conversation/markdown-model'
import { mobileTheme } from '../theme'
import { useI18n } from '../i18n'

export function MarkdownText({ text, streaming = false }: { readonly text: string; readonly streaming?: boolean }): React.JSX.Element {
  const { t } = useI18n()
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text])
  return (
    <View style={styles.root}>
      {blocks.map((block, index) => <MarkdownBlockView block={block} key={`${block.kind}:${index}`} />)}
      {streaming && <Text accessibilityLabel={t('conversation.generated')} style={styles.cursor}>▍</Text>}
    </View>
  )
}

export function CopyButton({ text, label }: { readonly text: string; readonly label?: string }): React.JSX.Element {
  const { t } = useI18n()
  const resolvedLabel = label ?? t('copy.reply')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [copying, setCopying] = useState(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])
  const onCopy = useCallback(async (): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setCopying(true)
    try {
      await Clipboard.setStringAsync(text)
      setCopyState('copied')
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopyState('idle'), 1_200)
    } catch {
      setCopyState('error')
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopyState('idle'), 1_800)
    } finally {
      pending.current = false
      setCopying(false)
    }
  }, [text])

  const copied = copyState === 'copied'
  const copyFailed = copyState === 'error'
  const feedback = copied ? t('copy.copied') : copyFailed ? t('copy.failed') : t('copy.idle')

  return (
    <Pressable
      accessibilityLabel={copied ? `${t('copy.copied')}${resolvedLabel}` : copyFailed ? `${resolvedLabel}${t('copy.failed')}` : `${t('copy.idle')}${resolvedLabel}`}
      accessibilityRole="button"
      accessibilityState={{ busy: copying }}
      disabled={copying}
      onPress={() => { void onCopy() }}
      style={({ pressed }) => [styles.copyButton, pressed && styles.copyPressed, copying && styles.copyPending]}
    >
      <Text style={[styles.copyIcon, copied && styles.copySuccess, copyFailed && styles.copyError]}>{copied ? '✓' : copyFailed ? '!' : '⧉'}</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.copyLabel, copied && styles.copySuccess, copyFailed && styles.copyError]}>{feedback}</Text>
    </Pressable>
  )
}

function MarkdownBlockView({ block }: { readonly block: MarkdownBlock }): React.JSX.Element {
  const { t } = useI18n()
  if (block.kind === 'heading') {
    return <Text selectable style={[styles.heading, headingStyle(block.level)]}>{renderInline(block.text)}</Text>
  }
  if (block.kind === 'list') {
    return (
      <View style={styles.list}>
        {block.items.map((item, index) => (
          <View key={`${index}:${item}`} style={styles.listItem}>
            <Text style={styles.bullet}>{listMarker(block.ordered, block.start + index, item)}</Text>
            <Text selectable style={styles.listText}>{renderInline(stripTaskMarker(item))}</Text>
          </View>
        ))}
      </View>
    )
  }
  if (block.kind === 'quote') {
    return <View style={styles.quote}><Text selectable style={styles.quoteText}>{renderInline(block.text)}</Text></View>
  }
  if (block.kind === 'code') {
    return (
      <View style={styles.codeBlock}>
        <View style={styles.codeHeader}>
          <Text style={styles.codeLanguage}>{block.language || t('markdown.codeFallback')}</Text>
          <CopyButton label={t('copy.code')} text={block.text} />
        </View>
        <ScrollView
          contentContainerStyle={styles.codeScrollContent}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
        >
          <Text selectable style={styles.codeText}>{block.text}</Text>
        </ScrollView>
      </View>
    )
  }
  if (block.kind === 'rule') return <View accessibilityRole="none" style={styles.rule} />
  if (block.kind === 'table') {
    return (
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeaderRow]}>
            {block.header.map((cell, index) => (
              <Text key={`header:${index}`} selectable style={[styles.tableCell, styles.tableHeaderCell, tableTextAlign(block.alignments[index])]}>
                {renderInline(cell)}
              </Text>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View key={`row:${rowIndex}`} style={styles.tableRow}>
              {row.map((cell, cellIndex) => (
                <Text key={`cell:${rowIndex}:${cellIndex}`} selectable style={[styles.tableCell, tableTextAlign(block.alignments[cellIndex])]}>
                  {renderInline(cell)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    )
  }
  return <Text selectable style={styles.paragraph}>{renderInline(block.text)}</Text>
}

function renderInline(source: string): React.JSX.Element[] {
  return parseMarkdownInline(source).map((token, index) => <InlineToken key={`${token.kind}:${index}`} token={token} />)
}

function InlineToken({ token }: { readonly token: MarkdownInline }): React.JSX.Element {
  const { t } = useI18n()
  if (token.kind === 'strong') return <Text style={styles.strong}>{token.text}</Text>
  if (token.kind === 'emphasis') return <Text style={styles.em}>{token.text}</Text>
  if (token.kind === 'strikethrough') return <Text style={styles.strikethrough}>{token.text}</Text>
  if (token.kind === 'code') return <Text style={styles.inlineCode}>{token.text}</Text>
  const href = token.href
  if (token.kind === 'link' && isSafeMarkdownLink(href)) {
    return (
      <Text
        accessibilityHint={t('markdown.openLink', { href })}
        accessibilityRole="link"
        onPress={() => { void Linking.openURL(href).catch(() => undefined) }}
        style={styles.link}
      >
        {token.text}
      </Text>
    )
  }
  if (token.kind === 'link') return <Text>{token.text} ({token.href})</Text>
  return <Text>{token.text}</Text>
}

function listMarker(ordered: boolean, index: number, item: string): string {
  if (ordered) return `${index}.`
  if (/^\[[xX]\]\s+/.test(item)) return '☑'
  if (/^\[ \]\s+/.test(item)) return '☐'
  return '•'
}

function stripTaskMarker(item: string): string {
  return item.replace(/^\[(?:[xX]| )\]\s+/, '')
}

function tableTextAlign(alignment: 'left' | 'center' | 'right' | undefined) {
  if (alignment === 'center') return styles.tableTextCenter
  if (alignment === 'right') return styles.tableTextRight
  return styles.tableTextLeft
}

function headingStyle(level: number) {
  if (level <= 2) return styles.headingLarge
  if (level <= 4) return styles.headingMedium
  return styles.headingSmall
}

const { color, radius, spacing, typography } = mobileTheme
const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  paragraph: { color: color.text, fontSize: typography.body, lineHeight: 24 },
  heading: { color: color.text, fontWeight: '700', lineHeight: 28 },
  headingLarge: { fontSize: 20, marginTop: spacing.xs },
  headingMedium: { fontSize: 17, marginTop: spacing.xs },
  headingSmall: { fontSize: 15, marginTop: spacing.xs },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  strikethrough: { color: color.textSecondary, textDecorationLine: 'line-through' },
  inlineCode: { backgroundColor: color.surfaceMuted, borderRadius: 4, color: color.textSecondary, fontFamily: 'monospace', fontSize: 13, paddingHorizontal: 3 },
  link: { color: color.brand, textDecorationLine: 'underline' },
  list: { gap: spacing.xs },
  listItem: { flexDirection: 'row', gap: spacing.xs },
  bullet: { color: color.textSecondary, fontSize: typography.body, lineHeight: 24, minWidth: 20, textAlign: 'right' },
  listText: { color: color.text, flex: 1, fontSize: typography.body, lineHeight: 24 },
  quote: { borderLeftColor: color.borderStrong, borderLeftWidth: 3, paddingLeft: spacing.sm },
  quoteText: { color: color.textSecondary, fontSize: typography.body, lineHeight: 23 },
  codeBlock: { backgroundColor: color.surfaceMuted, borderColor: color.border, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, padding: spacing.sm },
  codeHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  codeScrollContent: { minWidth: '100%' },
  codeLanguage: { color: color.textTertiary, fontFamily: 'monospace', fontSize: typography.caption },
  codeText: { color: color.text, fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  copyButton: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: mobileTheme.touchTarget, minWidth: mobileTheme.touchTarget, paddingHorizontal: spacing.xs },
  copyPressed: { backgroundColor: color.surfaceMuted, borderRadius: radius.sm },
  copyPending: { opacity: 0.7 },
  copyIcon: { color: color.textSecondary, fontSize: 15 },
  copyLabel: { color: color.textSecondary, fontSize: typography.caption },
  copySuccess: { color: color.positive },
  copyError: { color: color.danger },
  rule: { backgroundColor: color.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  table: { borderColor: color.border, borderLeftWidth: 1, borderRadius: radius.sm, borderTopWidth: 1, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableHeaderRow: { backgroundColor: color.surfaceMuted },
  tableCell: { borderBottomColor: color.border, borderBottomWidth: 1, borderRightColor: color.border, borderRightWidth: 1, color: color.text, fontSize: 13, lineHeight: 19, minWidth: 112, padding: spacing.sm },
  tableHeaderCell: { fontWeight: '700' },
  tableTextLeft: { textAlign: 'left' },
  tableTextCenter: { textAlign: 'center' },
  tableTextRight: { textAlign: 'right' },
  cursor: { color: color.brand, fontSize: 16 },
})
