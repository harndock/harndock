import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatNumber, formatTime } from '@harndock/i18n-core'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import type { SessionProjection } from '../sync/projection'
import type { StoredCommandState } from '../sync/command-state'
import {
  buildConversationTimeline,
  type ConversationActivityItem,
  type ConversationTimelineItem,
  type TimelineEventItem,
} from '../features/conversation/timeline-model'
import { mobileTheme } from '../theme'
import { AppButton } from './AppButton'
import { EmptyState } from './EmptyState'
import { CopyButton, MarkdownText } from './MarkdownText'
import { commandStatusKey, resolveMessage, useI18n } from '../i18n'

export function EventTimeline({
  command,
  projection,
}: {
  readonly command?: StoredCommandState
  readonly projection: SessionProjection | undefined
}): React.JSX.Element {
  const { t } = useI18n()
  const scrollRef = useRef<FlatList<ConversationTimelineItem>>(null)
  const nearBottom = useRef(true)
  const initialScrollPending = useRef(true)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const sessionId = projection?.sessionId
  const [expandedActivities, setExpandedActivities] = useState<ExpandedActivityState>({ sessionId, keys: EMPTY_ACTIVITY_KEYS })
  const expandedActivityKeys = expandedActivities.sessionId === sessionId ? expandedActivities.keys : EMPTY_ACTIVITY_KEYS
  const items = useMemo(() => buildConversationTimeline(projection, command), [command, projection])

  const toggleActivity = useCallback((key: string): void => {
    setExpandedActivities(current => {
      const keys = new Set(current.sessionId === sessionId ? current.keys : EMPTY_ACTIVITY_KEYS)
      if (keys.has(key)) keys.delete(key)
      else keys.add(key)
      return { sessionId, keys }
    })
  }, [sessionId])

  useEffect(() => {
    nearBottom.current = true
    initialScrollPending.current = true
    setShowJumpToBottom(false)
  }, [projection?.sessionId])

  const scrollToBottom = (): void => {
    nearBottom.current = true
    setShowJumpToBottom(false)
    scrollRef.current?.scrollToEnd({ animated: true })
  }

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y
    const nextNearBottom = distance < 72
    nearBottom.current = nextNearBottom
    setShowJumpToBottom(current => current === !nextNearBottom ? current : !nextNearBottom)
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        extraData={expandedActivityKeys}
        initialNumToRender={18}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={item => item.key}
        ListEmptyComponent={projection === undefined
          ? <EmptyState description={t('conversation.emptyRestoringCopy')} title={t('conversation.emptyRestoringTitle')} />
          : (
              <EmptyState
                description={projection.historyLoaded ? t('conversation.emptyCopy') : t('conversation.emptyHistoryCopy')}
                title={projection.historyLoaded ? t('conversation.emptyTitle') : t('conversation.emptyHistoryTitle')}
              />
            )}
        onContentSizeChange={() => {
          if (nearBottom.current || initialScrollPending.current) {
            scrollRef.current?.scrollToEnd({ animated: false })
            initialScrollPending.current = false
          }
        }}
        onScroll={onScroll}
        ref={scrollRef}
        renderItem={({ item }) => (
          <TimelineEntry
            activityExpanded={item.kind === 'activity' && expandedActivityKeys.has(item.key)}
            item={item}
            onToggleActivity={toggleActivity}
          />
        )}
        scrollEventThrottle={32}
        windowSize={7}
      />
      {showJumpToBottom && (
        <AppButton
          accessibilityLabel={t('conversation.jumpBottomA11y')}
          label={t('conversation.jumpBottom')}
          onPress={scrollToBottom}
          style={styles.jumpButton}
          variant="secondary"
        />
      )}
    </View>
  )
}

function TimelineEntry({
  activityExpanded,
  item,
  onToggleActivity,
}: {
  readonly activityExpanded: boolean
  readonly item: ConversationTimelineItem
  readonly onToggleActivity: (key: string) => void
}): React.JSX.Element {
  const { locale, t } = useI18n()
  if (item.kind === 'message') {
    const meta = timelineMeta(item, locale, t)
    return (
      <View
        accessibilityLiveRegion={item.message.streaming ? 'polite' : 'none'}
        style={[styles.message, item.message.role === 'user' ? styles.userMessage : styles.assistantMessage]}
      >
        {item.message.role === 'assistant' && <Text style={styles.role}>Harness</Text>}
        {item.message.role === 'assistant'
          ? <MarkdownText streaming={item.message.streaming} text={item.message.text} />
          : <Text style={styles.messageText}>{item.message.text}</Text>}
        {item.message.role === 'assistant'
          ? (
              <View style={styles.messageFooter}>
                {!item.message.streaming && <CopyButton text={item.message.text} />}
                <Text style={[styles.meta, styles.footerMeta]}>{meta}{item.message.streaming ? ` · ${t('conversation.streaming')}` : ''}</Text>
              </View>
            )
          : <Text style={styles.meta}>{meta}</Text>}
      </View>
    )
  }
  return <ActivityEntry expanded={activityExpanded} item={item} onToggle={() => onToggleActivity(item.key)} />
}

