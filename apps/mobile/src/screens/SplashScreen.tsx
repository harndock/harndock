import { ActivityIndicator, SafeAreaView, Text, View } from 'react-native'
import { AppHeader } from '../components'
import { screenStyles as styles } from '../theme/screen-styles'
import { useI18n } from '../i18n'

export function SplashScreen({ message }: { readonly message: string }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <AppHeader title="Harndock Mobile" subtitle={t('splash.subtitle')} />
        <ActivityIndicator />
        <Text style={styles.message}>{message}</Text>
      </View>
    </SafeAreaView>
  )
}
