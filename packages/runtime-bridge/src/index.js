import { createConnection } from 'node:net'
import { isAbsolute } from 'node:path'

export const name = 'harndock-runtime-bridge'
export const inject = ['webServer', 'connection']

const CONTROL_ENV = {
  endpoint: 'HARNDOCK_CONTROL_ENDPOINT',
  nonce: 'HARNDOCK_CONTROL_NONCE',
  runtimeVersion: 'HARNDOCK_RUNTIME_VERSION',
  runtimeApi: 'HARNDOCK_RUNTIME_API',
  harnessCommit: 'HARNDOCK_HARNESS_COMMIT',
}
const RUNTIME_VERSION = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]*$/
const NONCE = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const REMOTE_SYNC_CONNECTION_STATES = new Set([
  'stopped',
  'connecting',
  'handshaking',
  'connected',
  'reconnecting',
])
export const SETTINGS_PATH = '/harndock/desktop/settings'
export const SETTINGS_HEADER = 'x-harndock-desktop-action'

export function readControlConfig(environment = process.env) {
  const values = Object.fromEntries(
    Object.entries(CONTROL_ENV).map(([key, variable]) => [key, environment[variable]]),
  )
  const configured = Object.values(values).filter(value => value !== undefined && value !== '')
  if (configured.length === 0) return null
  if (configured.length !== Object.keys(values).length) {
    throw new Error('harndock runtime bridge requires the complete control environment')
  }

  const endpoint = values.endpoint
  if (!endpoint.startsWith('unix:') || !isAbsolute(endpoint.slice('unix:'.length))) {
    throw new Error('HARNDOCK_CONTROL_ENDPOINT must be an absolute unix: endpoint')
  }
  if (!NONCE.test(values.nonce)) throw new Error('HARNDOCK_CONTROL_NONCE must be 64 lowercase hex characters')
  if (!RUNTIME_VERSION.test(values.runtimeVersion)) throw new Error('HARNDOCK_RUNTIME_VERSION is invalid')
  if (values.runtimeApi !== '1') throw new Error('HARNDOCK_RUNTIME_API must be 1')
  if (!COMMIT.test(values.harnessCommit)) throw new Error('HARNDOCK_HARNESS_COMMIT must be 40 lowercase hex characters')

  return {
    endpoint: endpoint.slice('unix:'.length),
    nonce: values.nonce,
    runtimeVersion: values.runtimeVersion,
    runtimeApi: 1,
    harnessCommit: values.harnessCommit,
  }
}

export function createReadyFrame(config, port, authenticatedUrl) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`harndock runtime bridge received an invalid Web port: ${String(port)}`)
  }
  if (typeof authenticatedUrl !== 'string' || authenticatedUrl === '') {
    throw new Error('harndock runtime bridge requires an authenticated Web URL')
  }
  return {
    protocolVersion: 1,
    event: 'ready',
    nonce: config.nonce,
    runtimeVersion: config.runtimeVersion,
    runtimeApi: config.runtimeApi,
    profile: 'desktop',
    harnessCommit: config.harnessCommit,
    url: `http://127.0.0.1:${String(port)}/`,
    authenticatedUrl,
  }
}

export function createShowSettingsFrame(config) {
  return {
    protocolVersion: 1,
    event: 'showSettings',
    nonce: config.nonce,
    runtimeVersion: config.runtimeVersion,
    runtimeApi: config.runtimeApi,
    profile: 'desktop',
    harnessCommit: config.harnessCommit,
  }
}

export function createRemoteSyncStatusFrame(
  config,
  connectionState,
  lastHeartbeatAtMs = null,
  observedAtMs = Date.now(),
) {
  if (!REMOTE_SYNC_CONNECTION_STATES.has(connectionState)) {
    throw new Error(`harndock runtime bridge received an invalid remote sync state: ${String(connectionState)}`)
  }
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    throw new Error('harndock runtime bridge received an invalid observation time')
  }
  if (lastHeartbeatAtMs !== null
    && (!Number.isSafeInteger(lastHeartbeatAtMs) || lastHeartbeatAtMs < 0 || lastHeartbeatAtMs > observedAtMs)) {
    throw new Error('harndock runtime bridge received an invalid heartbeat time')
  }
  return {
    protocolVersion: 1,
    event: 'remoteSyncStatus',
    nonce: config.nonce,
    runtimeVersion: config.runtimeVersion,
    runtimeApi: config.runtimeApi,
    profile: 'desktop',
    harnessCommit: config.harnessCommit,
    connectionState,
    observedAtMs,
    lastHeartbeatAtMs,
  }
}

