import type { SessionStatus } from '@harndock/sync-protocol'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  approvalPanelState,
  type ApprovalAttempt,
} from '../features/conversation/approval-model'
import type { CommandOperationState } from '../features/conversation/composer-model'
import type { StoredCommandState } from '../sync/command-state'
import { mobileTheme } from '../theme'
import { AppButton } from './AppButton'
import type { ApprovalPanelContract } from './contracts'
import { StatusDot } from './StatusDot'
import { translateLegacyNotice, useI18n, type MobileMessageKey } from '../i18n'

export interface ApprovalPanelProps extends ApprovalPanelContract {
  readonly projectionStatus: SessionStatus
  readonly historyLoaded: boolean
  readonly lastSeq: number
  readonly command?: StoredCommandState
  readonly operation: CommandOperationState
  readonly attempt?: ApprovalAttempt
  readonly canRetry: boolean
  readonly onRetry: () => void | Promise<void>
}

export function ApprovalPanel(props: ApprovalPanelProps): React.JSX.Element {
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const state = approvalPanelState({
    approvalId: props.approvalId,
    attempt: props.attempt,
    busy: props.disabled || props.submitting,
    canRetry: props.canRetry,
    command: props.command,
    historyLoaded: props.historyLoaded,
    lastSeq: props.lastSeq,
    operation: props.operation,
    projectionStatus: props.projectionStatus,
  })
  const stateTitle = t(APPROVAL_STATE_KEYS[state.mode])
  const stateDetail = translateLegacyNotice(t, state.detail)

  return (
    <View
      accessibilityLabel={`${stateTitle}。${stateDetail}`}
      style={[styles.container, { marginBottom: Math.max(insets.bottom, spacing.sm) }]}
    >
      <View style={styles.strip}>
        {state.pending
          ? <ActivityIndicator size="small" />
          : <StatusDot label={stateTitle} tone={state.tone} />}
        <View style={styles.statusCopy}>
        <Text accessibilityLiveRegion="polite" style={styles.statusTitle}>{stateTitle}</Text>
          <Text style={styles.statusDetail}>{stateDetail}</Text>
        </View>
        {state.retryLabel !== undefined && (
          <AppButton
            disabled={!state.retryEnabled}
            label={state.retryLabel}
            loading={state.pending}
            onPress={props.onRetry}
            style={styles.retryButton}
            variant="secondary"
          />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{t('approval.eyebrow')}</Text>
        <Text numberOfLines={2} style={styles.toolName}>{props.toolName}</Text>
        <Text style={styles.safetyCopy}>{t('approval.safety')}</Text>
        <View style={styles.actions}>
          <AppButton
            disabled={!state.actionsEnabled}
            label={t('approval.reject')}
            loading={state.pending}
            onPress={() => props.onRespond('rejected')}
            style={styles.action}
            variant="danger"
          />
          <AppButton
            disabled={!state.actionsEnabled}
            label={t('approval.allowOnce')}
            loading={state.pending}
            onPress={() => props.onRespond('allowed-once')}
            style={styles.action}
          />
        </View>
      </View>
    </View>
  )
}

const APPROVAL_STATE_KEYS: Record<ApprovalMode, MobileMessageKey> = {
  pending: 'approval.state.pending',
  submitting: 'approval.state.submitting',
  queued: 'approval.state.queued',
  executing: 'approval.state.executing',
  confirming: 'approval.state.confirming',
  stale: 'approval.state.stale',
  unknown: 'approval.state.unknown',
  offline: 'approval.state.offline',
  'already-decided': 'approval.state.already-decided',
  error: 'approval.state.error',
}
type ApprovalMode = ReturnType<typeof approvalPanelState>['mode']

const { color, radius, spacing, typography } = mobileTheme
const styles = StyleSheet.create({
  container: {
    backgroundColor: color.surface,
    borderColor: color.warning,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  strip: {
    alignItems: 'center',
    backgroundColor: color.warningSoft,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: mobileTheme.touchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusCopy: { flex: 1, minWidth: 0 },
  statusTitle: { color: color.text, fontSize: typography.caption, fontWeight: '700' },
  statusDetail: { color: color.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 1 },
  retryButton: { minHeight: mobileTheme.touchTarget, paddingHorizontal: spacing.sm },
  body: { gap: spacing.sm, padding: spacing.md },
  eyebrow: { color: color.warning, fontSize: 11, fontWeight: '700' },
  toolName: { color: color.text, fontSize: typography.subheading, fontWeight: '700' },
  safetyCopy: { color: color.textSecondary, fontSize: typography.caption, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
})
