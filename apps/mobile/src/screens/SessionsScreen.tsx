import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native'
import type { RootStackParamList } from '../app/navigation/routes'
import {
  AppHeader,
  AppButton,
  Banner,
  EmptyState,
  PcConnectionStrip,
  SessionRow,
  IconButton,
} from '../components'
import { useAuthGate } from '../features/auth/AuthGateProvider'
import { useSharedSessionDirectory } from '../features/sessions/SessionDirectoryProvider'
import { groupSessionDirectory, pcConnectionSummary } from '../features/sessions/directory-model'
import { accountInitials } from '../features/settings/settings-model'
import { connectionStateNoticeKey } from '../features/sessions/presentation'
import { screenStyles as styles } from '../theme/screen-styles'
import { resolveMessage, useI18n } from '../i18n'

type SessionsScreenProps = NativeStackScreenProps<RootStackParamList, 'Sessions'>

export function SessionsScreen({ navigation, route }: SessionsScreenProps): React.JSX.Element {
  const auth = useAuthGate()
  const { t } = useI18n()
  const directory = useSharedSessionDirectory()
  const connectionNoticeKey = connectionStateNoticeKey(directory.connectionState)
  const sections = groupSessionDirectory(directory.sessions)
  const pcSummary = pcConnectionSummary(
    directory.devices,
    directory.runtimes,
    directory.connectionState,
  )
  const syncMessageKey = directory.syncMessageDescriptor?.key
  const syncTone = syncMessageKey === 'sessions.sync.recovered'
    ? 'success'
    : syncMessageKey === 'sessions.sync.replaying'
      ? 'info'
      : 'warning'
  const syncRetryAvailable = directory.syncMessage.length > 0
    && syncMessageKey !== 'sessions.sync.replaying'
    && syncMessageKey !== 'sessions.sync.recovered'
  const syncRetryAction = (
    <AppButton
      disabled={directory.syncRetrying}
      label={directory.syncRetrying ? t('sessions.refreshing') : t('sessions.refreshSync')}
      loading={directory.syncRetrying}
      onPress={directory.retrySync}
      style={styles.bannerAction}
      variant="secondary"
    />
  )
  const openSession = (sessionId: string): void => {
    navigation.navigate('Session', { gatewayUrl: route.params.gatewayUrl, sessionId })
  }
  const initials = auth.state.status === 'authenticated' ? accountInitials(auth.state) : '··'

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.sessionsContainer}>
        <AppHeader
          subtitle={t('sessions.subtitle')}
          title="Harndock Mobile"
          trailing={(
            <IconButton
              accessibilityLabel={t('sessions.openSettings')}
              icon={<Text style={styles.accountIcon}>{initials}</Text>}
              onPress={() => navigation.navigate('Settings', {})}
            />
          )}
        />
        <PcConnectionStrip summary={pcSummary} />
        {connectionNoticeKey !== undefined && (
          <Banner action={syncRetryAction} tone="warning">
            {t(connectionNoticeKey)}
          </Banner>
        )}
        {directory.syncMessage.length > 0 && (
          <Banner action={syncRetryAvailable ? syncRetryAction : undefined} tone={syncTone}>
            {directory.syncMessageDescriptor === undefined
              ? directory.syncMessage
              : resolveMessage(t, directory.syncMessageDescriptor)}
          </Banner>
        )}
        {directory.inventoryMessage.length > 0 && (
          <Banner
            action={(
              <AppButton
                disabled={directory.inventoryRetrying}
                label={directory.inventoryRetrying ? t('sessions.retrying') : t('sessions.retryPcStatus')}
                loading={directory.inventoryRetrying}
                onPress={directory.retryInventory}
                style={styles.bannerAction}
                variant="secondary"
              />
            )}
            tone="warning"
          >
            {directory.inventoryMessageDescriptor === undefined
              ? directory.inventoryMessage
              : resolveMessage(t, directory.inventoryMessageDescriptor)}
          </Banner>
        )}
        <ScrollView contentContainerStyle={styles.sessionList} style={styles.sessionScroll}>
          {!directory.ready && directory.sessions.length === 0 && (
            <View style={styles.directoryLoading}>
              <ActivityIndicator />
              <Text style={styles.message}>{t('sessions.loading')}</Text>
            </View>
          )}
          {sections.attention.length > 0 && (
            <View style={styles.directorySection}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>{t('sessions.attention')}</Text>
                <Text style={styles.sectionCount}>{sections.attention.length}</Text>
              </View>
              <View style={styles.sessionGroup}>
                {sections.attention.map(session => (
                  <SessionRow
                    key={session.sessionId}
                    onPress={() => openSession(session.sessionId)}
                    session={session}
                  />
                ))}
              </View>
            </View>
          )}
          {directory.ready && (
            <View style={styles.directorySection}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>{t('sessions.recent')}</Text>
                <Text style={styles.sectionCount}>{sections.recent.length}</Text>
              </View>
              {sections.recent.length === 0
                ? sections.attention.length === 0 && (
                  <EmptyState
                    description={t('sessions.emptyCopy')}
                    title={t('sessions.emptyTitle')}
                  />
                )
                : (
                  <View style={styles.sessionGroup}>
                    {sections.recent.map(session => (
                      <SessionRow
                        key={session.sessionId}
                        onPress={() => openSession(session.sessionId)}
                        session={session}
                      />
                    ))}
                  </View>
                )}
            </View>
          )}
          {directory.ready && (
            <View style={styles.directoryFooter}>
              <AppButton
                disabled={directory.syncRetrying}
                label={directory.syncRetrying ? t('sessions.refreshing') : t('sessions.refreshSync')}
                onPress={directory.retrySync}
                variant="secondary"
              />
              <Text style={styles.directoryFootnote}>{t('sessions.footer')}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}
