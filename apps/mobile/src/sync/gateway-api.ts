import type { ApprovalOutcome, CommandStatus, CommandType } from '@harndock/sync-protocol'
import { allowedGatewayProtocols, normalizeGatewayOrigin, type GatewayProtocol } from './gateway-url'

export interface RemoteSessionSummary {
  sessionId: string
  runtimeId: string
  runtimeStatus: string
  header: Record<string, unknown>
  projection: Record<string, unknown>
  lastSeq: number
  revision: number
  updatedAt: string
}

export interface SessionPage {
  items: readonly RemoteSessionSummary[]
  nextCursor?: string
}

export interface RemoteDeviceSummary {
  deviceId: string
  deviceType: string
  name: string
  platform: string
  status: string
  lastSeenAt?: string
  runtimeCount: number
  onlineRuntimeCount: number
}

export interface RemoteRuntimeSummary {
  runtimeId: string
  deviceId: string
  profile: string
  status: string
  connectedAt?: string
  lastHeartbeatAt?: string
}

export interface InventoryPage<T> {
  items: readonly T[]
  nextCursor?: string
}

export interface RemoteSessionEvent {
  seq: number
  eventType: string
  event: unknown
  receivedAt: string
}

export interface SessionEventPage {
  session: RemoteSessionSummary
  items: readonly RemoteSessionEvent[]
  hasMore: boolean
  nextAfterSeq?: number
}

export interface CommandPayload {
  contentBlocks?: readonly { type: 'text'; text: string }[]
  approvalId?: string
  outcome?: ApprovalOutcome
}

export interface CommandRecord {
  accountId: string
  deviceId: string
  runtimeId: string
  targetDeviceId: string
  sessionId: string
  commandId: string
  commandType: CommandType
  baseSeq: number
  status: CommandStatus
  payload: CommandPayload
  correlationId: string
  expiresAt: string
  reason?: string
  acceptedAt?: string
  completedAt?: string
}

export interface SubmitCommandInput {
  commandId?: string
  baseSeq: number
  commandType: CommandType
  expiresAt: string
  payload: CommandPayload
}

export class GatewayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'GatewayApiError'
  }
}

export interface GatewayApiOptions {
  baseUrl: string
  accessToken: string
  fetchImpl?: typeof fetch
  allowedProtocols?: readonly GatewayProtocol[]
}

export class GatewayApi {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: GatewayApiOptions) {
    const baseUrl = normalizeGatewayOrigin(options.baseUrl, options.allowedProtocols ?? allowedGatewayProtocols)
    if (baseUrl === undefined) {
      throw new Error('Gateway REST API must use an allowed HTTP(S) origin')
    }
    this.baseUrl = baseUrl
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async listSessions(cursor?: string, limit = 100): Promise<SessionPage> {
    const query = new URLSearchParams({ limit: String(limit) })
    if (cursor !== undefined) query.set('cursor', cursor)
    return this.request<SessionPage>(`/v1/sessions?${query.toString()}`)
  }

  listDevices(): Promise<InventoryPage<RemoteDeviceSummary>> {
    return this.request<InventoryPage<RemoteDeviceSummary>>('/v1/devices')
  }

  listRuntimes(): Promise<InventoryPage<RemoteRuntimeSummary>> {
    return this.request<InventoryPage<RemoteRuntimeSummary>>('/v1/runtimes')
  }

  getSession(sessionId: string): Promise<RemoteSessionSummary> {
    return this.request<RemoteSessionSummary>(`/v1/sessions/${encodeURIComponent(sessionId)}`)
  }

  readEvents(sessionId: string, afterSeq: number, limit = 500): Promise<SessionEventPage> {
    const query = new URLSearchParams({ afterSeq: String(afterSeq), limit: String(limit) })
    return this.request<SessionEventPage>(`/v1/sessions/${encodeURIComponent(sessionId)}/events?${query.toString()}`)
  }

  submitCommand(sessionId: string, input: SubmitCommandInput): Promise<CommandRecord> {
    const commandId = input.commandId ?? createCommandId()
    return this.request<CommandRecord>(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, {
      method: 'POST',
      body: JSON.stringify({ ...input, commandId }),
    })
  }

  getCommand(commandId: string): Promise<CommandRecord> {
    return this.request<CommandRecord>(`/v1/commands/${encodeURIComponent(commandId)}`)
  }

  private async request<T>(path: string, init: { method?: 'POST'; body?: string } = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.options.accessToken}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    })
    const text = await response.text()
    let body: unknown
    try {
      body = text.length === 0 ? undefined : JSON.parse(text)
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const error = body !== null && typeof body === 'object'
        ? (body as { error?: { code?: unknown; message?: unknown } }).error
        : undefined
      const code = typeof error?.code === 'string' ? error.code : undefined
      const message = typeof error?.message === 'string' ? error.message : `Gateway request failed (${response.status})`
      const details = body !== null && typeof body === 'object'
        ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'error'))
        : undefined
      throw new GatewayApiError(message, response.status, code, details)
    }
    if (body === undefined) throw new GatewayApiError('Gateway returned an empty response', response.status)
    return body as T
  }
}

export function createCommandId(): string {
  return `mobile_cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
