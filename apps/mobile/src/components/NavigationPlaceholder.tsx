import { StyleSheet, Text, View } from 'react-native'
import { mobileTheme } from '../theme'
import { useI18n } from '../i18n'

export type PrimaryDestination = 'sessions' | 'settings'

export interface NavigationPlaceholderProps {
  readonly active: PrimaryDestination
}

export function NavigationPlaceholder({ active }: NavigationPlaceholderProps): React.JSX.Element {
  const { t } = useI18n()
  return (
    <View accessibilityLabel={t('nav.placeholder')} style={styles.container}>
      <Text style={[styles.item, active === 'sessions' && styles.active]}>Sessions</Text>
      <Text style={[styles.item, active === 'settings' && styles.active]}>{t('nav.settingsLabel')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: mobileTheme.spacing.xs },
  item: { color: mobileTheme.color.textTertiary, fontSize: mobileTheme.typography.caption, fontWeight: '600' },
  active: { color: mobileTheme.color.brand },
})
