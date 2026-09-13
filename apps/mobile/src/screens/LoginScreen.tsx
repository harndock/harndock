import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native'
import { AppButton, AppHeader, Banner, Card } from '../components'
import { useAuthGate } from '../features/auth/AuthGateProvider'
import { manualTokenEntryEnabled } from '../features/auth/debug-token'
import { useAdministratorLogin } from '../features/auth/useAdministratorLogin'
import { useConnectionSetup } from '../features/connection/useConnectionSetup'
import { screenStyles as styles } from '../theme/screen-styles'
import { LanguageSelect, useI18n } from '../i18n'

export function LoginScreen(): React.JSX.Element {
  const auth = useAuthGate()
  const { t } = useI18n()
  const login = useAdministratorLogin()
  const disabled = login.restoring || login.busy

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safeArea}
      >
        <ScrollView
          contentContainerStyle={styles.loginContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.loginHero}>
            <AppHeader title="Harndock Mobile" subtitle="Harndock companion" />
            <LanguageSelect />
            <Text style={styles.loginTitle}>{t('login.title')}</Text>
            <Text style={styles.message}>{t('login.copy')}</Text>
          </View>
          <View style={styles.loginForm}>
            <Text style={styles.fieldLabel}>{t('login.gatewayOrigin')}</Text>
            <TextInput
              accessibilityLabel="Gateway origin"
              autoCapitalize="none"
              autoComplete="url"
              autoCorrect={false}
              editable={!disabled}
              onChangeText={login.setGatewayOrigin}
              placeholder="https://sync.example.test"
              returnKeyType="next"
              style={styles.input}
              testID="login-gateway-origin"
              value={login.gatewayOrigin}
            />
            <Text style={styles.fieldLabel}>{t('login.account')}</Text>
            <TextInput
              accessibilityLabel={t('login.account')}
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect={false}
              editable={!disabled}
              onChangeText={login.setUsername}
              placeholder="admin"
              returnKeyType="next"
              style={styles.input}
              testID="login-username"
              textContentType="username"
              value={login.username}
            />
            <Text style={styles.fieldLabel}>{t('login.password')}</Text>
            <TextInput
              accessibilityLabel={t('login.adminPassword')}
              autoCapitalize="none"
              autoComplete="current-password"
              editable={!disabled}
              onChangeText={login.setPassword}
              onSubmitEditing={() => { void submit() }}
              placeholder={t('login.passwordPlaceholder')}
              returnKeyType="go"
              secureTextEntry
              style={styles.input}
              testID="login-password"
              textContentType="password"
              value={login.password}
            />
            <AppButton
              disabled={disabled}
              label={login.busy ? t('login.signingIn') : login.restoring ? t('login.restoring') : t('login.submit')}
              loading={login.busy || login.restoring}
              onPress={submit}
              testID="login-submit"
            />
            <Banner tone={login.messageTone}>{login.message}</Banner>
          </View>
          <Text style={styles.loginFootnote}>
            {t('login.noRegistration')}
          </Text>
          {manualTokenEntryEnabled && <DevelopmentTokenForm />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )

  async function submit(): Promise<void> {
    const session = await login.submit()
    if (session !== undefined) auth.activateSession(session)
  }
}

function DevelopmentTokenForm(): React.JSX.Element {
  const auth = useAuthGate()
  const connection = useConnectionSetup()
  const { t } = useI18n()
  return (
    <Card style={styles.debugCard} tone="warning">
      <Text style={styles.sectionTitle}>{t('login.devTokenTitle')}</Text>
      <Text style={styles.message}>{t('login.devTokenCopy')}</Text>
      <TextInput
        accessibilityLabel={`${t('login.gatewayOrigin')} (development)`}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!connection.restoring}
        onChangeText={connection.setGatewayUrl}
        placeholder="Gateway origin"
        style={styles.input}
        value={connection.gatewayUrl}
      />
      <TextInput
        accessibilityLabel="Development access token"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!connection.restoring}
        onChangeText={connection.setAccessToken}
        placeholder={t('login.devTokenPlaceholder')}
        secureTextEntry
        style={styles.input}
        value={connection.accessToken}
      />
      <AppButton
        disabled={connection.restoring}
        label={t('login.useDevToken')}
        loading={connection.restoring}
        onPress={async () => {
          const gatewayOrigin = await connection.connect()
          if (gatewayOrigin !== undefined) auth.activateDevelopmentSession(gatewayOrigin)
        }}
        variant="secondary"
      />
      <Banner>{connection.message}</Banner>
    </Card>
  )
}
