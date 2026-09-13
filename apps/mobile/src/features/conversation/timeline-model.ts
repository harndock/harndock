import type { ConversationMessage, ProjectedEvent, SessionProjection } from '../../sync/projection'
import type { StoredCommandState } from '../../sync/command-state'
import { describeEvent, describeEventMessage } from '../../sync/event-summary'
import { commandStatusLabel } from '../../sync/status-labels'
import { message, type MobileMessage } from '../../i18n/messages'

export type TimelineEventKind = 'tool' | 'approval' | 'command' | 'status' | 'unknown'

export interface TimelineMessageItem {
  readonly key: string
  readonly kind: 'message'
  readonly orderSeq: number
  readonly message: ConversationMessage
  readonly meta: string
  readonly timestamp: number
  readonly sequence: number
}

export interface TimelineEventItem {
  readonly key: string
  readonly kind: TimelineEventKind
  readonly orderSeq: number
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly meta: string
  readonly timestamp?: number
  readonly sequence?: number
  readonly baseSeq?: number
  readonly titleMessage?: MobileMessage
  readonly summaryMessage?: MobileMessage
  readonly detailMessage?: MobileMessage
  readonly commandStatus?: string
  readonly expandable: boolean
}

export type TimelineItem = TimelineMessageItem | TimelineEventItem

/** Conversation-facing projection with low-value events grouped into activity rows. */
export interface ConversationActivityItem {
  readonly key: string
  readonly kind: 'activity'
  readonly orderSeq: number
  readonly events: readonly TimelineEventItem[]
  readonly summary: string
  readonly summaryMessage?: MobileMessage
}

export type ConversationTimelineItem = TimelineMessageItem | ConversationActivityItem

const MESSAGE_EVENTS = new Set(['user/message', 'assistant/message', 'assistant/chunk', 'assistant/delta'])

export function buildEventTimeline(
  projection: SessionProjection | undefined,
  command?: StoredCommandState,
): readonly TimelineItem[] {
  if (projection === undefined) return []
  const messages = projection.conversation.map(messageItem)
  const events = projection.recentEvents
    .filter(event => !MESSAGE_EVENTS.has(event.type))
    .map(eventItem)
  const commands = command === undefined ? [] : [commandItem(command)]
  return [...messages, ...events, ...commands].sort((left, right) => (
    left.orderSeq - right.orderSeq || left.key.localeCompare(right.key)
  ))
}

export function buildConversationTimeline(
  projection: SessionProjection | undefined,
  command?: StoredCommandState,
): readonly ConversationTimelineItem[] {
  const items = buildEventTimeline(projection, command)
  const conversation: ConversationTimelineItem[] = []
  let pendingEvents: TimelineEventItem[] = []

  const flushEvents = (): void => {
    if (pendingEvents.length === 0) return
    const first = pendingEvents[0]
    if (first === undefined) return
    conversation.push({
      key: `activity:${first.key}:${pendingEvents.at(-1)?.key ?? first.key}`,
      kind: 'activity',
      orderSeq: first.orderSeq,
      events: pendingEvents,
    summary: activitySummary(pendingEvents),
      summaryMessage: message('timeline.activity.summary', {
        approvals: pendingEvents.filter(event => event.kind === 'approval').length,
        statuses: pendingEvents.filter(event => event.kind === 'status').length,
        tools: pendingEvents.filter(event => event.kind === 'tool').length,
      }),
    })
    pendingEvents = []
  }

  for (const item of items) {
    if (item.kind === 'message') {
      flushEvents()
      conversation.push(item)
      continue
    }
    // Command delivery belongs to the Composer status row, not the transcript.
    if (item.kind === 'command') continue
    pendingEvents.push(item)
  }
  flushEvents()
  return conversation
}

function activitySummary(events: readonly TimelineEventItem[]): string {
  const toolCount = events.filter(event => event.kind === 'tool').length
  const approvalCount = events.filter(event => event.kind === 'approval').length
  const statusCount = events.length - toolCount - approvalCount
  const parts = ['运行过程']
  if (toolCount > 0) parts.push(`${toolCount} 个工具事件`)
  if (approvalCount > 0) parts.push(`${approvalCount} 个审批事件`)
  if (statusCount > 0) parts.push(`${statusCount} 个状态事件`)
  return parts.join(' · ')
}

