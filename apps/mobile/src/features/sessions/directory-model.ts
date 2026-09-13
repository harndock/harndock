import type { RemoteDeviceSummary, RemoteRuntimeSummary } from '../../sync/gateway-api'
import type { SessionProjection } from '../../sync/projection'
import { message, type MobileMessage } from '../../i18n/messages'

export interface SessionDirectorySections {
  readonly attention: readonly SessionProjection[]
  readonly recent: readonly SessionProjection[]
}

export interface PcConnectionSummary {
  readonly title: string
  readonly detail: string
  /** Locale-neutral descriptors consumed by the mobile UI. */
  readonly titleMessage?: MobileMessage
  readonly detailMessage?: MobileMessage
  readonly tone: 'online' | 'offline' | 'warning'
}

export function groupSessionDirectory(sessions: readonly SessionProjection[]): SessionDirectorySections {
  const sorted = [...sessions].sort(compareSessionActivity)
  return {
    attention: sorted.filter(needsAttention),
    recent: sorted.filter(session => !needsAttention(session)),
  }
}

export function sessionActivityLabel(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '活动时间未知'
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} 小时前`
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))} 天前`
  return new Date(timestamp).toLocaleDateString()
}

export function sessionActivityMessage(timestamp: number, now = Date.now()): MobileMessage {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return message('session.activity.unknown')
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return message('session.activity.justNow')
  if (elapsed < 60 * 60_000) return message('session.activity.minutesAgo', { count: Math.floor(elapsed / 60_000) })
  if (elapsed < 24 * 60 * 60_000) return message('session.activity.hoursAgo', { count: Math.floor(elapsed / (60 * 60_000)) })
  if (elapsed < 7 * 24 * 60 * 60_000) return message('session.activity.daysAgo', { count: Math.floor(elapsed / (24 * 60 * 60_000)) })
  return message('session.activity.daysAgo', { count: Math.floor(elapsed / (24 * 60 * 60_000)) })
}

export function sessionDirectorySummary(session: SessionProjection): string {
  if (session.unresolvedApproval !== null) return `等待审批：${session.unresolvedApproval.toolName}`
  const latest = session.conversation.at(-1)?.text.trim()
  if (latest !== undefined && latest.length > 0) return truncate(latest, 88)
  if (session.historyLoaded === false) return '正在同步对话历史'
  return '暂无对话摘要'
}

export function sessionDirectorySummaryMessage(session: SessionProjection): MobileMessage | string {
  if (session.unresolvedApproval !== null) return message('session.summary.awaitingApproval', { tool: session.unresolvedApproval.toolName })
  const latest = session.conversation.at(-1)?.text.trim()
  if (latest !== undefined && latest.length > 0) return truncate(latest, 88)
  if (session.historyLoaded === false) return message('session.summary.syncingHistory')
  return message('session.summary.empty')
}

export function pcConnectionSummary(
  devices: readonly RemoteDeviceSummary[],
  runtimes: readonly RemoteRuntimeSummary[],
  connectionState: string,
  now = Date.now(),
): PcConnectionSummary {
  const onlineRuntime = [...runtimes]
    .filter(runtime => runtime.status === 'online')
    .sort((left, right) => timestamp(right.lastHeartbeatAt) - timestamp(left.lastHeartbeatAt))[0]
  if (onlineRuntime !== undefined) {
    const device = devices.find(item => item.deviceId === onlineRuntime.deviceId)
    return {
      detail: `${onlineRuntime.profile} · 心跳 ${heartbeatLabel(onlineRuntime.lastHeartbeatAt, now)} · Gateway ${gatewayState(connectionState)}`,
      title: `${device?.name ?? 'PC'} · 在线`,
      detailMessage: message('pc.detail.online', {
        gateway: gatewayStateMessage(connectionState),
        heartbeat: heartbeatMessage(onlineRuntime.lastHeartbeatAt, now),
        profile: onlineRuntime.profile,
      }),
      titleMessage: message('pc.title.online', { device: device?.name ?? 'PC' }),
      tone: connectionState === 'connected' ? 'online' : 'warning',
    }
  }
  const device = devices.find(item => item.deviceType === 'desktop') ?? devices[0]
  if (device !== undefined) {
    return {
      detail: `${device.platform} · Runtime ${device.runtimeCount} · Gateway ${gatewayState(connectionState)}`,
      title: `${device.name} · 离线`,
      detailMessage: message('pc.detail.offline', {
        gateway: gatewayStateMessage(connectionState),
        platform: device.platform,
        runtimeCount: device.runtimeCount,
      }),
      titleMessage: message('pc.title.offline', { device: device.name }),
      tone: connectionState === 'connected' ? 'offline' : 'warning',
    }
  }
  return {
    detail: connectionState === 'connected'
      ? 'Gateway 已连接，尚无已配对 PC Runtime'
      : `Gateway ${gatewayState(connectionState)}`,
    title: '尚未连接 PC',
    detailMessage: connectionState === 'connected'
      ? message('pc.detail.gatewayReady')
      : message('pc.detail.gatewayState', { gateway: gatewayStateMessage(connectionState) }),
    titleMessage: message('pc.title.unpaired'),
    tone: connectionState === 'connected' ? 'offline' : 'warning',
  }
}

function needsAttention(session: SessionProjection): boolean {
  return session.unresolvedApproval !== null || session.status === 'waiting'
}

function compareSessionActivity(left: SessionProjection, right: SessionProjection): number {
  return right.lastActivityAt - left.lastActivityAt || left.sessionId.localeCompare(right.sessionId)
}

function truncate(value: string, maximumLength: number): string {
  return value.length <= maximumLength ? value : `${value.slice(0, maximumLength - 1)}…`
}

function timestamp(value: string | undefined): number {
  if (value === undefined) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function heartbeatLabel(value: string | undefined, now: number): string {
  const heartbeat = timestamp(value)
  if (heartbeat === 0) return '未知'
  const elapsed = Math.max(0, now - heartbeat)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  return `${Math.floor(elapsed / (60 * 60_000))} 小时前`
}

function gatewayState(value: string): string {
  if (value === 'connected') return '已连接'
  if (value === 'connecting') return '连接中'
  if (value === 'reconnecting') return '重连中'
  return '离线'
}

function heartbeatMessage(value: string | undefined, now: number): MobileMessage {
  const heartbeat = timestamp(value)
  if (heartbeat === 0) return message('pc.heartbeat.unknown')
  const elapsed = Math.max(0, now - heartbeat)
  if (elapsed < 60_000) return message('pc.heartbeat.justNow')
  if (elapsed < 60 * 60_000) return message('pc.heartbeat.minutesAgo', { count: Math.floor(elapsed / 60_000) })
  return message('pc.heartbeat.hoursAgo', { count: Math.floor(elapsed / (60 * 60_000)) })
}

function gatewayStateMessage(value: string): MobileMessage {
  if (value === 'connected') return message('pc.gateway.connected')
  if (value === 'connecting') return message('pc.gateway.connecting')
  if (value === 'reconnecting') return message('pc.gateway.reconnecting')
  return message('pc.gateway.offline')
}
