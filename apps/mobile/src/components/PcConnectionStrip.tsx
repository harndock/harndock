import { StyleSheet, Text, View } from 'react-native'
import type { PcConnectionSummary } from '../features/sessions/directory-model'
import { mobileTheme } from '../theme'
import { StatusDot } from './StatusDot'
import { resolveMessage, useI18n } from '../i18n'

export function PcConnectionStrip({ summary }: { readonly summary: PcConnectionSummary }): React.JSX.Element {
  const { t } = useI18n()
  const title = summary.titleMessage === undefined ? summary.title : resolveMessage(t, summary.titleMessage)
  const detail = summary.detailMessage === undefined ? summary.detail : resolveMessage(t, summary.detailMessage)
  return (
    <View accessibilityLabel={`${title}，${detail}`} style={styles.container}>
      <View style={styles.icon}><Text style={styles.iconText}>⌁</Text></View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <Text numberOfLines={2} style={styles.detail}>{detail}</Text>
      </View>
      <StatusDot label={title} tone={summary.tone} />
    </View>
  )
}

const { color, radius, spacing, typography } = mobileTheme
const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.border,
    borderRadius: radius.md,
    borderWidth: 1,
    elevation: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: color.brandSoft,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconText: { color: color.brand, fontSize: 22, fontWeight: '700' },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  title: { color: color.text, fontSize: typography.body, fontWeight: '700' },
  detail: { color: color.textSecondary, fontSize: typography.caption, lineHeight: 17 },
})
