import { visibleTextFromValue, type ProjectedEvent } from './projection'
import { message, type MobileMessage } from '../i18n/messages'

export function describeEvent(event: ProjectedEvent): string {
  const data = event.data
  if (event.type === 'user/message' || event.type === 'assistant/message'
    || event.type === 'assistant/chunk' || event.type === 'assistant/delta') {
    return truncate(visibleTextFromValue(data) ?? '消息内容不可用')
  }
  if (event.type === 'tool/call') {
    const toolName = readString(data, ['toolName', 'name'])
    return toolName === undefined ? '工具调用已发出（参数已隐藏）' : `工具调用：${truncate(toolName, 120)}（参数已隐藏）`
  }
  if (event.type === 'tool/result') return '工具结果已收到（结果内容已隐藏）'
  if (event.type === 'approval/request' || event.type === 'approval/asked') {
    const toolName = readString(data, ['toolName', 'name'])
    return toolName === undefined ? '需要工具审批' : `需要审批：${truncate(toolName, 120)}`
  }
  if (event.type === 'approval/decided' || event.type === 'approval/response' || event.type === 'approval/resolved') {
    return '审批结果已由 PC Harness 确认'
  }
  if (event.type === 'turn/start') return 'PC Harness 已开始处理本轮请求'
  if (event.type === 'turn/end') {
    const kind = readPath(data, ['reason', 'kind']) ?? readString(data, ['kind'])
    if (kind === 'completed') return '本轮请求已完成'
    if (kind === 'aborted') return '本轮请求已停止'
    return '本轮请求已结束'
  }
  if (event.type === 'agent/status' || event.type === 'session/status') {
    const status = readString(data, ['status'])
    return status === undefined ? '状态已更新' : `状态：${truncate(status, 120)}`
  }
  return '未知事件已保留，当前客户端不展开其 payload。'
}

/** Locale-neutral equivalent of describeEvent for UI rendering. */
export function describeEventMessage(event: ProjectedEvent): MobileMessage {
  const data = event.data
  if (event.type === 'user/message' || event.type === 'assistant/message'
    || event.type === 'assistant/chunk' || event.type === 'assistant/delta') {
    return message('timeline.summary.messageUnavailable')
  }
  if (event.type === 'tool/call') {
    const toolName = readString(data, ['toolName', 'name'])
    return toolName === undefined
      ? message('timeline.summary.toolCallUnknown')
      : message('timeline.summary.toolCall', { tool: truncate(toolName, 120) })
  }
  if (event.type === 'tool/result') return message('timeline.summary.toolResult')
  if (event.type === 'approval/request' || event.type === 'approval/asked') {
    const toolName = readString(data, ['toolName', 'name'])
    return toolName === undefined
      ? message('timeline.summary.approvalNeededUnknown')
      : message('timeline.summary.approvalNeeded', { tool: truncate(toolName, 120) })
  }
  if (event.type === 'approval/decided' || event.type === 'approval/response' || event.type === 'approval/resolved') {
    return message('timeline.summary.approvalConfirmed')
  }
  if (event.type === 'turn/start') return message('timeline.summary.turnStarted')
  if (event.type === 'turn/end') {
    const kind = readPath(data, ['reason', 'kind']) ?? readString(data, ['kind'])
    if (kind === 'completed') return message('timeline.summary.turnCompleted')
    if (kind === 'aborted') return message('timeline.summary.turnAborted')
    return message('timeline.summary.turnEnded')
  }
  if (event.type === 'agent/status' || event.type === 'session/status') {
    const status = readString(data, ['status'])
    return status === undefined
      ? message('timeline.summary.statusUpdated')
      : message('timeline.summary.status', { status: truncate(status, 120) })
  }
  return message('timeline.summary.unknownEvent')
}

function readPath(value: unknown, keys: readonly string[]): string | undefined {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : undefined
}

function readString(value: unknown, keys: readonly string[]): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key]
    if (record[key] !== null && typeof record[key] === 'object') {
      const nested = readString(record[key], ['text', 'content', 'message'])
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function truncate(value: string, limit = 500): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}
