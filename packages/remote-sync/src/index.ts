import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import WebSocket from 'ws'
import {
  createPcRegistrationProof,
  isProtocolFrame,
  PROTOCOL_VERSION,
  type ClientHelloFrame,
  type CommandSubmitFrame,
  type CommandStatusFrame,
  type PcChallengeFrame,
  type PcRegisterFrame,
  type Platform,
  type ProtocolFrame,
  type SessionEventFrame,
  type SessionSnapshotFrame,
} from '@harndock/sync-protocol'

export const name = 'harndock-remote-sync'
export const inject = ['sessionPersistence', 'typertGateway']

export interface ConnectorEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

export interface PersistedSessionHeader {
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
}

export interface PersistedSessionSnapshot {
  header: PersistedSessionHeader
  revision: unknown
}

export interface ConnectorPersistence {
  listSnapshots(signal?: AbortSignal): Promise<readonly PersistedSessionSnapshot[]>
  readFrom(sessionId: string, fromSeq: number, signal?: AbortSignal): Promise<{
    meta: PersistedSessionHeader
    events: readonly ConnectorEvent[]
  }>
}

export interface ConnectorOutbox {
  enqueue(frame: ProtocolFrame): Promise<void>
  pending(): Promise<readonly ProtocolFrame[]>
  acknowledge(frameId: string, sessionId: string, seq: number): Promise<boolean>
  getCursor(sessionId: string): Promise<number>
  setCursor(sessionId: string, seq: number): Promise<void>
}

interface OutboxState {
  frames: ProtocolFrame[]
  cursors: Record<string, number>
}

const emptyState = (): OutboxState => ({ frames: [], cursors: {} })

function matchesPendingFrame(left: ProtocolFrame, right: ProtocolFrame): boolean {
  if (left.frameId === right.frameId) return true
  return left.kind === 'session.event'
    && right.kind === 'session.event'
    && left.runtimeId === right.runtimeId
    && left.sessionId === right.sessionId
    && left.seq === right.seq
}

function acknowledgedSeq(frame: ProtocolFrame, sessionId: string): number | undefined {
  if (frame.kind === 'session.event' && frame.sessionId === sessionId) return frame.seq
  if (frame.kind === 'session.snapshot' && frame.sessionId === sessionId) {
    return frame.payload.projection.lastSeq
  }
  return undefined
}

function orderPendingFrames(frames: readonly ProtocolFrame[]): ProtocolFrame[] {
  const eventsBySession = new Map<string, SessionEventFrame[]>()
  for (const frame of frames) {
    if (frame.kind !== 'session.event') continue
    const events = eventsBySession.get(frame.sessionId) ?? []
    events.push(frame)
    eventsBySession.set(frame.sessionId, events)
  }
  for (const events of eventsBySession.values()) events.sort((left, right) => left.seq - right.seq)

  const emittedSessions = new Set<string>()
  const ordered: ProtocolFrame[] = []
  for (const frame of frames) {
    if (frame.kind !== 'session.event') {
      ordered.push(frame)
      continue
    }
    if (emittedSessions.has(frame.sessionId)) continue
    emittedSessions.add(frame.sessionId)
    ordered.push(...(eventsBySession.get(frame.sessionId) ?? []))
  }
  return ordered
}

export class MemoryOutbox implements ConnectorOutbox {
  private readonly state: OutboxState = emptyState()

  async enqueue(frame: ProtocolFrame): Promise<void> {
    if (!this.state.frames.some(existing => matchesPendingFrame(existing, frame))) this.state.frames.push(frame)
  }

  async pending(): Promise<readonly ProtocolFrame[]> {
    return this.state.frames.slice()
  }

  async acknowledge(frameId: string, sessionId: string, seq: number): Promise<boolean> {
    const frame = this.state.frames.find(candidate => candidate.frameId === frameId)
    if (frame === undefined || acknowledgedSeq(frame, sessionId) !== seq) return false
    this.state.frames = this.state.frames.filter(candidate => candidate.frameId !== frameId)
    this.state.cursors[sessionId] = Math.max(this.state.cursors[sessionId] ?? -1, seq)
    return true
  }

  async getCursor(sessionId: string): Promise<number> {
    return this.state.cursors[sessionId] ?? -1
  }

  async setCursor(sessionId: string, seq: number): Promise<void> {
    this.state.cursors[sessionId] = Math.max(this.state.cursors[sessionId] ?? -1, seq)
  }
}

