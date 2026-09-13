import type { SessionProjection } from '../../sync/projection'

export function isSameConversationProjection(
  previous: SessionProjection | undefined,
  next: SessionProjection,
): boolean {
  if (previous === undefined) return false
  return previous.sessionId === next.sessionId
    && previous.runtimeId === next.runtimeId
    && previous.title === next.title
    && previous.cwdLabel === next.cwdLabel
    && previous.createdAt === next.createdAt
    && previous.parentSessionId === next.parentSessionId
    && previous.status === next.status
    && previous.lastSeq === next.lastSeq
    && previous.lastActivityAt === next.lastActivityAt
    && previous.conversationVersion === next.conversationVersion
    && previous.historyLoaded === next.historyLoaded
    && previous.unresolvedApproval?.approvalId === next.unresolvedApproval?.approvalId
    && previous.unresolvedApproval?.toolName === next.unresolvedApproval?.toolName
}
