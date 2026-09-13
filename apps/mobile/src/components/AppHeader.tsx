import type { ReactNode } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { mobileTheme } from '../theme'

export interface AppHeaderProps {
  readonly title: string
  readonly subtitle?: string
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
}

export function AppHeader({ leading, subtitle, title, trailing }: AppHeaderProps): React.JSX.Element {
  return (
    <View style={styles.header}>
      {leading !== undefined ? <View>{leading}</View> : <Image accessibilityLabel="Harndock" source={require('../../assets/harndock-logo-indigo-light.png')} style={styles.mark} />}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle !== undefined && <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {trailing !== undefined && <View>{trailing}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', flexDirection: 'row', gap: mobileTheme.spacing.sm, minHeight: 58 },
  mark: { backgroundColor: mobileTheme.color.surfaceMuted, borderRadius: 12, height: 38, width: 38 },
  copy: { flex: 1 },
  title: { color: mobileTheme.color.text, fontSize: mobileTheme.typography.heading, fontWeight: '800', letterSpacing: 0 },
  subtitle: { color: mobileTheme.color.textSecondary, fontSize: mobileTheme.typography.caption, marginTop: 2 },
})