function commandItem(command: StoredCommandState): TimelineEventItem {
  const timestamp = Date.parse(command.completedAt ?? command.acceptedAt ?? '')
  return {
    key: `command:${command.commandId}`,
    kind: 'command',
    orderSeq: command.baseSeq + 0.5,
    title: commandTitle(command.commandType),
    summary: `命令状态：${commandStatusLabel(command.status)}`,
    detail: '命令内容和凭据不会写入此时间线摘要。',
    titleMessage: message(command.commandType === 'session.prompt'
      ? 'timeline.command.remoteMessage'
      : command.commandType === 'session.cancel' ? 'timeline.command.stopRequest' : 'timeline.command.approvalResponse'),
    detailMessage: message('timeline.command.detail'),
    summaryMessage: message('timeline.command.status', { status: command.status }),
    commandStatus: command.status,
    meta: Number.isFinite(timestamp)
      ? `${timelineTimeLabel(timestamp)} · 基于 seq ${command.baseSeq}`
      : `基于 seq ${command.baseSeq}`,
    timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
    baseSeq: command.baseSeq,
    expandable: false,
  }
}

export function timelineTimeLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '时间未知'
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function messageItem(message: ConversationMessage): TimelineMessageItem {
  return {
    key: `message:${message.role}:${message.id}:${message.startSeq}`,
    kind: 'message',
    orderSeq: message.startSeq,
    message,
    meta: `${timelineTimeLabel(message.time)} · seq ${message.endSeq}`,
    timestamp: message.time,
    sequence: message.endSeq,
  }
}

function eventItem(event: ProjectedEvent): TimelineEventItem {
  const kind = eventKind(event.type)
  return {
    key: `event:${event.seq}:${event.type}`,
    kind,
    orderSeq: event.seq,
    title: eventTitle(event),
    summary: describeEvent(event),
    detail: safeDetail(kind, event.type),
    titleMessage: eventTitleMessage(event),
    detailMessage: safeDetailMessage(kind, event.type),
    summaryMessage: describeEventMessage(event),
    meta: `${timelineTimeLabel(event.time)} · seq ${event.seq}`,
    timestamp: event.time,
    sequence: event.seq,
    expandable: kind === 'tool',
  }
}

function eventTitleMessage(event: ProjectedEvent): MobileMessage {
  if (event.type === 'tool/call') return message('timeline.event.toolCall')
  if (event.type === 'tool/result') return message('timeline.event.toolResult')
  if (event.type === 'approval/asked' || event.type === 'approval/request') return message('timeline.event.approvalPending')
  if (event.type.startsWith('approval/')) return message('timeline.event.approvalUpdated')
  if (event.type === 'turn/start') return message('timeline.event.harnessStart')
  if (event.type === 'turn/end') return message('timeline.event.harnessEnd')
  if (event.type === 'step/start') return message('timeline.event.stepStart')
  if (event.type === 'step/end') return message('timeline.event.stepEnd')
  if (event.type.startsWith('command/')) return message('timeline.event.commandStatus')
  if (event.type.endsWith('/status')) return message('timeline.event.sessionStatus')
  return message('timeline.detail.generic')
}

function safeDetailMessage(kind: TimelineEventKind, eventType: string): MobileMessage {
  if (kind === 'tool') return message(eventType === 'tool/call' ? 'timeline.detail.toolCall' : 'timeline.detail.toolResult')
  if (kind === 'unknown') return message('timeline.detail.unknown')
  return message('timeline.detail.generic')
}

function eventKind(type: string): TimelineEventKind {
  if (type === 'tool/call' || type === 'tool/result') return 'tool'
  if (type.startsWith('approval/')) return 'approval'
  if (type === 'turn/start' || type === 'turn/end' || type === 'step/start' || type === 'step/end'
    || type.endsWith('/status') || type.startsWith('command/')) {
    return 'status'
  }
  return 'unknown'
}

function commandTitle(type: StoredCommandState['commandType']): string {
  if (type === 'session.prompt') return '已提交远程消息'
  if (type === 'session.cancel') return '已提交停止请求'
  return '已提交审批响应'
}

function eventTitle(event: ProjectedEvent): string {
  if (event.type === 'tool/call') return '工具调用'
  if (event.type === 'tool/result') return '工具结果'
  if (event.type === 'approval/asked' || event.type === 'approval/request') return '等待审批'
  if (event.type.startsWith('approval/')) return '审批已更新'
  if (event.type === 'turn/start') return 'Harness 开始处理'
  if (event.type === 'turn/end') return 'Harness 本轮结束'
  if (event.type === 'step/start') return '步骤开始'
  if (event.type === 'step/end') return '步骤完成'
  if (event.type.startsWith('command/')) return '远程命令状态'
  if (event.type.endsWith('/status')) return 'Session 状态更新'
  return event.type
}

function safeDetail(kind: TimelineEventKind, eventType: string): string {
  if (kind === 'tool') {
    return eventType === 'tool/call'
      ? '工具参数、路径和环境信息已隐藏。'
      : '工具输出和结果内容已隐藏。'
  }
  if (kind === 'unknown') return '当前客户端保留此事件的位置与类型，但不会展开未知 payload。'
  return '详细 payload 不在移动端展示。'
}
