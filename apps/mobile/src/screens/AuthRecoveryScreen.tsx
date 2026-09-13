import { SafeAreaView, View } from 'react-native'
import { AppButton, AppHeader, Banner } from '../components'
import { screenStyles as styles } from '../theme/screen-styles'
import { useI18n } from '../i18n'

export function AuthRecoveryScreen({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <AppHeader title={t('auth.recoveryTitle')} subtitle={t('auth.recoverySubtitle')} />
        <Banner tone="warning">{message}</Banner>
        <AppButton label={t('auth.retryRecovery')} onPress={onRetry} />
      </View>
    </SafeAreaView>
  )
}
