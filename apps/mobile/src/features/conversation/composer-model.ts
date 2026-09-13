import type { CommandType, SessionStatus } from '@harndock/sync-protocol'
import type { StoredCommandState } from '../../sync/command-state'

export type CommandOperationKind =
  | 'idle'
  | 'submitting'
  | 'recovering'
  | 'stale'
  | 'offline'
  | 'submission-error'
  | 'status-error'
  | 'approval-decided'

export interface CommandOperationState {
  readonly kind: CommandOperationKind
  readonly commandType?: CommandType
  readonly detail?: string
  readonly expectedSeq?: number
  readonly retry: 'none' | 'submit' | 'status'
}

export interface ComposerViewState {
  readonly mode: 'loading' | 'replaying' | 'offline' | 'ready' | 'submitting' | 'queued' | 'executing' | 'stopping' | 'unknown' | 'error'
  readonly title: string
  readonly detail: string
  readonly tone: 'online' | 'offline' | 'warning'
  readonly inputEnabled: boolean
  readonly sendEnabled: boolean
  readonly stopEnabled: boolean
  readonly retryEnabled: boolean
  readonly retryLabel?: string
  readonly dismissEnabled: boolean
}

export function composerViewState(input: {
  readonly projectionStatus?: SessionStatus
  readonly historyLoaded: boolean
  readonly lastSeq: number
  readonly prompt: string
  readonly busy: boolean
  readonly command?: StoredCommandState
  readonly commandAcknowledged: boolean
  readonly operation: CommandOperationState
  readonly canRetry: boolean
}): ComposerViewState {
  const command = input.commandAcknowledged || input.command?.commandType === 'approval.respond'
    ? undefined
    : input.command
  const operation = input.operation.commandType === 'approval.respond'
    ? { kind: 'idle', retry: 'none' } as const
    : input.operation
  if (input.projectionStatus === undefined) return state('loading', '正在准备控制', '等待本地 Session 快照。', 'warning')
  if (!input.historyLoaded) return state('replaying', '正在补发历史', '历史追平前暂停发送，避免基于过期状态执行。', 'warning')
  if (input.projectionStatus === 'offline') return state('offline', 'PC Runtime 离线', '已确认历史仍可查看，连接恢复后可继续。', 'offline')
  if (operation.kind === 'stale') {
    const ready = operation.expectedSeq === undefined || input.lastSeq >= operation.expectedSeq
    return {
      ...state('error', '页面状态已过期', ready ? '历史已追平，可以重新提交。' : `正在等待同步到 seq ${operation.expectedSeq ?? '未知'}。`, 'warning'),
      retryEnabled: ready && input.canRetry,
      retryLabel: '重新提交',
      dismissEnabled: ready,
    }
  }
  if (operation.kind === 'offline') {
    return {
      ...state('offline', '命令未提交', operation.detail ?? 'PC Runtime 离线。', 'offline'),
      retryEnabled: input.canRetry,
      retryLabel: '重新提交',
      dismissEnabled: true,
    }
  }
  if (operation.kind === 'submission-error') {
    return {
      ...state('error', '命令提交失败', operation.detail ?? '请检查连接后重试。', 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '重试提交',
      dismissEnabled: true,
    }
  }
  if (operation.kind === 'status-error') {
    return {
      ...state('error', '命令状态未确认', operation.detail ?? '不会自动重新执行命令。', 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '刷新状态',
      dismissEnabled: false,
    }
  }
  if (operation.kind === 'recovering') return state('submitting', '正在恢复命令状态', '只查询原命令，不会重新执行。', 'warning')
  if (operation.kind === 'submitting') {
    return operation.commandType === 'session.cancel'
      ? state('stopping', '正在提交停止请求', 'Session 状态只会由真实事件更新。', 'warning')
      : state('submitting', '正在提交到 PC Harness', '等待 Gateway 接受命令。', 'warning')
  }
  if (command?.commandType === 'session.cancel' && isStillActive(input.projectionStatus)
    && command.status !== 'rejected' && command.status !== 'expired' && command.status !== 'unknown') {
    return state('stopping', '停止中', '等待 PC Harness 返回真实结束事件。', 'warning')
  }
  if (command?.status === 'unknown') {
    return {
      ...state('unknown', '命令状态未知', '请先检查时间线，再决定是否重新提交；系统不会自动重放。', 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '确认后重新提交',
      dismissEnabled: true,
    }
  }
  if (command?.status === 'rejected' || command?.status === 'expired') {
    return {
      ...state('error', command.status === 'expired' ? '命令已过期' : '命令已拒绝', '可以在确认 Session 状态后重新提交。', 'warning'),
      retryEnabled: input.canRetry,
      retryLabel: '重新提交',
      dismissEnabled: true,
    }
  }
  if (command !== undefined && ['received', 'authorized', 'queued'].includes(command.status)) {
    return actionState('queued', '已排队', '等待 PC Connector 执行。', input)
  }
  if (command?.status === 'executing') return actionState('executing', '执行中', '实际结果以时间线事件为准。', input)
  const ready = state('ready', '由 PC Harness 执行', '发送内容不会在 Gateway 执行。', 'online')
  return {
    ...ready,
    inputEnabled: !input.busy,
    sendEnabled: !input.busy && input.prompt.trim().length > 0,
    stopEnabled: !input.busy && input.projectionStatus === 'running',
  }
}

export function nextCommandAttempt<T extends { commandId: string; baseSeq: number; expiresAt: string }>(
  previous: T,
  options: {
    readonly reuseIdentity: boolean
    readonly currentSeq: number
    readonly now: number
    readonly createId: () => string
  },
): T {
  const reuseIdentity = options.reuseIdentity && Date.parse(previous.expiresAt) > options.now
  return {
    ...previous,
    commandId: reuseIdentity ? previous.commandId : options.createId(),
    baseSeq: reuseIdentity ? previous.baseSeq : options.currentSeq,
    expiresAt: reuseIdentity ? previous.expiresAt : new Date(options.now + 120_000).toISOString(),
  }
}

function actionState(
  mode: ComposerViewState['mode'],
  title: string,
  detail: string,
  input: { readonly projectionStatus?: SessionStatus },
): ComposerViewState {
  return {
    ...state(mode, title, detail, 'warning'),
    stopEnabled: input.projectionStatus === 'running',
  }
}

function state(
  mode: ComposerViewState['mode'],
  title: string,
  detail: string,
  tone: ComposerViewState['tone'],
): ComposerViewState {
  return {
    mode,
    title,
    detail,
    tone,
    inputEnabled: false,
    sendEnabled: false,
    stopEnabled: false,
    retryEnabled: false,
    dismissEnabled: false,
  }
}

function isStillActive(status: SessionStatus): boolean {
  return status === 'idle' || status === 'running' || status === 'waiting'
}
