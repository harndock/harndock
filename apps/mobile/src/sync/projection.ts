import type {
  ProtocolFrame,
  SessionEventFrame,
  SessionSnapshotFrame,
  SessionStatus,
} from '@harndock/sync-protocol'
import type { RemoteSessionSummary } from './gateway-api'

export interface SessionProjection {
  sessionId: string
  runtimeId: string
  title: string
  cwdLabel?: string
  createdAt: number
  parentSessionId: string | null
  status: SessionStatus
  lastSeq: number
  lastActivityAt: number
  unresolvedApproval: { approvalId: string; toolName: string } | null
  conversationVersion: number
  conversation: readonly ConversationMessage[]
  historyLoaded: boolean
  recentEvents: readonly ProjectedEvent[]
}

export const CONVERSATION_PROJECTION_VERSION = 2

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  startSeq: number
  endSeq: number
  time: number
  streaming: boolean
}

export interface ProjectedEvent {
  seq: number
  type: string
  time: number
  data: unknown
}

export type ProjectionResult = 'applied' | 'duplicate' | 'ignored' | 'gap'

export interface ProjectionUpdate {
  result: ProjectionResult
  projection: SessionProjection | undefined
  expectedSeq?: number
}

const SESSION_STATUSES: readonly SessionStatus[] = ['idle', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'offline']

function sessionStatus(value: unknown): SessionStatus {
  return typeof value === 'string' && SESSION_STATUSES.includes(value as SessionStatus)
    ? value as SessionStatus
    : 'offline'
}

function isTerminalStatus(status: SessionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function runtimeIsOffline(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'offline'
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function sequenceValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -1 ? value : fallback
}

export function projectionFromSummary(summary: RemoteSessionSummary): SessionProjection {
  const title = typeof summary.header.title === 'string' ? summary.header.title : summary.sessionId
  const cwdLabel = typeof summary.header.cwdLabel === 'string' ? summary.header.cwdLabel : undefined
  const createdAt = numberValue(summary.header.createdAt, Date.parse(summary.updatedAt) || Date.now())
  const lastActivityAt = numberValue(summary.projection.lastActivityAt, createdAt)
  const status = sessionStatus(summary.projection.status)
  const unresolvedApproval = summary.projection.unresolvedApproval
  const approval = unresolvedApproval !== null && typeof unresolvedApproval === 'object' && !Array.isArray(unresolvedApproval)
    ? unresolvedApproval as { approvalId?: unknown; toolName?: unknown }
    : undefined
  return {
    sessionId: summary.sessionId,
    runtimeId: summary.runtimeId,
    title,
    ...(cwdLabel === undefined ? {} : { cwdLabel }),
    createdAt,
    parentSessionId: typeof summary.header.parentSessionId === 'string' ? summary.header.parentSessionId : null,
    status: runtimeIsOffline(summary.runtimeStatus) && !isTerminalStatus(status) ? 'offline' : status,
    lastSeq: sequenceValue(summary.lastSeq, -1),
    lastActivityAt,
    unresolvedApproval: typeof approval?.approvalId === 'string' && typeof approval.toolName === 'string'
      ? { approvalId: approval.approvalId, toolName: approval.toolName }
      : null,
    conversationVersion: CONVERSATION_PROJECTION_VERSION,
    conversation: [],
    historyLoaded: false,
    recentEvents: [],
  }
}

export interface SessionProjectionStore {
  upsert(session: SessionProjection): void
  replace(session: SessionProjection): void
  list(): SessionProjection[]
  get(sessionId: string): SessionProjection | undefined
  apply(frame: ProtocolFrame): ProjectionUpdate
}

function snapshotProjection(frame: SessionSnapshotFrame): SessionProjection {
  return {
    sessionId: frame.sessionId,
    runtimeId: frame.runtimeId,
    title: frame.payload.header.title,
    ...(frame.payload.header.cwdLabel === undefined ? {} : { cwdLabel: frame.payload.header.cwdLabel }),
    createdAt: frame.payload.header.createdAt,
    parentSessionId: frame.payload.header.parentSessionId,
    status: frame.payload.projection.status,
    lastSeq: frame.payload.projection.lastSeq,
    lastActivityAt: frame.payload.projection.lastActivityAt,
    unresolvedApproval: frame.payload.projection.unresolvedApproval,
    conversationVersion: CONVERSATION_PROJECTION_VERSION,
    conversation: [],
    historyLoaded: frame.payload.projection.lastSeq === -1,
    recentEvents: [],
  }
}

function statusFromEvent(frame: SessionEventFrame): SessionStatus | undefined {
  const data = frame.payload.event.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const value = (data as { status?: unknown }).status
  if (typeof value === 'string' && SESSION_STATUSES.includes(value as SessionStatus)) return value as SessionStatus
  if (frame.eventType === 'turn/start') return 'running'
  if (frame.eventType === 'approval/asked' || frame.eventType === 'approval/request') return 'waiting'
  if (frame.eventType === 'approval/decided' || frame.eventType === 'approval/response') return 'running'
  if (frame.eventType !== 'turn/end') return undefined
  const reason = (data as { reason?: unknown }).reason
  const kind = reason !== null && typeof reason === 'object' && !Array.isArray(reason)
    ? (reason as { kind?: unknown }).kind
    : undefined
  if (kind === 'completed') return 'completed'
  if (kind === 'aborted') return 'cancelled'
  return 'failed'
}

function approvalFromEvent(frame: SessionEventFrame): SessionProjection['unresolvedApproval'] | undefined {
  if (frame.eventType !== 'approval/request' && frame.eventType !== 'approval/asked') return undefined
  if (frame.payload.event.data === null || typeof frame.payload.event.data !== 'object') return undefined
  const data = frame.payload.event.data as { id?: unknown; approvalId?: unknown; toolName?: unknown }
  const approvalId = typeof data.id === 'string' ? data.id : data.approvalId
  if (typeof approvalId !== 'string' || typeof data.toolName !== 'string' || data.toolName.length === 0) return undefined
  return { approvalId, toolName: data.toolName }
}

export function visibleTextFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const text = value.map(visibleTextFromValue).filter((item): item is string => item !== undefined).join('')
    return text.length === 0 ? undefined : text
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.type === 'string' && record.type !== 'text') return undefined
  for (const key of ['text', 'delta', 'content', 'contentBlocks', 'message']) {
    const text = visibleTextFromValue(record[key])
    if (text !== undefined) return text
  }
  return undefined
}

