import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SessionProjection } from '../sync/projection'
import { mobileTheme } from '../theme'
import {
  sessionActivityMessage,
  sessionDirectorySummaryMessage,
} from '../features/sessions/directory-model'
import { StatusDot } from './StatusDot'
import { resolveMessage, sessionStatusKey, useI18n } from '../i18n'

export interface SessionRowProps {
  readonly session: SessionProjection
  readonly onPress: () => void
  readonly active?: boolean
  readonly compact?: boolean
}

export function SessionRow({ active = false, compact = false, onPress, session }: SessionRowProps): React.JSX.Element {
  const { t } = useI18n()
  const awaitingApproval = session.unresolvedApproval !== null || session.status === 'waiting'
  const tone = session.status === 'offline' ? 'offline' : awaitingApproval ? 'warning' : 'online'
  const statusLabel = t(sessionStatusKey(session.status))
  const summary = resolveMessage(t, sessionDirectorySummaryMessage(session))
  const activity = resolveMessage(t, sessionActivityMessage(session.lastActivityAt))
  return (
    <Pressable
      accessibilityHint={t('session.accessibility.openConversation')}
      accessibilityLabel={`${session.title}，${statusLabel}，${summary}`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        compact && styles.compact,
        active && styles.active,
        pressed && styles.pressed,
      ]}
    >
      <StatusDot label={statusLabel} tone={tone} />
      <View style={styles.copy}>
        <View style={styles.heading}>
          <Text numberOfLines={1} style={styles.title}>{session.title}</Text>
          {awaitingApproval && <Text style={styles.badge}>{t('session.badge.attention')}</Text>}
        </View>
        <Text numberOfLines={compact ? 1 : 2} style={styles.summary}>{summary}</Text>
        <Text numberOfLines={1} style={styles.meta}>
          {[session.cwdLabel, activity].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.chevron}>›</Text>
    </Pressable>
  )
}

const { color, radius, spacing, typography } = mobileTheme
const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderBottomColor: color.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 92,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  compact: { minHeight: 78, paddingHorizontal: spacing.sm },
  active: { backgroundColor: color.surfaceAccent, borderBottomColor: '#b8caf3' },
  pressed: { backgroundColor: color.surfaceMuted, transform: [{ scale: 0.995 }] },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  heading: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  title: { color: color.text, flex: 1, fontSize: typography.subheading, fontWeight: '700' },
  summary: { color: color.textSecondary, fontSize: 14, lineHeight: 19 },
  meta: { color: color.textTertiary, fontSize: typography.caption },
  badge: {
    backgroundColor: color.warningSoft,
    borderRadius: radius.sm,
    color: color.warning,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  chevron: { color: color.textTertiary, fontSize: 24, width: 16 },
})
