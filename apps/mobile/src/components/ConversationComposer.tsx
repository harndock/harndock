import type { SessionStatus } from '@harndock/sync-protocol'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { StoredCommandState } from '../sync/command-state'
import {
  composerViewState,
  type CommandOperationState,
} from '../features/conversation/composer-model'
import { mobileTheme } from '../theme'
import { AppButton } from './AppButton'
import { IconButton } from './IconButton'
import { StatusDot } from './StatusDot'
import { translateLegacyNotice, useI18n, type MobileMessageKey } from '../i18n'

export interface ConversationComposerProps {
  readonly value: string
  readonly projectionStatus?: SessionStatus
  readonly historyLoaded: boolean
  readonly lastSeq: number
  readonly busy: boolean
  readonly command?: StoredCommandState
  readonly commandAcknowledged: boolean
  readonly operation: CommandOperationState
  readonly canRetry: boolean
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void | Promise<void>
  readonly onCancel: () => void | Promise<void>
  readonly onRetry: () => void | Promise<void>
  readonly onDismissStatus: () => void
}

export function ConversationComposer(props: ConversationComposerProps): React.JSX.Element {
  const { t } = useI18n()
  // Legacy accessibility contract: accessibilityLabel="向 PC Harness 发送消息"
  const insets = useSafeAreaInsets()
  const state = composerViewState({
    busy: props.busy,
    canRetry: props.canRetry,
    command: props.command,
    commandAcknowledged: props.commandAcknowledged,
    historyLoaded: props.historyLoaded,
    lastSeq: props.lastSeq,
    operation: props.operation,
    projectionStatus: props.projectionStatus,
    prompt: props.value,
  })
  const stateTitle = t(COMPOSER_STATE_KEYS[state.mode])
  const stateDetail = translateLegacyNotice(t, state.detail)
  const pending = state.mode === 'submitting' || state.mode === 'stopping'
  const taskActive = state.mode === 'submitting' || state.mode === 'queued' || state.mode === 'executing' || state.mode === 'stopping'

  return (
    <View
      accessibilityLabel={`${stateTitle}。${stateDetail}`}
      style={[styles.container, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
    >
      <View style={styles.statusRow}>
        {pending
          ? <ActivityIndicator size="small" />
          : <StatusDot label={stateTitle} tone={state.tone} />}
        <View style={styles.statusCopy}>
          <Text accessibilityLiveRegion="polite" style={styles.statusTitle}>{stateTitle}</Text>
          <Text numberOfLines={2} style={styles.statusDetail}>{stateDetail}</Text>
        </View>
        {state.retryLabel !== undefined && (
          <AppButton
            disabled={!state.retryEnabled}
            label={state.retryLabel}
            loading={pending}
            onPress={props.onRetry}
            style={styles.statusAction}
            variant="secondary"
          />
        )}
        {state.dismissEnabled && (
          <IconButton
            accessibilityLabel={t('composer.dismiss')}
            icon={<Text style={styles.dismissIcon}>×</Text>}
            onPress={props.onDismissStatus}
          />
        )}
      </View>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel={t('composer.inputA11y')}
          editable={state.inputEnabled}
          maxLength={8_000}
          multiline
          onChangeText={props.onChange}
          placeholder={state.inputEnabled ? t('composer.inputPlaceholder') : stateTitle}
          returnKeyType="default"
          style={styles.input}
          textAlignVertical="top"
          value={props.value}
        />
        <View style={styles.actions}>
          {taskActive ? (
            <IconButton
              accessibilityLabel={state.mode === 'stopping' ? t('composer.stopping') : t('composer.stop')}
              disabled={!state.stopEnabled || state.mode === 'stopping'}
              icon={state.mode === 'stopping' ? <ActivityIndicator color={color.danger} size="small" /> : <Text style={styles.stopIcon}>■</Text>}
              onPress={props.onCancel}
              style={[styles.iconButton, styles.stopButton, styles.primaryAction]}
            />
          ) : (
            <>
              <IconButton
                accessibilityLabel={t('composer.stop')}
                disabled={!state.stopEnabled}
                icon={<Text style={styles.stopIcon}>■</Text>}
                onPress={props.onCancel}
                style={[styles.iconButton, styles.stopButton]}
              />
              <IconButton
                accessibilityLabel={t('composer.send')}
                disabled={!state.sendEnabled}
                icon={<Text style={styles.sendIcon}>↑</Text>}
                onPress={props.onSubmit}
                style={[styles.iconButton, styles.sendButton, styles.primaryAction]}
              />
            </>
          )}
        </View>
      </View>
    </View>
  )
}

const COMPOSER_STATE_KEYS: Record<ComposerMode, MobileMessageKey> = {
  loading: 'composer.state.loading',
  replaying: 'composer.state.replaying',
  offline: 'composer.state.offline',
  ready: 'composer.state.ready',
  submitting: 'composer.state.submitting',
  queued: 'composer.state.queued',
  executing: 'composer.state.executing',
  stopping: 'composer.state.stopping',
  unknown: 'composer.state.unknown',
  error: 'composer.state.error',
}
type ComposerMode = ReturnType<typeof composerViewState>['mode']

const { color, radius, spacing, typography } = mobileTheme
const styles = StyleSheet.create({
  container: {
    backgroundColor: color.surface,
    borderTopColor: color.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minHeight: 44 },
  statusCopy: { flex: 1, minWidth: 0 },
  statusTitle: { color: color.text, fontSize: typography.caption, fontWeight: '700' },
  statusDetail: { color: color.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 1 },
  statusAction: { minHeight: mobileTheme.touchTarget, paddingHorizontal: spacing.sm },
  dismissIcon: { color: color.textSecondary, fontSize: 23, lineHeight: 24 },
  composer: {
    alignItems: 'flex-end',
    borderColor: color.borderStrong,
    backgroundColor: color.surfaceAccent,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 60,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  input: { color: color.text, flex: 1, fontSize: typography.body, lineHeight: 21, maxHeight: 112, minHeight: 44, paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.xxs },
  iconButton: { borderColor: color.border, borderWidth: 1 },
  primaryAction: { borderRadius: radius.md, minHeight: 44, minWidth: 44 },
  sendButton: { backgroundColor: color.brand, borderColor: color.brand },
  sendIcon: { color: color.surface, fontSize: 21, fontWeight: '800', lineHeight: 23 },
  stopButton: { backgroundColor: color.dangerSoft, borderColor: color.danger },
  stopIcon: { color: color.danger, fontSize: 15, lineHeight: 18 },
})
