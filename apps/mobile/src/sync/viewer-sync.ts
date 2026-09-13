import type { ProtocolFrame, SessionEventFrame } from '@harndock/sync-protocol'
import { GatewayClient, type GatewayConnectionState } from './gateway-client'
import { GatewayApi, GatewayApiError, type RemoteSessionEvent } from './gateway-api'
import {
  createMemoryProjectionStore,
  projectionFromSummary,
  type SessionProjection,
  type SessionProjectionStore,
} from './projection'
import { ProjectionBatcher } from './projection-batcher'

export interface ViewerSyncStorage {
  loadSessionProjections(): SessionProjection[]
  saveSessionProjection(projection: SessionProjection): void
}

export interface ViewerSyncOptions {
  gatewayUrl: string
  accessToken: string
  storage: ViewerSyncStorage
  apiBaseUrl?: string
  fetchImpl?: typeof fetch
  onConnectionState?: (state: GatewayConnectionState) => void
  onProjection?: (projection: SessionProjection) => void
  onProjections?: (projections: readonly SessionProjection[]) => void
  onGap?: (sessionId: string, expectedSeq: number) => void
  onGapRecovered?: (sessionId: string) => void
  onSyncError?: (error: unknown) => void
  onSyncRecovered?: () => void
}

/**
 * Owns the mobile read-only sync lifecycle: hydrate SQLite, subscribe with
 * per-Session cursors, apply ordered frames, and acknowledge only applied events.
 */
export class ViewerSync {
  private readonly store: SessionProjectionStore = createMemoryProjectionStore()
  private readonly client: GatewayClient
  private readonly api: GatewayApi | undefined
  private readonly recovering = new Set<string>()
  private readonly pendingGaps = new Map<string, number>()
  private readonly projectionBatcher: ProjectionBatcher
  private hydrationPromise: Promise<void> | undefined

  constructor(private readonly options: ViewerSyncOptions) {
    this.projectionBatcher = new ProjectionBatcher(projections => {
      if (this.options.onProjections !== undefined) {
        this.options.onProjections(projections)
      } else {
        for (const projection of projections) this.options.onProjection?.(projection)
      }
    })
    this.api = options.apiBaseUrl === undefined ? undefined : new GatewayApi({
      baseUrl: options.apiBaseUrl,
      accessToken: options.accessToken,
      fetchImpl: options.fetchImpl,
    })
    this.client = new GatewayClient({
      url: options.gatewayUrl,
      accessToken: options.accessToken,
      onState: options.onConnectionState,
      onFrame: frame => this.receive(frame),
    })
  }

  async start(): Promise<void> {
    for (const projection of this.options.storage.loadSessionProjections()) {
      this.store.upsert(projection)
      this.emitProjection(projection)
    }
    if (this.api !== undefined) {
      try {
        await this.refresh()
      } catch {
        // Keep the locally cached projections visible while the stream reconnects.
      }
    }
    this.client.connect()
    this.subscribeToStoredSessions()
  }

  stop(): void {
    this.projectionBatcher.cancel()
    this.client.close()
  }

  listSessions(): SessionProjection[] {
    return this.store.list()
  }

  async refresh(): Promise<void> {
    if (this.api === undefined) return
    if (this.hydrationPromise !== undefined) return this.hydrationPromise
    const hydration = this.hydrateRemoteSessions()
      .then(() => {
        this.subscribeToStoredSessions()
        this.options.onSyncRecovered?.()
      })
      .catch(error => {
        this.options.onSyncError?.(error)
        throw error
      })
    this.hydrationPromise = hydration.finally(() => {
      this.hydrationPromise = undefined
    })
    return this.hydrationPromise
  }

  async retry(): Promise<void> {
    this.client.retry()
    for (const [sessionId, expectedSeq] of [...this.pendingGaps]) {
      await this.recoverGap(sessionId, expectedSeq, false)
    }
    await this.refresh()
  }

  subscribe(sessionId: string): void {
    const projection = this.store.get(sessionId)
    this.client.subscribe(sessionId, projection === undefined ? 0 : projection.lastSeq + 1, projection === undefined)
  }

  private receive(frame: ProtocolFrame): void {
    if (frame.kind === 'error') {
      const authenticationError = frame.payload.code === 'authentication_required'
        || frame.payload.code === 'device_revoked'
      this.options.onSyncError?.(new GatewayApiError(
        frame.payload.message,
        authenticationError ? 401 : 400,
        frame.payload.code,
        frame.payload.details,
      ))
      return
    }
    if (frame.kind !== 'session.snapshot' && frame.kind !== 'session.event') return
    const update = this.store.apply(frame)
    if (update.result === 'gap') {
      if (frame.sessionId !== undefined && update.expectedSeq !== undefined) {
        this.pendingGaps.set(frame.sessionId, update.expectedSeq)
        this.options.onGap?.(frame.sessionId, update.expectedSeq)
        if (this.api === undefined) {
          this.client.subscribe(frame.sessionId, 0, true)
        } else {
          void this.recoverGap(frame.sessionId, update.expectedSeq)
        }
      }
      return
    }
    if (update.projection !== undefined && update.result === 'applied') {
      this.options.storage.saveSessionProjection(update.projection)
      this.emitProjection(update.projection)
      this.client.advance(update.projection.sessionId, update.projection.lastSeq + 1)
    }
  }

