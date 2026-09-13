import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { mobileTheme } from '../theme'

export type BannerTone = 'info' | 'warning' | 'danger' | 'success'

export interface BannerProps {
  readonly children: ReactNode
  readonly tone?: BannerTone
  readonly action?: ReactNode
}

export function Banner({ action, children, tone = 'info' }: BannerProps): React.JSX.Element {
  return (
    <View accessibilityLiveRegion="polite" style={[styles.base, styles[`${tone}Container`]]}>
      <Text style={[styles.copy, styles[`${tone}Copy`]]}>{children}</Text>
      {action !== undefined && <View style={styles.action}>{action}</View>}
    </View>
  )
}

const { color, radius, spacing } = mobileTheme
const styles = StyleSheet.create({
  base: { borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  action: { alignItems: 'flex-start' },
  copy: { fontSize: 14, lineHeight: 21 },
  infoContainer: { backgroundColor: color.brandSoft, borderColor: '#b8caf3' },
  warningContainer: { backgroundColor: color.warningSoft, borderColor: '#e2b45a' },
  dangerContainer: { backgroundColor: color.dangerSoft, borderColor: '#efb3ad' },
  successContainer: { backgroundColor: color.positiveSoft, borderColor: '#9bd3b4' },
  infoCopy: { color: color.textSecondary },
  warningCopy: { color: color.warning },
  dangerCopy: { color: color.danger },
  successCopy: { color: color.positive },
})
