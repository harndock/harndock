import type { AuthenticatedAuthGateState } from '../auth/auth-gate-state'
import { pcConnectionSummary } from '../sessions/directory-model'
import type { SessionDirectoryController } from '../sessions/useSessionDirectory'
import { message, type MobileMessage } from '../../i18n/messages'
import { connectionStateKey } from '../../sync/status-labels'

export type SettingsTone = 'default' | 'online' | 'offline' | 'warning'

export interface SettingsSummaryRow {
  readonly label: string
  readonly value: string
  readonly detail?: string
  readonly labelMessage?: MobileMessage
  readonly valueMessage?: MobileMessage
  readonly detailMessage?: MobileMessage
  readonly tone: SettingsTone
}

export interface MobileSettingsSummary {
  readonly account: SettingsSummaryRow
  readonly device: SettingsSummaryRow
  readonly scopes: SettingsSummaryRow
  readonly gateway: SettingsSummaryRow
  readonly runtime: SettingsSummaryRow
  readonly stream: SettingsSummaryRow
  readonly cursor: SettingsSummaryRow
  readonly hasDiagnosticIssue: boolean
}

type DirectoryDiagnosticSource = Pick<SessionDirectoryController,
  | 'connectionState'
  | 'devices'
  | 'inventoryMessage'
  | 'runtimes'
  | 'sessions'
  | 'syncMessage'
>

export function mobileSettingsSummary(
  auth: AuthenticatedAuthGateState,
  directory: DirectoryDiagnosticSource,
  currentSessionId?: string,
): MobileSettingsSummary {
  const pc = pcConnectionSummary(directory.devices, directory.runtimes, directory.connectionState)
  const current = currentSessionId === undefined
    ? directory.sessions[0]
    : directory.sessions.find(item => item.sessionId === currentSessionId) ?? directory.sessions[0]
  const replaying = directory.sessions.filter(item => !item.historyLoaded).length
  const hasDiagnosticIssue = directory.inventoryMessage.length > 0 || directory.syncMessage.startsWith('同步失败')

  return {
    account: {
      label: '当前账号',
      labelMessage: message('settings.row.account'),
      value: auth.account?.displayName ?? auth.account?.username ?? developmentLabel(auth.mode),
      valueMessage: auth.account === undefined ? developmentMessage(auth.mode) : undefined,
      detail: auth.account?.username === undefined ? undefined : `@${auth.account.username}`,
      tone: 'default',
    },
    device: {
      label: '当前设备',
      labelMessage: message('settings.row.device'),
      value: auth.device?.name ?? developmentLabel(auth.mode),
      valueMessage: auth.device === undefined ? developmentMessage(auth.mode) : undefined,
      detail: auth.device === undefined
        ? undefined
        : `${auth.device.platform} · ${redactIdentifier(auth.device.deviceId)}`,
      tone: 'default',
    },
    scopes: {
      label: '授权范围',
      labelMessage: message('settings.row.scopes'),
      value: auth.scopes.length === 0 ? '未提供 scope 摘要' : auth.scopes.join(' · '),
      valueMessage: auth.scopes.length === 0 ? message('settings.row.scopesEmpty') : undefined,
      tone: auth.scopes.length === 0 ? 'warning' : 'default',
    },
    gateway: {
      label: 'Gateway',
      labelMessage: message('settings.row.gateway'),
      value: auth.gatewayOrigin,
      detail: gatewayStateLabel(directory.connectionState),
      detailMessage: message(connectionStateKey(directory.connectionState)),
      tone: connectionTone(directory.connectionState),
    },
    runtime: {
      label: 'PC Runtime',
      labelMessage: message('settings.row.runtime'),
      value: pc.title,
      detail: pc.detail,
      valueMessage: pc.titleMessage,
      detailMessage: pc.detailMessage,
      tone: pc.tone,
    },
    stream: {
      label: '同步流',
      labelMessage: message('settings.row.stream'),
      value: gatewayStateLabel(directory.connectionState),
      valueMessage: message(connectionStateKey(directory.connectionState)),
      detail: `${directory.sessions.length} 个 Session · ${replaying === 0 ? '无历史补发' : `${replaying} 个正在补发`}`,
      detailMessage: replaying === 0
        ? message('settings.row.streamDetailNoReplay', { count: directory.sessions.length })
        : message('settings.row.streamDetailReplaying', { count: replaying, sessions: directory.sessions.length }),
      tone: hasDiagnosticIssue ? 'warning' : connectionTone(directory.connectionState),
    },
    cursor: {
      label: currentSessionId === undefined ? '最近 Session 游标' : '当前 Session 游标',
      labelMessage: message(currentSessionId === undefined ? 'settings.row.cursorRecent' : 'settings.row.cursorCurrent'),
      value: current === undefined ? '暂无同步游标' : `seq ${current.lastSeq}`,
      valueMessage: current === undefined ? message('settings.row.cursorEmpty') : message('settings.row.cursorSeq', { seq: current.lastSeq }),
      detail: current === undefined
        ? '等待 PC 发布 Session'
        : current.historyLoaded ? '已跟上确认历史' : '正在补发确认历史',
      detailMessage: current === undefined
        ? message('settings.row.cursorWaiting')
        : current.historyLoaded ? message('settings.row.cursorSynced') : message('settings.row.cursorReplaying'),
      tone: current === undefined ? 'offline' : current.historyLoaded ? 'default' : 'warning',
    },
    hasDiagnosticIssue,
  }
}

export function accountInitials(auth: AuthenticatedAuthGateState): string {
  const source = auth.account?.displayName ?? auth.account?.username ?? 'DEV'
  const words = source.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) return `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function redactIdentifier(value: string): string {
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function developmentLabel(mode: AuthenticatedAuthGateState['mode']): string {
  return mode === 'development' ? '开发凭据' : '信息不可用'
}

function developmentMessage(mode: AuthenticatedAuthGateState['mode']): MobileMessage {
  return mode === 'development' ? message('settings.row.development') : message('settings.row.unavailable')
}

function connectionTone(state: string): SettingsTone {
  if (state === 'connected') return 'online'
  if (state === 'idle' || state === 'disconnected') return 'offline'
  return 'warning'
}

function gatewayStateLabel(state: string): string {
  if (state === 'connected') return '已连接'
  if (state === 'connecting') return '连接中'
  if (state === 'reconnecting') return '正在重连'
  return '离线'
}
