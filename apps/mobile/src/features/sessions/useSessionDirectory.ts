import { useEffect, useRef, useState } from 'react'
import type { SessionProjection } from '../../sync/projection'
import { loadAccessToken, loadSessionProjections, openSyncDatabase, saveSessionProjection } from '../../services/storage'
import {
  GatewayApi,
  GatewayApiError,
  ViewerSync,
  gatewayWebSocketUrl,
  type RemoteDeviceSummary,
  type RemoteRuntimeSummary,
} from '../../services/transport'
import { message, type MobileMessage } from '../../i18n/messages'
import { formatInventoryError, isAuthenticationFailure } from '../connection/presentation'

export interface SessionDirectoryController {
  readonly ready: boolean
  readonly connectionState: string
  readonly syncMessage: string
  readonly syncMessageDescriptor?: MobileMessage
  readonly sessions: readonly SessionProjection[]
  readonly devices: readonly RemoteDeviceSummary[]
  readonly runtimes: readonly RemoteRuntimeSummary[]
  readonly inventoryMessage: string
  readonly inventoryMessageDescriptor?: MobileMessage
  readonly syncRetrying: boolean
  readonly inventoryRetrying: boolean
  readonly retrySync: () => void
  readonly retryInventory: () => void
}

export function useSessionDirectory(
  gatewayUrl: string,
  onAuthenticationRequired: (error?: unknown) => void,
): SessionDirectoryController {
  const [ready, setReady] = useState(false)
  const [connectionState, setConnectionState] = useState('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncMessageDescriptor, setSyncMessageDescriptor] = useState<MobileMessage | undefined>()
  const [sessions, setSessions] = useState<SessionProjection[]>([])
  const [devices, setDevices] = useState<readonly RemoteDeviceSummary[]>([])
  const [runtimes, setRuntimes] = useState<readonly RemoteRuntimeSummary[]>([])
  const [inventoryMessage, setInventoryMessage] = useState('')
  const [inventoryMessageDescriptor, setInventoryMessageDescriptor] = useState<MobileMessage | undefined>()
  const [syncRetrying, setSyncRetrying] = useState(false)
  const [inventoryRetrying, setInventoryRetrying] = useState(false)
  const viewerRef = useRef<ViewerSync | undefined>(undefined)
  const inventoryRefreshRef = useRef<(() => Promise<void>) | undefined>(undefined)

  const retrySync = (): void => {
    const viewer = viewerRef.current
    const inventoryRefresh = inventoryRefreshRef.current
    if (viewer === undefined && inventoryRefresh === undefined) return
    setSyncRetrying(true)
    void Promise.all([
      viewer === undefined ? Promise.resolve() : viewer.retry(),
      inventoryRefresh === undefined ? Promise.resolve() : inventoryRefresh(),
    ])
      .catch(() => undefined)
      .finally(() => setSyncRetrying(false))
  }

  const retryInventory = (): void => {
    const refresh = inventoryRefreshRef.current
    if (refresh === undefined) return
    setInventoryRetrying(true)
    void refresh().finally(() => setInventoryRetrying(false))
  }

  useEffect(() => {
    const database = openSyncDatabase()
    let active = true
    let viewer: ViewerSync | undefined
    let inventoryTimer: ReturnType<typeof setInterval> | undefined
    let requestingAuthentication = false
    const replayingSessions = new Set<string>()
    const requireAuthentication = (error?: unknown): void => {
      if (requestingAuthentication) return
      requestingAuthentication = true
      if (active) onAuthenticationRequired(error)
    }
    void loadAccessToken().then(token => {
      if (!active) return
      if (token === null) {
        requireAuthentication()
        return
      }
      const api = new GatewayApi({ baseUrl: gatewayUrl, accessToken: token })
      const refreshInventory = async (): Promise<void> => {
        const [deviceResult, runtimeResult] = await Promise.allSettled([api.listDevices(), api.listRuntimes()])
        if (!active) return
        const authenticationFailure = [deviceResult, runtimeResult]
          .find(result => result.status === 'rejected' && isAuthenticationFailure(result.reason))
        if (authenticationFailure !== undefined) {
          requireAuthentication(authenticationFailure.status === 'rejected' ? authenticationFailure.reason : undefined)
          return
        }
        const failures: string[] = []
        const failureCodes: { devices?: string; runtimes?: string } = {}
        if (deviceResult.status === 'fulfilled') setDevices(deviceResult.value.items)
        else {
          failures.push(formatInventoryError('设备', deviceResult.reason))
          failureCodes.devices = inventoryErrorCode(deviceResult.reason)
        }
        if (runtimeResult.status === 'fulfilled') setRuntimes(runtimeResult.value.items)
        else {
          failures.push(formatInventoryError('Runtime', runtimeResult.reason))
          failureCodes.runtimes = inventoryErrorCode(runtimeResult.reason)
        }
        setInventoryMessage(failures.join('；'))
        setInventoryMessageDescriptor(
          failureCodes.devices !== undefined && failureCodes.runtimes !== undefined
            ? message('sessions.inventory.multipleFailed', failureCodes)
            : failureCodes.devices !== undefined
              ? message('sessions.inventory.devicesFailed', { code: failureCodes.devices })
              : failureCodes.runtimes !== undefined
                ? message('sessions.inventory.runtimesFailed', { code: failureCodes.runtimes })
                : undefined,
        )
      }
      inventoryRefreshRef.current = refreshInventory
      void refreshInventory()
      inventoryTimer = setInterval(() => void refreshInventory(), 5_000)
      viewer = new ViewerSync({
        gatewayUrl: gatewayWebSocketUrl(gatewayUrl),
        apiBaseUrl: gatewayUrl,
        accessToken: token,
        storage: {
          loadSessionProjections: () => loadSessionProjections(database),
          saveSessionProjection: projection => saveSessionProjection(database, projection),
        },
        onConnectionState: state => {
          if (!active) return
          setConnectionState(state)
          if (state === 'connected') {
            void refreshInventory()
            void viewerRef.current?.refresh().catch(() => undefined)
          }
        },
        onGap: (sessionId, expectedSeq) => {
          if (!active) return
          replayingSessions.add(sessionId)
          setSyncMessage(`正在补发历史：Session ${sessionId}，从 seq ${expectedSeq} 开始`)
          setSyncMessageDescriptor(message('sessions.sync.replaying', { session: sessionId, seq: expectedSeq }))
        },
        onGapRecovered: sessionId => {
          if (!active) return
          replayingSessions.delete(sessionId)
          if (replayingSessions.size === 0) {
            setSyncMessage('历史补发完成，已恢复实时同步。')
            setSyncMessageDescriptor(message('sessions.sync.recovered'))
          }
        },
        onSyncError: error => {
          if (!active) return
          if (isAuthenticationFailure(error)) {
            requireAuthentication(error)
            return
          }
          if (error instanceof GatewayApiError) {
            setSyncMessage(`同步失败：${error.code ?? error.message}`)
            setSyncMessageDescriptor(message('sessions.sync.failed', { code: error.code ?? 'unknown' }))
          } else {
            setSyncMessage('同步失败，请检查网络和凭据')
            setSyncMessageDescriptor(message('sessions.sync.failedGeneric'))
          }
        },
        onSyncRecovered: () => {
          if (active && replayingSessions.size === 0) {
            setSyncMessage('')
            setSyncMessageDescriptor(undefined)
          }
        },
        onProjections: projections => {
          if (!active) return
          setSessions(current => {
            const next = new Map(current.map(item => [item.sessionId, item]))
            for (const projection of projections) next.set(projection.sessionId, projection)
            return [...next.values()].sort((left, right) => right.lastActivityAt - left.lastActivityAt)
          })
        },
      })
      viewerRef.current = viewer
      const startPromise = viewer.start()
      setSessions(viewer.listSessions())
      setReady(true)
      void startPromise.catch(() => undefined)
    })
    return () => {
      active = false
      if (inventoryTimer !== undefined) clearInterval(inventoryTimer)
      viewer?.stop()
      viewerRef.current = undefined
      inventoryRefreshRef.current = undefined
    }
  }, [gatewayUrl, onAuthenticationRequired])

  return {
    connectionState,
    devices,
    inventoryMessage,
    inventoryMessageDescriptor,
    inventoryRetrying,
    ready,
    retryInventory,
    retrySync,
    runtimes,
    sessions,
    syncMessage,
    syncMessageDescriptor,
    syncRetrying,
  }
}

function inventoryErrorCode(error: unknown): string {
  return error instanceof GatewayApiError ? error.code ?? 'unknown' : 'unknown'
}