export class JsonFileOutbox implements ConnectorOutbox {
  private state: OutboxState = emptyState()
  private loaded: Promise<void>
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    try {
      this.state = JSON.parse(await readFile(this.path, 'utf8')) as OutboxState
      if (!Array.isArray(this.state.frames) || this.state.cursors === undefined) this.state = emptyState()
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = emptyState()
    }
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state)
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      await writeFile(temporary, `${snapshot}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    await this.writeChain
  }

  async enqueue(frame: ProtocolFrame): Promise<void> {
    await this.loaded
    if (!this.state.frames.some(existing => matchesPendingFrame(existing, frame))) {
      this.state.frames.push(frame)
      await this.persist()
    }
  }

  async pending(): Promise<readonly ProtocolFrame[]> {
    await this.loaded
    return this.state.frames.slice()
  }

  async acknowledge(frameId: string, sessionId: string, seq: number): Promise<boolean> {
    await this.loaded
    const frame = this.state.frames.find(candidate => candidate.frameId === frameId)
    if (frame === undefined || acknowledgedSeq(frame, sessionId) !== seq) return false
    this.state.frames = this.state.frames.filter(candidate => candidate.frameId !== frameId)
    this.state.cursors[sessionId] = Math.max(this.state.cursors[sessionId] ?? -1, seq)
    await this.persist()
    return true
  }

  async getCursor(sessionId: string): Promise<number> {
    await this.loaded
    return this.state.cursors[sessionId] ?? -1
  }

  async setCursor(sessionId: string, seq: number): Promise<void> {
    await this.loaded
    this.state.cursors[sessionId] = Math.max(this.state.cursors[sessionId] ?? -1, seq)
    await this.persist()
  }
}

export interface ConnectorSocket {
  readyState: number
  send(data: string): void
  close(): void
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: any[]) => void): void
}

export type SocketFactory = (url: string) => ConnectorSocket

export interface ConnectorConfig {
  gatewayUrl: string
  accountId: string
  deviceId: string
  runtimeId: string
  publicKey: string
  signRegistrationProof: (proof: string) => string | Promise<string>
  runtimeVersion: string
  runtimeApi: number
  harnessCommit: string
  outbox?: ConnectorOutbox
  persistence?: ConnectorPersistence
  socketFactory?: SocketFactory
  now?: () => number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  maxInFlightFrames?: number
  platform?: Extract<Platform, 'macos' | 'windows' | 'linux'>
  uploadPolicy?: ConnectorUploadPolicy
  commandHandler?: RemoteSyncCommandHandler
  onStatus?: (status: ConnectorStatus) => void
  onHeartbeat?: (sentAt: string) => void
}

export interface ConnectorUploadPolicy {
  includeToolContent?: boolean
}

export interface RemoteSyncCommandHandler {
  /** Re-checks that the Session and approval are still valid in the local Runtime. */
  authorizeCommand?(command: CommandSubmitFrame): Promise<void>
  prompt(sessionId: string, contentBlocks: readonly { type: 'text'; text: string }[]): Promise<void>
  cancel(sessionId: string): Promise<void>
  respondApproval(sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>
}

interface HarnessTypertGateway {
  invoke(request: {
    namespace: string
    method: string
    args: Readonly<Record<string, unknown>>
    signal?: AbortSignal
  }): Promise<unknown>
}

interface HarnessApprovalRequest {
  agent?: { session?: { id?: string; events?: readonly { type: string; data: unknown }[] } }
  toolName?: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

interface PendingHarnessApproval {
  resolve: (outcome: 'allowed-once' | 'rejected' | 'cancelled') => void
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

function approvalKey(sessionId: string, approvalId: string): string {
  return `${sessionId}\u0000${approvalId}`
}

/** Uses the Host Typert Gateway and the approval waterfall's pending registry. */
export class HarnessRemoteControl implements RemoteSyncCommandHandler {
  private readonly pendingApprovals = new Map<string, PendingHarnessApproval>()

  constructor(
    private readonly api: HarnessTypertGateway,
    private readonly persistence: ConnectorPersistence,
  ) {}

  start(): void {}

  async stop(): Promise<void> {
    for (const pending of this.pendingApprovals.values()) pending.resolve('cancelled')
    this.pendingApprovals.clear()
  }

  private approvalIdOf(request: HarnessApprovalRequest): { sessionId: string; approvalId: string } | undefined {
    const session = request.agent?.session
    if (session?.id === undefined || session.events === undefined) return undefined
    for (const event of [...session.events].reverse()) {
      if (event.type !== 'approval/asked' || typeof event.data !== 'object' || event.data === null) continue
      const data = event.data as { id?: unknown; toolName?: unknown; callId?: unknown; reason?: unknown }
      if (typeof data.id !== 'string' || data.toolName !== request.toolName) continue
      if (request.callId !== undefined && data.callId !== request.callId) continue
      if (request.reason !== undefined && data.reason !== request.reason) continue
      return { sessionId: session.id, approvalId: data.id }
    }
    return undefined
  }

  async answerApproval(request: HarnessApprovalRequest, next: () => Promise<unknown>): Promise<unknown> {
    const identity = this.approvalIdOf(request)
    if (identity === undefined) return next()
    const key = approvalKey(identity.sessionId, identity.approvalId)
    const completed = deferred<'allowed-once' | 'rejected' | 'cancelled'>()
    const pending: PendingHarnessApproval = { resolve: completed.resolve }
    this.pendingApprovals.set(key, pending)
    const onAbort = (): void => completed.resolve('cancelled')
    request.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const downstream = Promise.resolve().then(next)
      return await Promise.race([completed.promise, downstream])
    } finally {
      request.signal?.removeEventListener('abort', onAbort)
      if (this.pendingApprovals.get(key) === pending) this.pendingApprovals.delete(key)
    }
  }

  async authorizeCommand(command: CommandSubmitFrame): Promise<void> {
    let loaded: Awaited<ReturnType<ConnectorPersistence['readFrom']>>
    try {
      loaded = await this.persistence.readFrom(command.sessionId, 0)
    } catch {
      throw new Error(`Session "${command.sessionId}" is no longer available`)
    }
    const localSeq = loaded.events.at(-1)?.seq ?? 0
    if (localSeq !== command.baseSeq) {
      throw new Error(`Session state is stale: expected baseSeq ${localSeq}, received ${command.baseSeq}`)
    }
    if (command.commandType === 'approval.respond') {
      const approvalId = command.payload.approvalId
      if (approvalId === undefined || !this.pendingApprovals.has(approvalKey(command.sessionId, approvalId))) {
        throw new Error(`Approval "${approvalId ?? ''}" is no longer pending`)
      }
    }
  }

  async prompt(sessionId: string, contentBlocks: readonly { type: 'text'; text: string }[]): Promise<void> {
    await this.api.invoke({
      namespace: 'session',
      method: 'prompt',
      args: { request: {
        requestId: randomUUID(), sessionId, mode: 'queue', content: contentBlocks,
      } },
    })
  }

  async cancel(sessionId: string): Promise<void> {
    await this.api.invoke({ namespace: 'session', method: 'cancel', args: { request: { sessionId } } })
  }

  async respondApproval(
    sessionId: string,
    approvalId: string,
    outcome: 'allowed-once' | 'rejected',
  ): Promise<void> {
    const key = approvalKey(sessionId, approvalId)
    const pending = this.pendingApprovals.get(key)
    if (pending === undefined) throw new Error(`Approval "${approvalId}" is no longer pending`)
    pending.resolve(outcome)
  }
}

export type ConnectorStatus = 'stopped' | 'connecting' | 'handshaking' | 'connected' | 'reconnecting'

const OPEN = 1

function frameId(prefix: string, now: number): string {
  return `frame_${prefix}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function hostPlatform(): Extract<Platform, 'macos' | 'windows' | 'linux'> {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

const REDACTED = '[redacted]'
const SENSITIVE_KEYS = new Set([
  'absolutepath',
  'apikey',
  'authorization',
  'cookie',
  'cwd',
  'env',
  'environment',
  'filepath',
  'password',
  'path',
  'privatekey',
  'refreshtoken',
  'secret',
  'token',
])

function redactedData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return REDACTED
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => redactedData(item, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
    return [key, SENSITIVE_KEYS.has(normalized) ? REDACTED : redactedData(item, seen)]
  }))
}

