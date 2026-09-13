import type { ApprovalOutcome, SessionStatus } from '@harndock/sync-protocol'
import type { StoredCommandState } from '../../sync/command-state'
import type { CommandOperationState } from './composer-model'

export interface ApprovalAttempt {
  readonly approvalId: string
  readonly commandId: string
  readonly outcome: ApprovalOutcome
}

export interface ApprovalSubmissionLock {
  readonly current: string | undefined
  claim: (approvalId: string) => boolean
  release: (approvalId: string) => void
  clear: () => void
}

export function createApprovalSubmissionLock(): ApprovalSubmissionLock {
  let current: string | undefined
  return {
    get current() {
      return current
    },
    claim(approvalId) {
      if (current !== undefined) return false
      current = approvalId
      return true
    },
    release(approvalId) {
      if (current === approvalId) current = undefined
    },
    clear() {
      current = undefined
    },
  }
}

export interface ApprovalPanelState {
  readonly mode: 'pending' | 'submitting' | 'queued' | 'executing' | 'confirming' | 'stale' | 'unknown' | 'offline' | 'already-decided' | 'error'
  readonly title: string
  readonly detail: string
  readonly tone: 'online' | 'offline' | 'warning'
  readonly actionsEnabled: boolean
  readonly retryEnabled: boolean
  readonly retryLabel?: string
  readonly pending: boolean
}

export function approvalPanelState(input: {
  readonly projectionStatus: SessionStatus
  readonly historyLoaded: boolean
  readonly lastSeq: number
  readonly approvalId: string
  readonly attempt?: ApprovalAttempt
  readonly command?: StoredCommandState
  readonly operation: CommandOperationState
  readonly canRetry: boolean
  readonly busy: boolean
}): ApprovalPanelState {
  const operation = input.operation.commandType === 'approval.respond' ? input.operation : IDLE_OPERATION
  const command = input.attempt?.approvalId === input.approvalId
    && input.command?.commandId === input.attempt.commandId
    && input.command.commandType === 'approval.respond'
    ? input.command
    : undefined
  const outcome = input.attempt?.approvalId === input.approvalId ? input.attempt.outcome : undefined
  const outcomeLabel = approvalOutcomeLabel(outcome)

  if (!input.historyLoaded) return state('stale', '正在补发审批状态', '历史追平前不能作出决定。', 'warning')
  if (input.projectionStatus === 'offline') return state('offline', 'PC Runtime 离线', '审批仍待处理，连接恢复后才能提交决定。', 'offline')
  if (operation.kind === 'approval-decided') {
    return state('already-decided', '已由其他设备处理', '正在等待真实审批事件同步到时间线。', 'warning')
  }
  if (operation.kind === 'stale') {
    const ready = operation.expectedSeq === undefined || input.lastSeq >= operation.expectedSeq
    return {
      ...state('stale', '审批页面状态已过期', ready ? `状态已追平，可以重新提交“${outcomeLabel}”。` : `正在等待同步到 seq ${operation.expectedSeq ?? '未知'}。`, 'warning'),
      retryEnabled: ready && input.canRetry,
      retryLabel: '重新提交',
    }
  }
  if (operation.kind === 'submitting') {
    return state('submitting', `正在提交“${outcomeLabel}”`, '等待 Gateway 接受审批决定。', 'warning', true)
  }
  if (operation.kind === 'recovering') {
    return state('submitting', '正在恢复审批状态', '只查询原命令，不会重复决定。', 'warning', true)
  }
  if (operation.kind === 'status-error') {
    return {
      ...state('error', '审批状态尚未确认', operation.detail ?? '不会自动重复提交审批决定。', 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '刷新状态',
    }
  }
  if (operation.kind === 'offline' || operation.kind === 'submission-error') {
    return {
      ...state(operation.kind === 'offline' ? 'offline' : 'error', '审批决定未提交', operation.detail ?? '请检查连接后重试。', operation.kind === 'offline' ? 'offline' : 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '重试原决定',
    }
  }
  if (command?.reason === 'approval_already_decided') {
    return state('already-decided', '已由其他设备处理', '正在等待真实审批事件同步到时间线。', 'warning')
  }
  if (command?.status === 'unknown') {
    return {
      ...state('unknown', '审批命令状态未知', `请先检查时间线，再决定是否重试“${outcomeLabel}”；系统不会自动重放。`, 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '确认后重试',
    }
  }
  if (command?.status === 'rejected' || command?.status === 'expired') {
    return {
      ...state('error', command.status === 'expired' ? '审批命令已过期' : '审批命令已拒绝', `当前审批仍待处理，可以重新提交“${outcomeLabel}”。`, 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '重新提交',
    }
  }
  if (command?.status === 'received' || command?.status === 'authorized' || command?.status === 'queued') {
    return state('queued', `已提交“${outcomeLabel}”`, '等待 PC Harness 处理审批命令。', 'warning', true)
  }
  if (command?.status === 'executing') {
    return state('executing', `正在处理“${outcomeLabel}”`, '审批结果以真实 Session 事件为准。', 'warning', true)
  }
  if (command?.status === 'completed' || input.attempt !== undefined) {
    return state('confirming', `已提交“${outcomeLabel}”`, '等待 PC Harness 返回真实审批事件。', 'warning', true)
  }
  return {
    ...state('pending', '需要你的审批', '只允许本次请求，完整参数请在 PC Harness 中核对。', 'warning'),
    actionsEnabled: !input.busy,
  }
}

export function approvalOutcomeLabel(outcome: ApprovalOutcome | undefined): string {
  if (outcome === 'allowed-once') return '允许一次'
  if (outcome === 'rejected') return '拒绝'
  return '审批决定'
}

const IDLE_OPERATION: CommandOperationState = { kind: 'idle', retry: 'none' }

function state(
  mode: ApprovalPanelState['mode'],
  title: string,
  detail: string,
  tone: ApprovalPanelState['tone'],
  pending = false,
): ApprovalPanelState {
  return {
    mode,
    title,
    detail,
    tone,
    actionsEnabled: false,
    retryEnabled: false,
    pending,
  }
}
