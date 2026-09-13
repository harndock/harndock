import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import frameSchema from '../schemas/frame.schema.json' with { type: 'json' }

export const PROTOCOL_VERSION = 1 as const

export const FRAME_KINDS = [
  'client.hello',
  'server.hello',
  'pc.challenge',
  'pc.register',
  'pc.registered',
  'pc.heartbeat',
  'client.subscribe',
  'client.unsubscribe',
  'cursor.resume',
  'event.ack',
  'session.snapshot',
  'session.event',
  'command.submit',
  'command.status',
  'error',
] as const

export type FrameKind = (typeof FRAME_KINDS)[number]
export type Platform = 'ios' | 'android' | 'web' | 'macos' | 'windows' | 'linux'
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'offline'
export type CommandType = 'session.prompt' | 'session.cancel' | 'approval.respond'
export type CommandStatus = 'received' | 'authorized' | 'queued' | 'executing' | 'completed' | 'rejected' | 'expired' | 'unknown'
export type ApprovalOutcome = 'allowed-once' | 'rejected'
export type ProtocolErrorCode =
  | 'authentication_required'
  | 'authorization_denied'
  | 'device_revoked'
  | 'protocol_version_unsupported'
  | 'cursor_gap'
  | 'stale_state'
  | 'duplicate_command'
  | 'runtime_offline'
  | 'command_expired'
  | 'approval_already_decided'
  | 'invalid_frame'
  | 'rate_limited'

export interface ProtocolError {
  code: ProtocolErrorCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

export interface FrameBase<K extends FrameKind = FrameKind> {
  protocolVersion: typeof PROTOCOL_VERSION
  frameId: string
  kind: K
  accountId?: string
  deviceId?: string
  runtimeId?: string
  sessionId?: string
  sentAt: string
}

export interface ClientHelloFrame extends FrameBase<'client.hello'> {
  payload: {
    supportedVersions: number[]
    client: {
      name: string
      version: string
      platform: Platform
      capabilities: string[]
    }
  }
}

export interface ServerHelloFrame extends FrameBase<'server.hello'> {
  payload: {
    connectionId: string
    negotiatedVersion: typeof PROTOCOL_VERSION
    heartbeatIntervalMs: number
    serverTime: string
  }
}

export interface PcChallengeFrame extends FrameBase<'pc.challenge'> {
  deviceId: string
  runtimeId: string
  payload: {
    challengeId: string
    nonce: string
    expiresAt: string
  }
}

export interface PcRegistrationProofInput {
  challengeId: string
  nonce: string
  accountId: string
  deviceId: string
  runtimeId: string
}

export function createPcRegistrationProof(input: PcRegistrationProofInput): string {
  return [
    'dsh-sync-pc-register-v1',
    input.challengeId,
    input.nonce,
    input.accountId,
    input.deviceId,
    input.runtimeId,
  ].join('\n')
}

export interface PcRegisterFrame extends FrameBase<'pc.register'> {
  accountId: string
  deviceId: string
  runtimeId: string
  payload: {
    challengeId: string
    signature: string
    publicKey: string
    profile: 'desktop'
    runtimeVersion: string
    runtimeApi: number
    harnessCommit: string
    capabilities: string[]
  }
}

export interface PcRegisteredFrame extends FrameBase<'pc.registered'> {
  accountId: string
  deviceId: string
  runtimeId: string
  payload: {
    acceptedAt: string
  }
}

export interface PcHeartbeatFrame extends FrameBase<'pc.heartbeat'> {
  accountId: string
  deviceId: string
  runtimeId: string
  payload: {
    status: 'online' | 'degraded'
    lastSeqBySession: Record<string, number>
  }
}

export interface ClientSubscribeFrame extends FrameBase<'client.subscribe'> {
  payload: {
    fromSeq?: number
    includeSnapshot?: boolean
  }
}

export interface ClientUnsubscribeFrame extends FrameBase<'client.unsubscribe'> {
  payload: Record<string, never>
}

export interface CursorResumeFrame extends FrameBase<'cursor.resume'> {
  payload: {
    lastSeq: number
  }
}

export interface EventAckFrame extends FrameBase<'event.ack'> {
  sessionId: string
  seq: number
  payload: {
    ackedFrameId: string
  }
}

export interface SessionSnapshot {
  header: {
    title: string
    cwdLabel?: string
    createdAt: number
    parentSessionId: string | null
  }
  projection: {
    status: SessionStatus
    lastSeq: number
    lastActivityAt: number
    unresolvedApproval: {
      approvalId: string
      toolName: string
    } | null
  }
}

export interface SessionSnapshotFrame extends FrameBase<'session.snapshot'> {
  accountId: string
  deviceId: string
  runtimeId: string
  sessionId: string
  payload: SessionSnapshot
}

export interface SessionEventFrame extends FrameBase<'session.event'> {
  accountId: string
  deviceId: string
  runtimeId: string
  sessionId: string
  seq: number
  eventType: string
  payload: {
    event: {
      type: string
      seq: number
      time: number
      data: unknown
    }
  }
}

export interface CommandSubmitFrame extends FrameBase<'command.submit'> {
  sessionId: string
  commandId: string
  baseSeq: number
  commandType: CommandType
  expiresAt: string
  payload: {
    contentBlocks?: Array<{ type: 'text'; text: string }>
    approvalId?: string
    outcome?: ApprovalOutcome
  }
}

export interface CommandStatusFrame extends FrameBase<'command.status'> {
  sessionId: string
  commandId: string
  payload: {
    status: CommandStatus
    reason?: string
    acceptedAt?: string
    completedAt?: string
  }
}

export interface ErrorFrame extends FrameBase<'error'> {
  payload: ProtocolError
}

export type ProtocolFrame =
  | ClientHelloFrame
  | ServerHelloFrame
  | PcChallengeFrame
  | PcRegisterFrame
  | PcRegisteredFrame
  | PcHeartbeatFrame
  | ClientSubscribeFrame
  | ClientUnsubscribeFrame
  | CursorResumeFrame
  | EventAckFrame
  | SessionSnapshotFrame
  | SessionEventFrame
  | CommandSubmitFrame
  | CommandStatusFrame
  | ErrorFrame

export const protocolSchemas = {
  frame: frameSchema,
} as const

export class ProtocolValidationError extends Error {
  readonly errors: ErrorObject[]

  constructor(errors: ErrorObject[] | null | undefined) {
    super('Protocol frame failed schema validation')
    this.name = 'ProtocolValidationError'
    this.errors = errors ?? []
  }
}

export function createFrameValidator(): ValidateFunction<ProtocolFrame> {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  return ajv.compile<ProtocolFrame>(frameSchema)
}

const validateFrame = createFrameValidator()

export function isProtocolFrame(value: unknown): value is ProtocolFrame {
  return validateFrame(value)
}

export function parseProtocolFrame(value: unknown): ProtocolFrame {
  if (!validateFrame(value)) throw new ProtocolValidationError(validateFrame.errors)
  return value
}
