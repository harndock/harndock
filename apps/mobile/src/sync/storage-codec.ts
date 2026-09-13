import { toStoredCommandState, type StoredCommandState } from './command-state'
import { CONVERSATION_PROJECTION_VERSION, type SessionProjection } from './projection'

export function parseStoredCommandState(json: string): StoredCommandState | undefined {
  try {
    const value: unknown = JSON.parse(json)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.commandId !== 'string'
      || typeof record.sessionId !== 'string'
      || typeof record.commandType !== 'string'
      || typeof record.baseSeq !== 'number'
      || !Number.isSafeInteger(record.baseSeq)
      || record.baseSeq < -1
      || typeof record.status !== 'string'
      || typeof record.expiresAt !== 'string') return undefined
    return toStoredCommandState({
      commandId: record.commandId,
      sessionId: record.sessionId,
      commandType: record.commandType as StoredCommandState['commandType'],
      baseSeq: record.baseSeq,
      status: record.status as StoredCommandState['status'],
      expiresAt: record.expiresAt,
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(typeof record.acceptedAt === 'string' ? { acceptedAt: record.acceptedAt } : {}),
      ...(typeof record.completedAt === 'string' ? { completedAt: record.completedAt } : {}),
    })
  } catch {
    return undefined
  }
}

export function parseSessionProjection(json: string): SessionProjection | undefined {
  try {
    const value: unknown = JSON.parse(json)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const projection = value as SessionProjection
    if (typeof projection.sessionId !== 'string' || typeof projection.lastSeq !== 'number'
      || !Number.isSafeInteger(projection.lastSeq) || projection.lastSeq < -1) return undefined
    const conversationIsCurrent = projection.conversationVersion === CONVERSATION_PROJECTION_VERSION
    return {
      ...projection,
      conversationVersion: CONVERSATION_PROJECTION_VERSION,
      conversation: conversationIsCurrent && Array.isArray(projection.conversation) ? projection.conversation : [],
      historyLoaded: conversationIsCurrent && projection.historyLoaded === true,
    }
  } catch {
    return undefined
  }
}
