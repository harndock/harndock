import type { CommandStatus, SessionStatus } from '@harndock/sync-protocol'
import type { GatewayConnectionState } from './gateway-client'
import type { MobileMessageKey } from '../i18n'

const CONNECTION_LABELS: Record<GatewayConnectionState, string> = {
  idle: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '正在重连',
  closed: '离线',
  error: '连接错误',
}

const SESSION_LABELS: Record<SessionStatus, string> = {
  idle: '空闲',
  running: '运行中',
  waiting: '等待中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  offline: 'PC 离线',
}

const COMMAND_LABELS: Record<CommandStatus, string> = {
  received: '已接收',
  authorized: '已授权',
  queued: '已排队',
  executing: '执行中',
  completed: '已完成',
  rejected: '已拒绝',
  expired: '已过期',
  unknown: '状态未知',
}

export function connectionStateLabel(state: string): string {
  return state in CONNECTION_LABELS ? CONNECTION_LABELS[state as GatewayConnectionState] : '未知连接状态'
}

export function connectionStateKey(state: string): MobileMessageKey {
  return state in CONNECTION_LABELS
    ? `status.connection.${state}` as MobileMessageKey
    : 'status.connection.unknown'
}

export function sessionStatusLabel(status: string): string {
  return status in SESSION_LABELS ? SESSION_LABELS[status as SessionStatus] : '未知 Session 状态'
}

export function sessionStatusKey(status: string): MobileMessageKey {
  return status in SESSION_LABELS
    ? `status.session.${status}` as MobileMessageKey
    : 'status.session.unknown'
}

export function commandStatusLabel(status: string): string {
  return status in COMMAND_LABELS ? COMMAND_LABELS[status as CommandStatus] : '未知命令状态'
}

export function commandStatusKey(status: string): MobileMessageKey {
  return status in COMMAND_LABELS
    ? `command.status.${status}` as MobileMessageKey
    : 'command.status.unknown'
}

export function connectionStateNotice(state: string): string | undefined {
  if (state === 'connecting') return '正在连接 Gateway，当前显示本地缓存。'
  if (state === 'reconnecting') return 'Gateway 连接中断，正在重连；当前显示本地缓存。'
  if (state === 'closed' || state === 'error') return 'Gateway 离线，当前显示本地缓存。'
  return undefined
}

export function connectionStateNoticeKey(state: string): MobileMessageKey | undefined {
  if (state === 'connecting') return 'connection.notice.connecting'
  if (state === 'reconnecting') return 'connection.notice.reconnecting'
  if (state === 'closed' || state === 'error') return 'connection.notice.offline'
  return undefined
}
