import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useState } from 'react'
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native'
import { SafeAreaView as NativeSafeAreaView } from 'react-native-safe-area-context'
import type { RootStackParamList } from '../app/navigation/routes'
import { AppHeader, ApprovalPanel, Banner, ConversationComposer, EventTimeline, IconButton, SessionDrawer, StatusDot } from '../components'
import { useAuthGate } from '../features/auth/AuthGateProvider'
import { useConversationSession } from '../features/conversation/useConversationSession'
import { useSessionDrawer } from '../features/sessions/useSessionDrawer'
import { screenStyles as styles } from '../theme/screen-styles'
import { sessionStatusKey, translateLegacyNotice, useI18n } from '../i18n'

type SessionScreenProps = NativeStackScreenProps<RootStackParamList, 'Session'>
// Expo SDK 52 stays on React 18 while this dependency exposes React 19 declarations.
const SafeAreaView = NativeSafeAreaView as unknown as React.ComponentType<any>

export function SessionScreen({ navigation, route }: SessionScreenProps): React.JSX.Element {
  const auth = useAuthGate()
  const { t } = useI18n()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const requireAuthentication = useCallback(
    (error?: unknown) => auth.handleAuthenticationFailure(error),
    [auth.handleAuthenticationFailure],
  )
  const session = useConversationSession(route.params.sessionId, route.params.gatewayUrl, requireAuthentication)
  const { projection } = session
  const approval = projection?.unresolvedApproval
  const storedSessions = useSessionDrawer(drawerOpen)
  const drawerSessions = projection !== undefined && !storedSessions.some(item => item.sessionId === projection.sessionId)
    ? [projection, ...storedSessions]
    : storedSessions

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.conversationScreen}
      >
        <View style={styles.conversationScreen}>
          <View style={styles.conversationHeader}>
            <AppHeader
              leading={(
                <IconButton
                  accessibilityLabel={t('conversation.openSessions')}
                  icon={<Text style={styles.menuIcon}>☰</Text>}
                  onPress={() => setDrawerOpen(true)}
                />
              )}
              subtitle={t('conversation.header')}
              title={projection?.title ?? t('conversation.session')}
              trailing={(
                <IconButton
                  accessibilityLabel={t('conversation.openSettings')}
                  icon={<Text style={styles.settingsIcon}>⚙</Text>}
                  onPress={() => navigation.navigate('Settings', { currentSessionId: route.params.sessionId })}
                />
              )}
            />
            <View style={styles.statusLine}>
              <StatusDot
                label={projection === undefined ? t('common.loading') : t(sessionStatusKey(projection.status))}
                tone={projection?.status === 'offline' ? 'offline' : projection?.status === 'waiting' ? 'warning' : 'online'}
              />
              <Text style={styles.message}>
                {projection === undefined
                  ? t('common.loading')
                  : `${t(sessionStatusKey(projection.status))} · ${projection.historyLoaded ? t('conversation.historySynced') : t('conversation.historyReplaying')}`}
              </Text>
            </View>
            {projection?.status === 'offline' && (
              <Banner tone="warning">{t('conversation.offlineBanner')}</Banner>
            )}
            {projection !== undefined && !projection.historyLoaded && (
              <Banner>{t('conversation.replayingBanner')}</Banner>
            )}
          </View>
          <EventTimeline command={session.command} projection={projection} />
          {session.message.length > 0 && <Banner>{translateLegacyNotice(t, session.message)}</Banner>}
          {approval != null && projection != null
            ? (
                <ApprovalPanel
                  approvalId={approval.approvalId}
                  attempt={session.approvalAttempt}
                  canRetry={session.canRetry}
                  command={session.command}
                  disabled={session.busy || session.controlsUnavailable}
                  historyLoaded={projection.historyLoaded}
                  lastSeq={projection.lastSeq}
                  onRespond={session.respondToApproval}
                  onRetry={session.retry}
                  operation={session.operation}
                  projectionStatus={projection.status}
                  submitting={session.busy}
                  toolName={approval.toolName}
                />
              )
            : (
                <ConversationComposer
                  busy={session.busy}
                  canRetry={session.canRetry}
                  command={session.command}
                  commandAcknowledged={session.commandAcknowledged}
                  historyLoaded={projection?.historyLoaded ?? false}
                  lastSeq={projection?.lastSeq ?? -1}
                  onCancel={session.cancel}
                  onChange={session.setPrompt}
                  onDismissStatus={session.dismissCommandStatus}
                  onRetry={session.retry}
                  onSubmit={session.submitPrompt}
                  operation={session.operation}
                  projectionStatus={projection?.status}
                  value={session.prompt}
                />
              )}
        </View>
      </KeyboardAvoidingView>
      <SessionDrawer
        activeSessionId={route.params.sessionId}
        onDismiss={() => setDrawerOpen(false)}
        onOpenDirectory={() => {
          setDrawerOpen(false)
          navigation.navigate('Sessions', { gatewayUrl: route.params.gatewayUrl })
        }}
        onSelectSession={selected => {
          setDrawerOpen(false)
          if (selected.sessionId === route.params.sessionId) return
          navigation.replace('Session', {
            gatewayUrl: route.params.gatewayUrl,
            sessionId: selected.sessionId,
          })
        }}
        open={drawerOpen}
        sessions={drawerSessions}
      />
    </SafeAreaView>
  )
}