function ActivityEntry({
  expanded,
  item,
  onToggle,
}: {
  readonly expanded: boolean
  readonly item: ConversationActivityItem
  readonly onToggle: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const summary = item.summaryMessage === undefined ? item.summary : resolveMessage(t, item.summaryMessage)
  return (
    <View style={styles.activityCard}>
      <Pressable
        accessibilityHint={t('conversation.activityHint')}
        accessibilityLabel={`${summary}，${expanded ? t('conversation.activityCollapse') : t('conversation.activityExpand')}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.activityHeader, pressed && styles.pressed]}
      >
        <View style={styles.activityIcon}><Text style={styles.activityIconText}>⌁</Text></View>
        <View style={styles.activityCopy}>
          <Text style={styles.activityTitle}>{summary}</Text>
          <Text style={styles.activityHint}>{expanded ? t('conversation.activitySafe') : t('conversation.activityDetails')}</Text>
        </View>
        <Text style={styles.disclosure}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      {expanded && (
        <View style={styles.activityDetails}>
          {item.events.map(event => <ActivityEventLine event={event} key={event.key} />)}
        </View>
      )}
    </View>
  )
}

function ActivityEventLine({ event }: { readonly event: TimelineEventItem }): React.JSX.Element {
  const { locale, t } = useI18n()
  const title = event.titleMessage === undefined ? event.title : resolveMessage(t, event.titleMessage)
  const summary = event.commandStatus === undefined
    ? event.summaryMessage === undefined ? event.summary : resolveMessage(t, event.summaryMessage)
    : t('timeline.command.status', { status: t(commandStatusKey(event.commandStatus)) })
  const detail = event.detailMessage === undefined ? event.detail : resolveMessage(t, event.detailMessage)
  const meta = timelineMeta(event, locale, t)
  return (
    <View style={styles.activityEventLine}>
      <View style={[styles.eventIcon, styles[`${event.kind}Icon`]]}>
        <Text style={styles.eventIconText}>{eventSymbol(event.kind)}</Text>
      </View>
      <View style={styles.eventCopy}>
        <Text style={styles.eventTitle}>{title}</Text>
        <Text style={styles.eventSummary}>{summary}</Text>
        <Text style={styles.eventSummary}>{detail}</Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
    </View>
  )
}

function timelineMeta(
  item: TimelineEventItem | Extract<ConversationTimelineItem, { kind: 'message' }>,
  locale: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const sequence = item.kind === 'message' ? item.sequence : item.sequence
  if (item.timestamp !== undefined && Number.isFinite(item.timestamp) && item.timestamp > 0 && sequence !== undefined) {
    return t('timeline.meta.timeSeq', {
      seq: formatNumber(sequence, locale),
      time: formatTime(item.timestamp, locale),
    })
  }
  if (item.kind !== 'message' && item.baseSeq !== undefined) {
    return t('timeline.meta.baseSeq', { seq: formatNumber(item.baseSeq, locale) })
  }
  return t('timeline.time.unknown')
}

function eventSymbol(kind: TimelineEventItem['kind']): string {
  if (kind === 'tool') return '⌘'
  if (kind === 'approval') return '!'
  if (kind === 'command') return '↑'
  if (kind === 'status') return '•'
  return '?'
}

const { color, radius, spacing, typography } = mobileTheme
const EMPTY_ACTIVITY_KEYS: ReadonlySet<string> = new Set()
interface ExpandedActivityState { readonly sessionId: string | undefined; readonly keys: ReadonlySet<string> }
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, position: 'relative' },
  content: { flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xxl + mobileTheme.touchTarget, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  message: { gap: spacing.xs, maxWidth: '94%' },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: color.brandSoft,
    borderBottomRightRadius: radius.sm,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  assistantMessage: { alignSelf: 'flex-start', backgroundColor: color.surface, borderColor: color.border, borderRadius: radius.lg, borderTopLeftRadius: radius.sm, borderWidth: 1, maxWidth: '100%', padding: spacing.md },
  role: { color: color.text, fontSize: typography.caption, fontWeight: '700' },
  messageText: { color: color.text, fontSize: typography.body, lineHeight: 21 },
  messageFooter: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  footerMeta: { flexShrink: 1, marginTop: 0 },
  activityCard: { alignSelf: 'stretch', backgroundColor: color.surface, borderColor: color.border, borderRadius: radius.lg, borderWidth: 1, elevation: 1, overflow: 'hidden', shadowColor: color.text, shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.04, shadowRadius: 8 },
  activityHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 60, padding: spacing.sm },
  activityIcon: { alignItems: 'center', backgroundColor: color.brandSoft, borderRadius: radius.sm, height: 34, justifyContent: 'center', width: 34 },
  activityIconText: { color: color.brand, fontSize: 19, fontWeight: '800' },
  activityCopy: { flex: 1, gap: 2, minWidth: 0 },
  activityTitle: { color: color.text, fontSize: 13, fontWeight: '700' },
  activityHint: { color: color.textTertiary, fontSize: 11 },
  activityDetails: { borderTopColor: color.border, borderTopWidth: 1, gap: spacing.sm, padding: spacing.sm },
  activityEventLine: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  meta: { color: color.textTertiary, fontSize: typography.caption, marginTop: spacing.xxs },
  pressed: { backgroundColor: color.surface },
  eventIcon: { alignItems: 'center', borderRadius: radius.sm, height: 36, justifyContent: 'center', width: 36 },
  toolIcon: { backgroundColor: color.brandSoft },
  approvalIcon: { backgroundColor: color.warningSoft },
  commandIcon: { backgroundColor: color.brandSoft },
  statusIcon: { backgroundColor: color.positiveSoft },
  unknownIcon: { backgroundColor: color.surface },
  eventIconText: { color: color.textSecondary, fontSize: 16, fontWeight: '800' },
  eventCopy: { flex: 1, gap: 3, minWidth: 0 },
  eventTitle: { color: color.text, fontSize: 14, fontWeight: '700' },
  eventSummary: { color: color.textSecondary, fontSize: 13, lineHeight: 18 },
  disclosure: { color: color.textSecondary, fontSize: 18, width: 20 },
  jumpButton: { alignSelf: 'center', bottom: spacing.sm, position: 'absolute' },
})
