import type { CommandStatus, CommandType } from '@harndock/sync-protocol'

export interface StoredCommandState {
  commandId: string
  sessionId: string
  commandType: CommandType
  baseSeq: number
  status: CommandStatus
  expiresAt: string
  reason?: string
  acceptedAt?: string
  completedAt?: string
}

export function toStoredCommandState(command: StoredCommandState): StoredCommandState {
  return {
    commandId: command.commandId,
    sessionId: command.sessionId,
    commandType: command.commandType,
    baseSeq: command.baseSeq,
    status: command.status,
    expiresAt: command.expiresAt,
    ...(command.reason === undefined ? {} : { reason: command.reason }),
    ...(command.acceptedAt === undefined ? {} : { acceptedAt: command.acceptedAt }),
    ...(command.completedAt === undefined ? {} : { completedAt: command.completedAt }),
  }
}

export function isTerminalCommandStatus(status: StoredCommandState['status']): boolean {
  return status === 'completed' || status === 'rejected' || status === 'expired' || status === 'unknown'
}

export function shouldResumeCommand(status: StoredCommandState['status']): boolean {
  return !isTerminalCommandStatus(status)
}