export function sanitizeConnectorEvent(
  event: ConnectorEvent,
  policy: ConnectorUploadPolicy = {},
): ConnectorEvent {
  const data = redactedData(event.data)
  if (policy.includeToolContent || data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ...event, data }
  }
  const sanitized = { ...data } as Record<string, unknown>
  if (event.type === 'tool/call' && 'arguments' in sanitized) sanitized.arguments = REDACTED
  if (event.type === 'tool/result') {
    if ('message' in sanitized) sanitized.message = REDACTED
    if ('meta' in sanitized) sanitized.meta = REDACTED
  }
  return { ...event, data: sanitized }
}

function validateGatewayUrl(value: string): void {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) {
    throw new Error('remote sync gateway must use wss (ws is allowed only for loopback development)')
  }
}

function projectionFromEvents(events: readonly ConnectorEvent[], now: number): {
  title?: string
  status: SessionSnapshotFrame['payload']['projection']['status']
  lastActivityAt: number
  unresolvedApproval: SessionSnapshotFrame['payload']['projection']['unresolvedApproval']
} {
  let title: string | undefined
  let status: SessionSnapshotFrame['payload']['projection']['status'] = 'idle'
  let lastActivityAt = events.at(-1)?.time ?? now
  let unresolvedApproval: SessionSnapshotFrame['payload']['projection']['unresolvedApproval'] = null
  for (const event of events) {
    lastActivityAt = Math.max(lastActivityAt, event.time)
    const data = event.data !== null && typeof event.data === 'object' && !Array.isArray(event.data)
      ? event.data as Record<string, unknown>
      : {}
    if (event.type === 'session/title' && typeof data.title === 'string' && data.title.length > 0) title = data.title
    if (event.type === 'turn/start') status = 'running'
    if (event.type === 'approval/asked' && typeof data.id === 'string' && typeof data.toolName === 'string') {
      status = 'waiting'
      unresolvedApproval = { approvalId: data.id, toolName: data.toolName }
    }
    if (event.type === 'approval/decided') {
      unresolvedApproval = null
      status = 'running'
    }
    if (event.type === 'turn/end') {
      const reason = data.reason !== null && typeof data.reason === 'object'
        ? (data.reason as { kind?: unknown }).kind
        : undefined
      status = reason === 'completed' ? 'completed' : reason === 'aborted' ? 'cancelled' : 'failed'
      unresolvedApproval = null
    }
  }
  return { ...(title === undefined ? {} : { title }), status, lastActivityAt, unresolvedApproval }
}