export function sendControlFrame(endpoint, frame, registerSocket = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    registerSocket(socket)
    socket.setTimeout(5_000)
    socket.once('connect', () => socket.end(`${JSON.stringify(frame)}\n`))
    socket.once('timeout', () => socket.destroy(new Error('control socket timed out')))
    socket.once('error', reject)
    socket.once('close', hadError => {
      if (!hadError) resolve()
    })
  })
}

export function apply(ctx) {
  const control = readControlConfig()
  if (control === null) return

  ctx.effect(() => {
    let disposed = false
    let socket
    let disposeRoute
    let connectionState = 'stopped'
    let lastHeartbeatAtMs = null
    let reportChain = Promise.resolve()
    const queueRemoteSyncReport = () => {
      const frame = createRemoteSyncStatusFrame(control, connectionState, lastHeartbeatAtMs)
      reportChain = reportChain.then(async () => {
        if (disposed) return
        await sendControlFrame(control.endpoint, frame, current => {
          socket = current
          if (disposed) current.destroy()
        })
      }).catch(error => {
        if (!disposed) console.error(`harndock runtime bridge could not report remote sync status: ${error.message}`)
      })
    }
    ctx.on?.('remote-sync/status', status => {
      connectionState = status
      queueRemoteSyncReport()
    })
    ctx.on?.('remote-sync/heartbeat', sentAt => {
      const parsed = Date.parse(sentAt)
      if (!Number.isSafeInteger(parsed) || parsed < 0) return
      lastHeartbeatAtMs = parsed
      queueRemoteSyncReport()
    })
    const report = async () => {
      if (disposed) return
      const webServer = ctx.get('webServer')
      if (webServer === undefined) return
      const expectedOrigin = `http://127.0.0.1:${String(webServer.port)}`
      disposeRoute = webServer.register({
        kind: 'exact',
        path: SETTINGS_PATH,
        handler: async (request, response) => {
          const requestUrl = new URL(request.url ?? SETTINGS_PATH, expectedOrigin)
          if (request.method !== 'POST' || requestUrl.search !== '') {
            response.writeHead(405, { Allow: 'POST' })
            response.end()
            return
          }
          if (request.headers.origin !== expectedOrigin || request.headers[SETTINGS_HEADER] !== 'show-settings') {
            response.writeHead(403)
            response.end()
            return
          }
          try {
            await sendControlFrame(control.endpoint, createShowSettingsFrame(control), current => {
              socket = current
              if (disposed) current.destroy()
            })
            response.writeHead(204, { 'Cache-Control': 'no-store' })
            response.end()
          } catch (error) {
            console.error(`harndock runtime bridge could not open Desktop settings: ${error.message}`)
            response.writeHead(503, { 'Cache-Control': 'no-store' })
            response.end()
          }
        },
      })
      const connection = ctx.get('connection')
      if (connection === undefined) throw new Error('harndock runtime bridge requires the Connection service')
      const authenticatedUrl = connection.authenticatedUrl(`http://127.0.0.1:${String(webServer.port)}`)
      const frame = createReadyFrame(control, webServer.port, authenticatedUrl)
      await sendControlFrame(control.endpoint, frame, current => {
        socket = current
        if (disposed) current.destroy()
      })
    }
    const settled = ctx.get('loader')?.await()
    const pending = settled === undefined ? report() : settled.then(report, () => {})
    void pending.catch(error => {
      console.error(`harndock runtime bridge could not report readiness: ${error.message}`)
    })

    return () => {
      disposed = true
      disposeRoute?.()
      socket?.destroy()
    }
  }, 'harndock: runtime control readiness')
}