function messageId(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  for (const key of ['messageId', 'message_id', 'id']) {
    if (typeof record[key] === 'string' && record[key].length > 0) return record[key]
  }
  return undefined
}

function applyConversationEvent(
  current: readonly ConversationMessage[],
  event: ProjectedEvent,
): readonly ConversationMessage[] {
  const text = visibleTextFromValue(event.data)
  if (text === undefined || text.length === 0) return current
  const isUserMessage = event.type === 'user/message'
  const isAssistantMessage = event.type === 'assistant/message'
  const isAssistantChunk = event.type === 'assistant/chunk' || event.type === 'assistant/delta'
  if (!isUserMessage && !isAssistantMessage && !isAssistantChunk) return current

  const role: ConversationMessage['role'] = isUserMessage ? 'user' : 'assistant'
  const externalId = messageId(event.data)
  const last = current.at(-1)
  if (isAssistantChunk && last?.role === 'assistant' && last.streaming
    && (externalId === undefined || externalId === last.id)) {
    return [...current.slice(0, -1), {
      ...last,
      text: `${last.text}${text}`,
      endSeq: event.seq,
      streaming: true,
    }]
  }
  if (isAssistantMessage && last?.role === 'assistant' && last.streaming
    && (externalId === undefined || externalId === last.id)) {
    return [...current.slice(0, -1), {
      ...last,
      text,
      endSeq: event.seq,
      streaming: false,
    }]
  }
  const matchingIndex = externalId === undefined
    ? -1
    : current.findLastIndex(item => item.id === externalId && item.role === role)
  if (matchingIndex >= 0 && isAssistantMessage) {
    const matching = current[matchingIndex]
    if (matching === undefined) return current
    return [...current.slice(0, matchingIndex), {
      ...matching,
      text,
      endSeq: event.seq,
      streaming: false,
    }, ...current.slice(matchingIndex + 1)]
  }
  return [...current, {
    id: externalId ?? `${role}-${event.seq}`,
    role,
    text,
    startSeq: event.seq,
    endSeq: event.seq,
    time: event.time,
    streaming: isAssistantChunk,
  }]
}

export function applySessionFrame(
  current: SessionProjection | undefined,
  frame: ProtocolFrame,
): ProjectionUpdate {
  if (frame.kind === 'session.snapshot') {
    if (current !== undefined && frame.payload.projection.lastSeq < current.lastSeq) {
      return { result: 'ignored', projection: current }
    }
    const snapshot = snapshotProjection(frame)
    if (current === undefined) return { result: 'applied', projection: snapshot }
    return {
      result: 'applied',
      projection: {
        ...snapshot,
        lastSeq: current.lastSeq,
        conversationVersion: current.conversationVersion ?? CONVERSATION_PROJECTION_VERSION,
        conversation: current.conversation ?? [],
        historyLoaded: current.historyLoaded ?? false,
        recentEvents: current.recentEvents ?? [],
      },
    }
  }
  if (frame.kind !== 'session.event') return { result: 'ignored', projection: current }
  if (current === undefined) return { result: 'gap', projection: undefined, expectedSeq: 0 }
  const expectedSeq = current.lastSeq + 1
  if (frame.seq < expectedSeq) return { result: 'duplicate', projection: current }
  if (frame.seq > expectedSeq) return { result: 'gap', projection: current, expectedSeq }

  const approval = approvalFromEvent(frame)
  const clearsApproval = frame.eventType === 'approval/response' || frame.eventType === 'approval/decided'
  const event: ProjectedEvent = {
    seq: frame.seq,
    type: frame.payload.event.type,
    time: frame.payload.event.time,
    data: frame.payload.event.data,
  }
  return {
    result: 'applied',
    projection: {
      ...current,
      status: statusFromEvent(frame) ?? current.status,
      lastSeq: frame.seq,
      lastActivityAt: Math.max(current.lastActivityAt, frame.payload.event.time),
      unresolvedApproval: approval ?? (clearsApproval ? null : current.unresolvedApproval),
      conversation: applyConversationEvent(current.conversation ?? [], event),
      recentEvents: [...(current.recentEvents ?? []), event].slice(-50),
    },
  }
}

export function createMemoryProjectionStore(): SessionProjectionStore {
  const sessions = new Map<string, SessionProjection>()
  return {
    upsert(session) {
      const current = sessions.get(session.sessionId)
      if (current === undefined || session.lastSeq >= current.lastSeq) sessions.set(session.sessionId, session)
    },
    replace(session) {
      sessions.set(session.sessionId, session)
    },
    list() {
      return [...sessions.values()].sort((left, right) => right.lastActivityAt - left.lastActivityAt)
    },
    get(sessionId) {
      return sessions.get(sessionId)
    },
    apply(frame) {
      const current = frame.sessionId === undefined ? undefined : sessions.get(frame.sessionId)
      const update = applySessionFrame(current, frame)
      if (update.projection !== undefined && update.result === 'applied') sessions.set(update.projection.sessionId, update.projection)
      return update
    },
  }
}