function sessionSnapshot(
  session: PersistedSessionHeader,
  events: readonly ConnectorEvent[],
  now: number,
  config: Pick<ConnectorConfig, 'accountId' | 'deviceId' | 'runtimeId'>,
): SessionSnapshotFrame {
  const lastSeq = events.at(-1)?.seq ?? -1
  const projection = projectionFromEvents(events, now)
  return {
    protocolVersion: PROTOCOL_VERSION,
    frameId: frameId('snapshot', now),
    kind: 'session.snapshot',
    accountId: config.accountId,
    deviceId: config.deviceId,
    runtimeId: config.runtimeId,
    sessionId: session.id,
    sentAt: new Date(now).toISOString(),
    payload: {
      header: {
        title: projection.title ?? session.id,
        ...(session.cwd === undefined ? {} : { cwdLabel: basename(session.cwd) }),
        createdAt: session.createdAt,
        parentSessionId: session.parentSession ?? null,
      },
      projection: {
        status: projection.status,
        lastSeq,
        lastActivityAt: projection.lastActivityAt,
        unresolvedApproval: projection.unresolvedApproval,
      },
    },
  }
}

function sessionEvent(
  sessionId: string,
  event: ConnectorEvent,
  now: number,
  config: Pick<ConnectorConfig, 'accountId' | 'deviceId' | 'runtimeId'>,
): SessionEventFrame {
  return {
    protocolVersion: PROTOCOL_VERSION,
    frameId: frameId('event', now),
    kind: 'session.event',
    accountId: config.accountId,
    deviceId: config.deviceId,
    runtimeId: config.runtimeId,
    sessionId,
    seq: event.seq,
    eventType: event.type,
    sentAt: new Date(now).toISOString(),
    payload: { event },
  }
}

export class RemoteSyncConnector {
  private readonly outbox: ConnectorOutbox
  private readonly now: () => number
  private readonly socketFactory: SocketFactory
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly maxInFlightFrames: number
  private socket: ConnectorSocket | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private heartbeatIntervalMs = 30_000
  private serverHelloAccepted = false
  private registrationStarted = false
  private handshakeComplete = false
  private stopped = true
  private reconnectAttempt = 0
  private flushInFlight: Promise<void> | undefined
  private readonly inFlightFrameIds = new Set<string>()
  private publicationChain: Promise<void> = Promise.resolve()
  private readonly snapshottedSessions = new Set<string>()
  private readonly commandStates = new Map<string, 'received' | 'executing' | 'completed' | 'rejected' | 'expired'>()

  constructor(private readonly config: ConnectorConfig) {
    validateGatewayUrl(config.gatewayUrl)
    this.outbox = config.outbox ?? new MemoryOutbox()
    this.now = config.now ?? Date.now
    this.socketFactory = config.socketFactory ?? (url => new WebSocket(url) as unknown as ConnectorSocket)
    this.reconnectBaseMs = config.reconnectBaseMs ?? 500
    this.reconnectMaxMs = config.reconnectMaxMs ?? 30_000
    this.maxInFlightFrames = config.maxInFlightFrames ?? 16
    if (!Number.isSafeInteger(this.maxInFlightFrames) || this.maxInFlightFrames < 1) {
      throw new Error('maxInFlightFrames must be a positive integer')
    }
  }

