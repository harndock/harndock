import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { mobileTheme } from '../theme'

export interface CardProps {
  readonly children: ReactNode
  readonly style?: StyleProp<ViewStyle>
  readonly tone?: 'default' | 'warning'
}

export function Card({ children, style, tone = 'default' }: CardProps): React.JSX.Element {
  return <View style={[styles.base, tone === 'warning' && styles.warning, style]}>{children}</View>
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: mobileTheme.color.surface,
    borderColor: mobileTheme.color.border,
    borderRadius: mobileTheme.radius.lg,
    borderWidth: 1,
    elevation: 1,
    padding: mobileTheme.spacing.lg,
    shadowColor: mobileTheme.color.text,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  warning: { backgroundColor: mobileTheme.color.warningSoft, borderColor: '#e2b45a' },
})
