import { StyleSheet, View } from 'react-native'
import { mobileTheme } from '../theme'

export type StatusTone = 'online' | 'offline' | 'warning' | 'danger'

export interface StatusDotProps {
  readonly label: string
  readonly tone: StatusTone
}

export function StatusDot({ label, tone }: StatusDotProps): React.JSX.Element {
  return <View accessibilityLabel={label} accessibilityRole="text" style={[styles.dot, styles[tone]]} />
}

const styles = StyleSheet.create({
  dot: { borderRadius: 5, height: 10, width: 10 },
  online: { backgroundColor: mobileTheme.color.positive },
  offline: { backgroundColor: mobileTheme.color.textTertiary },
  warning: { backgroundColor: mobileTheme.color.warning },
  danger: { backgroundColor: mobileTheme.color.danger },
})