  private async hydrateRemoteSessions(): Promise<void> {
    if (this.api === undefined) return
    let cursor: string | undefined
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await this.api.listSessions(cursor)
      for (const summary of page.items) {
        const projection = projectionFromSummary(summary)
        const stored = this.store.get(projection.sessionId)
        const needsHistory = stored === undefined || stored.historyLoaded === false || stored.lastSeq < projection.lastSeq
        if (!needsHistory && stored !== undefined) {
          this.options.storage.saveSessionProjection(stored)
          this.emitProjection(stored)
          continue
        }
        const baseline = stored === undefined
          ? { ...projection, lastSeq: -1, recentEvents: [], conversation: [], historyLoaded: false }
          : stored.historyLoaded !== true
            ? { ...stored, lastSeq: -1, recentEvents: [], conversation: [], historyLoaded: false }
            : stored
        this.store.replace(baseline)
        await this.hydrateSessionHistory(projection.sessionId, projection.lastSeq)
      }
      if (page.nextCursor === undefined) return
      cursor = page.nextCursor
    }
    throw new Error('Gateway returned more than 100 Session pages')
  }

  private async hydrateSessionHistory(sessionId: string, remoteLastSeq: number): Promise<void> {
    if (this.api === undefined) return
    let afterSeq = this.store.get(sessionId)?.lastSeq ?? -1
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const pageStartSeq = afterSeq
      const page = await this.api.readEvents(sessionId, afterSeq)
      for (const item of page.items) {
        const frame = eventFrame(sessionId, page.session.runtimeId, item)
        if (frame === undefined) throw new Error(`Gateway returned an invalid event at seq ${item.seq}`)
        const update = this.store.apply(frame)
        if (update.result === 'gap') {
          throw new Error(`Gateway event history has a gap at seq ${update.expectedSeq ?? item.seq}`)
        }
        if (update.result === 'applied' && update.projection !== undefined) {
          this.options.storage.saveSessionProjection(update.projection)
          this.emitProjection(update.projection)
          afterSeq = update.projection.lastSeq
        }
      }
      if (!page.hasMore) break
      if (page.nextAfterSeq === undefined || page.nextAfterSeq <= pageStartSeq || page.nextAfterSeq < afterSeq) {
        throw new Error('Gateway returned an invalid event page cursor')
      }
      afterSeq = page.nextAfterSeq
      if (pageNumber === 99) throw new Error('Gateway returned more than 100 event pages')
    }
    const current = this.store.get(sessionId)
    if (current === undefined) return
    const hydrated = {
      ...current,
      lastSeq: Math.max(current.lastSeq, remoteLastSeq),
      historyLoaded: true,
    }
    this.store.replace(hydrated)
    this.options.storage.saveSessionProjection(hydrated)
    this.emitProjection(hydrated)
  }

  private subscribeToStoredSessions(): void {
    for (const projection of this.store.list()) {
      this.client.subscribe(projection.sessionId, projection.lastSeq + 1, false)
    }
  }

  private async recoverGap(sessionId: string, expectedSeq: number, subscribeOnSuccess = true): Promise<void> {
    if (this.api === undefined || this.recovering.has(sessionId)) return
    this.recovering.add(sessionId)
    try {
      let afterSeq = expectedSeq - 1
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const pageStartSeq = afterSeq
        const page = await this.api.readEvents(sessionId, afterSeq)
        for (const item of page.items) {
          const frame = eventFrame(sessionId, page.session.runtimeId, item)
          if (frame === undefined) throw new Error(`Gateway returned an invalid event at seq ${item.seq}`)
          const update = this.store.apply(frame)
          if (update.result === 'gap') throw new Error(`Gateway event history still has a gap at seq ${update.expectedSeq ?? item.seq}`)
          if (update.result === 'applied' && update.projection !== undefined) {
            this.options.storage.saveSessionProjection(update.projection)
            this.emitProjection(update.projection)
            this.client.advance(sessionId, update.projection.lastSeq + 1)
          }
        }
        if (!page.hasMore) break
        const appliedSeq = this.store.get(sessionId)?.lastSeq ?? pageStartSeq
        if (page.nextAfterSeq === undefined || page.nextAfterSeq <= pageStartSeq || page.nextAfterSeq < appliedSeq) {
          throw new Error('Gateway returned an invalid event page cursor')
        }
        afterSeq = page.nextAfterSeq
        if (pageNumber === 99) throw new Error('Gateway returned more than 100 event pages')
      }
      const current = this.store.get(sessionId)
      if (current !== undefined && subscribeOnSuccess) this.client.subscribe(sessionId, current.lastSeq + 1, false)
      this.pendingGaps.delete(sessionId)
      this.options.onGapRecovered?.(sessionId)
    } catch (error) {
      this.options.onSyncError?.(error)
      const current = this.store.get(sessionId)
      if (current !== undefined) this.client.subscribe(sessionId, current.lastSeq + 1, false)
    } finally {
      this.recovering.delete(sessionId)
    }
  }

  private emitProjection(projection: SessionProjection): void {
    this.projectionBatcher.enqueue(projection)
  }
}

function eventFrame(sessionId: string, runtimeId: string, item: RemoteSessionEvent): SessionEventFrame | undefined {
  if (item.event === null || typeof item.event !== 'object' || Array.isArray(item.event)) return undefined
  const event = item.event as { type?: unknown; seq?: unknown; time?: unknown; data?: unknown }
  if (typeof event.type !== 'string' || typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || event.seq < 0
    || typeof event.time !== 'number' || !Number.isSafeInteger(event.time) || event.time < 0) return undefined
  return {
    protocolVersion: 1,
    frameId: `rest_event_${sessionId}_${item.seq}`,
    kind: 'session.event',
    accountId: 'gateway',
    deviceId: 'gateway',
    runtimeId,
    sessionId,
    seq: item.seq,
    eventType: item.eventType,
    sentAt: item.receivedAt,
    payload: {
      event: {
        type: event.type,
        seq: event.seq,
        time: event.time,
        data: event.data,
      },
    },
  }
}
