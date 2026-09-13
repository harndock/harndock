import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SafeAreaView, ScrollView, Text, View } from 'react-native'
import type { RootStackParamList } from '../app/navigation/routes'
import { AppButton, AppHeader, Banner, IconButton, StatusDot } from '../components'
import { useAuthGate } from '../features/auth/AuthGateProvider'
import { useSharedSessionDirectory } from '../features/sessions/SessionDirectoryProvider'
import { mobileSettingsSummary, type SettingsSummaryRow } from '../features/settings/settings-model'
import { screenStyles as styles } from '../theme/screen-styles'
import { LanguageSelect, resolveMessage, useI18n } from '../i18n'

type SettingsScreenProps = NativeStackScreenProps<RootStackParamList, 'Settings'>

export function SettingsScreen({ navigation, route }: SettingsScreenProps): React.JSX.Element {
  const auth = useAuthGate()
  const directory = useSharedSessionDirectory()
  const { t } = useI18n()
  if (auth.state.status !== 'authenticated') return <SafeAreaView style={styles.safeArea} />

  const summary = mobileSettingsSummary(auth.state, directory, route.params?.currentSessionId)
  const retrying = directory.syncRetrying || directory.inventoryRetrying
  const retryDiagnostics = (): void => {
    directory.retrySync()
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsScreen}>
        <AppHeader
          leading={(
            <IconButton
              accessibilityLabel={t('nav.back')}
              icon={<Text style={styles.backIcon}>‹</Text>}
              onPress={navigation.goBack}
            />
          )}
          subtitle={t('settings.subtitle')}
          title={t('nav.settings')}
        />
        <LanguageSelect />
        <ScrollView contentContainerStyle={styles.settingsContent} keyboardShouldPersistTaps="handled">
          <SettingsSection title={t('settings.account')}>
            <SettingsRow row={summary.account} />
            <SettingsRow row={summary.device} />
            <SettingsRow row={summary.scopes} />
          </SettingsSection>

          <SettingsSection title={t('settings.diagnostics')}>
            <SettingsRow row={summary.gateway} />
            <SettingsRow row={summary.runtime} />
            <SettingsRow row={summary.stream} />
            <SettingsRow row={summary.cursor} />
          </SettingsSection>

          {summary.hasDiagnosticIssue && (
            <Banner tone="warning">{t('settings.issue')}</Banner>
          )}
          <AppButton
            disabled={retrying}
            label={retrying ? t('settings.retrying') : t('settings.refresh')}
            loading={retrying}
            onPress={retryDiagnostics}
            variant="secondary"
          />

          <SettingsSection title={t('settings.privacy')}>
            <SettingsRow row={{
              detail: t('settings.localDataDetail'),
              label: t('settings.localDataLabel'),
              tone: 'default',
              value: t('settings.localDataValue'),
            }} />
            <SettingsRow row={{
              detail: t('settings.gatewayDetail'),
              label: t('settings.gatewayLabel'),
              tone: 'default',
              value: t('settings.gatewayValue'),
            }} />
          </SettingsSection>

          <AppButton label={t('common.logout')} onPress={auth.logout} variant="danger" />
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

function SettingsSection({ children, title }: { readonly children: React.ReactNode; readonly title: string }): React.JSX.Element {
  return (
    <View style={styles.settingsSection}>
      <Text style={styles.settingsSectionTitle}>{title}</Text>
      <View style={styles.settingsGroup}>{children}</View>
    </View>
  )
}

function SettingsRow({ row }: { readonly row: SettingsSummaryRow }): React.JSX.Element {
  const { t } = useI18n()
  const label = row.labelMessage === undefined ? row.label : resolveMessage(t, row.labelMessage)
  const value = row.valueMessage === undefined ? row.value : resolveMessage(t, row.valueMessage)
  const detail = row.detailMessage === undefined
    ? row.detail
    : resolveMessage(t, row.detailMessage)
  const tone = row.tone === 'default' ? undefined : row.tone
  return (
    <View
      accessible
      accessibilityLabel={`${row.label}${label === row.label ? '' : ` (${label})`}: ${value}${detail === undefined ? '' : `. ${detail}`}`}
      accessibilityRole="text"
      style={styles.settingsRow}
    >
      <View style={styles.settingsRowCopy}>
        <Text style={styles.settingsLabel}>{label}</Text>
        <Text selectable style={styles.settingsValue}>{value}</Text>
        {detail !== undefined && <Text style={styles.settingsDetail}>{detail}</Text>}
      </View>
      {tone !== undefined && <StatusDot label={value} tone={tone} />}
    </View>
  )
}