  private reportAsyncFailure(operation: string, error: unknown): void {
    console.error(
      `harndock remote sync ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  async start(): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    await this.syncPersistedSessions()
    this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer)
    this.reconnectTimer = undefined
    this.heartbeatTimer = undefined
    this.socket?.close()
    this.socket = undefined
    this.inFlightFrameIds.clear()
    this.config.onStatus?.('stopped')
  }

  async publishSessionEvent(
    sessionId: string,
    event: ConnectorEvent,
    session?: PersistedSessionHeader,
  ): Promise<void> {
    return this.queuePublication(async () => {
      const cursor = await this.outbox.getCursor(sessionId)
      if (event.seq <= cursor) return
      if (!this.snapshottedSessions.has(sessionId) && session !== undefined) {
        await this.outbox.enqueue(sessionSnapshot(session, [], this.now(), this.config))
        this.snapshottedSessions.add(sessionId)
      }
      if (event.seq > cursor + 1 && this.config.persistence !== undefined) {
        const loaded = await this.config.persistence.readFrom(sessionId, cursor + 1)
        let expectedSeq = cursor + 1
        for (const persistedEvent of loaded.events) {
          if (persistedEvent.seq < expectedSeq) continue
          if (persistedEvent.seq > event.seq) break
          if (persistedEvent.seq !== expectedSeq) {
            throw new Error(`persisted Session history has a gap before seq ${String(event.seq)}`)
          }
          await this.outbox.enqueue(sessionEvent(
            sessionId,
            sanitizeConnectorEvent(persistedEvent, this.config.uploadPolicy),
            this.now(),
            this.config,
          ))
          expectedSeq += 1
        }
        if (expectedSeq <= event.seq) {
          throw new Error(`persisted Session history did not recover seq ${String(expectedSeq)}`)
        }
      }
      const frame = sessionEvent(
        sessionId,
        sanitizeConnectorEvent(event, this.config.uploadPolicy),
        this.now(),
        this.config,
      )
      await this.outbox.enqueue(frame)
      await this.flush()
    })
  }

  async publishSessionSnapshot(
    session: PersistedSessionHeader,
    events: readonly ConnectorEvent[] = [],
  ): Promise<void> {
    return this.queuePublication(async () => {
      if (this.snapshottedSessions.has(session.id)) return
      await this.outbox.enqueue(sessionSnapshot(session, events, this.now(), this.config))
      this.snapshottedSessions.add(session.id)
      await this.flush()
    })
  }

  async syncPersistedSessions(): Promise<void> {
    return this.queuePublication(async () => {
      if (this.config.persistence === undefined) return
      const snapshots = await this.config.persistence.listSnapshots()
      for (const snapshot of snapshots) {
        const cursor = await this.outbox.getCursor(snapshot.header.id)
        const loaded = await this.config.persistence.readFrom(snapshot.header.id, 0)
        await this.outbox.enqueue(sessionSnapshot(loaded.meta, loaded.events, this.now(), this.config))
        this.snapshottedSessions.add(snapshot.header.id)
        for (const event of loaded.events) {
          if (event.seq <= cursor) continue
          await this.outbox.enqueue(sessionEvent(
            snapshot.header.id,
            sanitizeConnectorEvent(event, this.config.uploadPolicy),
            this.now(),
            this.config,
          ))
        }
      }
      await this.flush()
    })
  }

  private queuePublication(operation: () => Promise<void>): Promise<void> {
    const task = this.publicationChain.then(operation)
    this.publicationChain = task.catch(() => {})
    return task
  }

  private connect(): void {
    if (this.stopped) return
    this.config.onStatus?.('connecting')
    try {
      this.socket = this.socketFactory(this.config.gatewayUrl)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket.on('open', () => {
      this.reconnectAttempt = 0
      this.config.onStatus?.('handshaking')
      this.sendHello()
    })
    this.socket.on('message', raw => {
      void this.receive(String(raw)).catch(() => this.socket?.close())
    })
    this.socket.on('close', () => this.scheduleReconnect())
    this.socket.on('error', () => this.scheduleReconnect())
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    this.serverHelloAccepted = false
    this.registrationStarted = false
    this.handshakeComplete = false
    this.socket = undefined
    this.inFlightFrameIds.clear()
    this.config.onStatus?.('reconnecting')
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delay)
  }

  private sendHello(): void {
    const frame: ClientHelloFrame = {
      protocolVersion: PROTOCOL_VERSION,
      frameId: frameId('hello', this.now()),
      kind: 'client.hello',
      deviceId: this.config.deviceId,
      runtimeId: this.config.runtimeId,
      sentAt: new Date(this.now()).toISOString(),
      payload: {
        supportedVersions: [PROTOCOL_VERSION],
        client: {
          name: 'harndock-remote-sync',
          version: this.config.runtimeVersion,
          platform: this.config.platform ?? hostPlatform(),
          capabilities: ['session.read', 'session.event.upstream', 'command.downstream'],
        },
      },
    }
    this.send(frame)
  }

  private async sendRegister(challenge: PcChallengeFrame): Promise<void> {
    const proof = createPcRegistrationProof({
      challengeId: challenge.payload.challengeId,
      nonce: challenge.payload.nonce,
      accountId: this.config.accountId,
      deviceId: this.config.deviceId,
      runtimeId: this.config.runtimeId,
    })
    const signature = await this.config.signRegistrationProof(proof)
    const frame: PcRegisterFrame = {
      protocolVersion: PROTOCOL_VERSION,
      frameId: frameId('register', this.now()),
      kind: 'pc.register',
      accountId: this.config.accountId,
      deviceId: this.config.deviceId,
      runtimeId: this.config.runtimeId,
      sentAt: new Date(this.now()).toISOString(),
      payload: {
        challengeId: challenge.payload.challengeId,
        signature,
        publicKey: this.config.publicKey,
        profile: 'desktop',
        runtimeVersion: this.config.runtimeVersion,
        runtimeApi: this.config.runtimeApi,
        harnessCommit: this.config.harnessCommit,
        capabilities: ['session.read', 'session.event.upstream', 'command.downstream'],
      },
    }
    this.send(frame)
  }

  private sendHeartbeat(): void {
    if (this.socket?.readyState !== OPEN) return
    const sentAt = new Date(this.now()).toISOString()
    const frame: ProtocolFrame = {
      protocolVersion: PROTOCOL_VERSION,
      frameId: frameId('heartbeat', this.now()),
      kind: 'pc.heartbeat',
      accountId: this.config.accountId,
      deviceId: this.config.deviceId,
      runtimeId: this.config.runtimeId,
      sentAt,
      payload: { status: 'online', lastSeqBySession: {} },
    }
    this.send(frame)
    this.config.onHeartbeat?.(sentAt)
  }

  private send(frame: ProtocolFrame): void {
    if (this.socket?.readyState !== OPEN) return
    this.socket.send(JSON.stringify(frame))
  }

  private async receive(raw: string): Promise<void> {
    let value: unknown
    try { value = JSON.parse(raw) } catch { return }
    if (!isProtocolFrame(value)) return
    if (value.kind === 'server.hello') {
      if (value.payload.negotiatedVersion !== PROTOCOL_VERSION || this.serverHelloAccepted) return
      this.serverHelloAccepted = true
      this.heartbeatIntervalMs = value.payload.heartbeatIntervalMs
      return
    }
    if (value.kind === 'pc.challenge') {
      if (!this.serverHelloAccepted || this.registrationStarted) return
      if (value.deviceId !== this.config.deviceId
        || value.runtimeId !== this.config.runtimeId
        || Date.parse(value.payload.expiresAt) <= this.now()) {
        this.socket?.close()
        return
      }
      this.registrationStarted = true
      await this.sendRegister(value)
      return
    }
    if (value.kind === 'pc.registered') {
      if (!this.registrationStarted || this.handshakeComplete) return
      if (value.accountId !== this.config.accountId
        || value.deviceId !== this.config.deviceId
        || value.runtimeId !== this.config.runtimeId) {
        this.socket?.close()
        return
      }
      this.handshakeComplete = true
      this.config.onStatus?.('connected')
      this.sendHeartbeat()
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.heartbeatIntervalMs)
      await this.flush()
      return
    }
    if (value.kind === 'event.ack') {
      void this.outbox
        .acknowledge(value.payload.ackedFrameId, value.sessionId, value.seq)
        .then(acknowledged => {
          if (!acknowledged) return
          this.inFlightFrameIds.delete(value.payload.ackedFrameId)
          return this.flush()
        })
        .catch(error => this.reportAsyncFailure('event acknowledgement', error))
      return
    }
    if (value.kind === 'command.submit') {
      await this.handleCommand(value)
    }
  }

  private commandStatus(
    command: CommandSubmitFrame,
    status: CommandStatusFrame['payload']['status'],
    reason?: string,
  ): CommandStatusFrame {
    const now = new Date(this.now()).toISOString()
    return {
      protocolVersion: PROTOCOL_VERSION,
      frameId: frameId('command-status', this.now()),
      kind: 'command.status',
      accountId: this.config.accountId,
      deviceId: this.config.deviceId,
      runtimeId: this.config.runtimeId,
      sessionId: command.sessionId,
      commandId: command.commandId,
      sentAt: now,
      payload: {
        status,
        ...(reason === undefined ? {} : { reason: reason.slice(0, 4096) }),
        ...(status === 'authorized' ? { acceptedAt: now } : {}),
        ...(status === 'completed' ? { completedAt: now } : {}),
      },
    }
  }

  private async handleCommand(command: CommandSubmitFrame): Promise<void> {
    if (!this.handshakeComplete
      || command.accountId !== this.config.accountId
      || command.deviceId !== this.config.deviceId
      || command.runtimeId !== this.config.runtimeId) return
    const previousState = this.commandStates.get(command.commandId)
    if (previousState !== undefined) return
    this.commandStates.set(command.commandId, 'received')
    if (Date.parse(command.expiresAt) <= this.now()) {
      this.commandStates.set(command.commandId, 'expired')
      this.send(this.commandStatus(command, 'expired', 'command expired before reaching the Runtime'))
      return
    }
    if (!Number.isSafeInteger(command.baseSeq) || command.baseSeq < -1 || command.sessionId.length === 0) {
      this.commandStates.set(command.commandId, 'rejected')
      this.send(this.commandStatus(command, 'rejected', 'command identity or baseSeq is invalid'))
      return
    }
    const handler = this.config.commandHandler
    if (handler === undefined) {
      this.commandStates.set(command.commandId, 'rejected')
      this.send(this.commandStatus(command, 'rejected', 'Runtime control handler is unavailable'))
      return
    }
    try {
      if (command.commandType === 'approval.respond'
        && (command.payload.approvalId === undefined
          || command.payload.outcome === undefined)) {
        throw new Error('approvalId and outcome are required')
      }
      if (command.commandType === 'session.prompt'
        && (command.payload.contentBlocks === undefined
          || command.payload.contentBlocks.some(block => block.type !== 'text' || block.text.length === 0))) {
        throw new Error('prompt contentBlocks are invalid')
      }
      await handler.authorizeCommand?.(command)
      this.send(this.commandStatus(command, 'authorized'))
      this.commandStates.set(command.commandId, 'executing')
      if (command.commandType === 'session.prompt') {
        await handler.prompt(command.sessionId, command.payload.contentBlocks ?? [])
      } else if (command.commandType === 'session.cancel') {
        await handler.cancel(command.sessionId)
      } else if (command.payload.approvalId !== undefined && command.payload.outcome !== undefined) {
        await handler.respondApproval(command.sessionId, command.payload.approvalId, command.payload.outcome)
      } else {
        throw new Error('unsupported command type')
      }
      this.commandStates.set(command.commandId, 'completed')
      this.send(this.commandStatus(command, 'completed'))
    } catch (error) {
      this.commandStates.set(command.commandId, 'rejected')
      this.send(this.commandStatus(command, 'rejected', error instanceof Error ? error.message : 'Runtime command failed'))
    }
  }

  private async flush(): Promise<void> {
    if (!this.handshakeComplete) return
    if (this.flushInFlight !== undefined) return this.flushInFlight
    this.flushInFlight = (async () => {
      const pending = orderPendingFrames(await this.outbox.pending())
      const expectedSeqBySession = new Map<string, number>()
      for (const frame of pending) {
        if (this.inFlightFrameIds.size >= this.maxInFlightFrames) break
        if (frame.kind === 'session.event') {
          let expectedSeq = expectedSeqBySession.get(frame.sessionId)
          if (expectedSeq === undefined) {
            expectedSeq = await this.outbox.getCursor(frame.sessionId) + 1
          }
          if (frame.seq !== expectedSeq) continue
          expectedSeqBySession.set(frame.sessionId, expectedSeq + 1)
        }
        if (this.inFlightFrameIds.has(frame.frameId)) continue
        if (!this.handshakeComplete || this.socket?.readyState !== OPEN) break
        this.inFlightFrameIds.add(frame.frameId)
        this.send(frame)
      }
    })().finally(() => { this.flushInFlight = undefined })
    return this.flushInFlight
  }
}

export interface RemoteSyncContext {
  on(event: string, listener: (...args: any[]) => void): unknown
  emit?(event: string, ...args: unknown[]): unknown
  get(name: string): unknown
  effect(factory: () => (() => void) | void, label?: string): void
}

export interface RemoteSyncPluginConfig extends ConnectorConfig {
  outboxPath?: string
}

interface RuntimeConfigFile {
  gatewayUrl: string
  accountId: string
  deviceId: string
  runtimeId: string
  publicKey: string
  platform: Extract<Platform, 'macos' | 'windows' | 'linux'>
  outboxPath: string
}

export function createSignerFromEndpoint(endpoint: string): (proof: string) => Promise<string> {
  if (!endpoint.startsWith('unix:') || endpoint.length <= 5) {
    throw new Error('remote sync signer endpoint must be a Unix socket')
  }
  const path = endpoint.slice('unix:'.length)
  return proof => new Promise((resolve, reject) => {
    const socket = connect(path)
    let body = ''
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(5_000, () => fail(new Error('remote sync signer timed out')))
    socket.on('error', error => fail(error))
    socket.on('data', chunk => {
      body += String(chunk)
      if (!body.endsWith('\n')) return
      try {
        const value = JSON.parse(body) as { signature?: unknown, error?: unknown }
        if (typeof value.signature === 'string' && value.error === undefined) {
          settled = true
          socket.destroy()
          resolve(value.signature)
        } else {
          fail(new Error(typeof value.error === 'string' ? value.error : 'remote sync signer rejected the request'))
        }
      } catch {
        fail(new Error('remote sync signer returned invalid JSON'))
      }
    })
    socket.on('connect', () => {
      socket.end(`${JSON.stringify({ proof })}\n`)
    })
  })
}

function configFromRuntimeEnvironment(): RemoteSyncPluginConfig | undefined {
  const path = process.env.HARNDOCK_REMOTE_SYNC_CONFIG_PATH
  const signerEndpoint = process.env.HARNDOCK_REMOTE_SYNC_SIGN_ENDPOINT
  if (path === undefined || signerEndpoint === undefined) return undefined
  let parsed: RuntimeConfigFile
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as RuntimeConfigFile
  } catch {
    throw new Error('remote sync config is unavailable or invalid')
  }
  const runtimeApi = Number(process.env.HARNDOCK_RUNTIME_API)
  const runtimeVersion = process.env.HARNDOCK_RUNTIME_VERSION
  const harnessCommit = process.env.HARNDOCK_HARNESS_COMMIT
  if (!Number.isInteger(runtimeApi) || runtimeVersion === undefined || harnessCommit === undefined) {
    throw new Error('Runtime identity environment is incomplete for remote sync')
  }
  return {
    ...parsed,
    runtimeVersion,
    runtimeApi,
    harnessCommit,
    signRegistrationProof: createSignerFromEndpoint(signerEndpoint),
  }
}

export function apply(ctx: RemoteSyncContext, config?: RemoteSyncPluginConfig): void {
  const resolved = config ?? configFromRuntimeEnvironment()
  if (resolved === undefined) return
  const persistence = ctx.get('sessionPersistence') as ConnectorPersistence | undefined
  const typertGateway = ctx.get('typertGateway') as HarnessTypertGateway | undefined
  const harnessControl = resolved.commandHandler === undefined
    && ctx.get('remoteControl') === undefined
    && persistence !== undefined
    && typertGateway !== undefined
    ? new HarnessRemoteControl(typertGateway, persistence)
    : undefined
  const commandHandler = resolved.commandHandler
    ?? (ctx.get('remoteControl') as RemoteSyncCommandHandler | undefined)
    ?? harnessControl
  if (harnessControl !== undefined) {
    const on = ctx.on as unknown as (name: string, listener: (...args: unknown[]) => unknown, options: { prepend: true }) => unknown
    on('approval/request', ((request: HarnessApprovalRequest, next: () => Promise<unknown>) => {
      return harnessControl.answerApproval(request, next)
    }) as (...args: unknown[]) => unknown, { prepend: true })
  }
  const outbox = resolved.outbox ?? (resolved.outboxPath === undefined ? new MemoryOutbox() : new JsonFileOutbox(resolved.outboxPath))
  const connector = new RemoteSyncConnector({
    ...resolved,
    outbox,
    persistence,
    commandHandler,
    onStatus: status => {
      resolved.onStatus?.(status)
      ctx.emit?.('remote-sync/status', status)
    },
    onHeartbeat: sentAt => {
      resolved.onHeartbeat?.(sentAt)
      ctx.emit?.('remote-sync/heartbeat', sentAt)
    },
  })
  const reportPublicationFailure = (operation: string, error: unknown): void => {
    console.error(
      `harndock remote sync ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  ctx.on('session/created', (session: { header: PersistedSessionHeader }) => {
    void connector.publishSessionSnapshot(session.header).catch(error => {
      reportPublicationFailure('session snapshot publication', error)
    })
  })
  ctx.on('session/event', (session: { id: string, header: PersistedSessionHeader }, event: ConnectorEvent) => {
    void connector.publishSessionEvent(session.id, event, session.header).catch(error => {
      reportPublicationFailure('session event publication', error)
    })
  })
  ctx.effect(() => {
    harnessControl?.start()
    void connector.start().catch(error => {
      reportPublicationFailure('connector startup', error)
    })
    return () => {
      void connector.stop().catch(error => {
        reportPublicationFailure('connector shutdown', error)
      })
      void harnessControl?.stop().catch(error => {
        reportPublicationFailure('remote control shutdown', error)
      })
    }
  }, 'harndock: remote sync connector')
}
