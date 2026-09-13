import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

import {
  SETTINGS_HEADER,
  SETTINGS_PATH,
  apply,
  createReadyFrame,
  createRemoteSyncStatusFrame,
  createShowSettingsFrame,
  readControlConfig,
} from '../packages/runtime-bridge/src/index.js'
import controlSchema from '../runtime/control-protocol.schema.json' with { type: 'json' }

const variables = [
  'HARNDOCK_CONTROL_ENDPOINT',
  'HARNDOCK_CONTROL_NONCE',
  'HARNDOCK_RUNTIME_VERSION',
  'HARNDOCK_RUNTIME_API',
  'HARNDOCK_HARNESS_COMMIT',
]
const original = new Map(variables.map(variable => [variable, process.env[variable]]))
let directory
let server
let dispose
let settingsRoute
const contextListeners = new Map()

try {
  for (const variable of variables) delete process.env[variable]
  assert.equal(readControlConfig(), null)
  process.env.HARNDOCK_RUNTIME_API = '1'
  assert.throws(() => readControlConfig(), /complete control environment/)

  directory = await mkdtemp(join(tmpdir(), 'harndock-runtime-bridge-'))
  const socketPath = join(directory, 'control.sock')
  Object.assign(process.env, {
    HARNDOCK_CONTROL_ENDPOINT: `unix:${socketPath}`,
    HARNDOCK_CONTROL_NONCE: '0123456789abcdef'.repeat(4),
    HARNDOCK_RUNTIME_VERSION: '2026.08.17.1',
    HARNDOCK_RUNTIME_API: '1',
    HARNDOCK_HARNESS_COMMIT: 'cd5ef8148158c3a752a658978873241fdf8e2bbc',
  })

  const frames = []
  const frameWaiters = []
  const receiveFrame = () => frames.length > 0
    ? Promise.resolve(frames.shift())
    : new Promise((resolve, reject) => frameWaiters.push({ resolve, reject }))
  await new Promise((resolve, reject) => {
    server = createServer(connection => {
      let body = ''
      connection.setEncoding('utf8')
      connection.on('data', chunk => { body += chunk })
      connection.once('end', () => {
        try {
          const frame = JSON.parse(body.trimEnd())
          const waiter = frameWaiters.shift()
          if (waiter === undefined) frames.push(frame)
          else waiter.resolve(frame)
        } catch (error) {
          const waiter = frameWaiters.shift()
          if (waiter !== undefined) waiter.reject(error)
          else reject(error)
        }
      })
    })
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })

  const webServer = {
    port: 43_127,
    register(route) {
      settingsRoute = route
      return () => { settingsRoute = undefined }
    },
  }

  apply({
    get(service) {
      if (service === 'webServer') return webServer
      if (service === 'connection') return { authenticatedUrl: value => `${value}/?token=${'a'.repeat(43)}` }
      if (service === 'loader') return { await: () => Promise.resolve() }
      return undefined
    },
    effect(effect) { dispose = effect() },
    on(event, listener) { contextListeners.set(event, listener) },
  })
  const frame = await receiveFrame()
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(controlSchema)
  assert.equal(validate(frame), true, JSON.stringify(validate.errors, undefined, 2))
  assert.deepEqual(frame, createReadyFrame(readControlConfig(), 43_127, `http://127.0.0.1:43127/?token=${'a'.repeat(43)}`))
  assert.throws(() => createReadyFrame(readControlConfig(), 65_536), /invalid Web port/)
  assert.equal(settingsRoute.path, SETTINGS_PATH)

  let responseStatus
  await settingsRoute.handler({
    method: 'POST',
    url: SETTINGS_PATH,
    headers: {
      origin: 'http://127.0.0.1:43127',
      [SETTINGS_HEADER]: 'show-settings',
    },
  }, {
    writeHead(status) { responseStatus = status },
    end() {},
  })
  assert.equal(responseStatus, 204)
  const settingsFrame = await receiveFrame()
  assert.equal(validate(settingsFrame), true, JSON.stringify(validate.errors, undefined, 2))
  assert.deepEqual(settingsFrame, createShowSettingsFrame(readControlConfig()))

  contextListeners.get('remote-sync/status')('connected')
  const connectedFrame = await receiveFrame()
  assert.equal(validate(connectedFrame), true, JSON.stringify(validate.errors, undefined, 2))
  assert.equal(connectedFrame.connectionState, 'connected')
  assert.equal(connectedFrame.lastHeartbeatAtMs, null)

  const heartbeatAt = new Date(Date.now() - 1_000).toISOString()
  contextListeners.get('remote-sync/heartbeat')(heartbeatAt)
  const heartbeatFrame = await receiveFrame()
  assert.equal(validate(heartbeatFrame), true, JSON.stringify(validate.errors, undefined, 2))
  assert.equal(heartbeatFrame.lastHeartbeatAtMs, Date.parse(heartbeatAt))
  assert.deepEqual(
    heartbeatFrame,
    createRemoteSyncStatusFrame(
      readControlConfig(),
      'connected',
      Date.parse(heartbeatAt),
      heartbeatFrame.observedAtMs,
    ),
  )
  assert.throws(
    () => createRemoteSyncStatusFrame(readControlConfig(), 'invalid'),
    /invalid remote sync state/,
  )

  responseStatus = undefined
  await settingsRoute.handler({ method: 'POST', url: SETTINGS_PATH, headers: {} }, {
    writeHead(status) { responseStatus = status },
    end() {},
  })
  assert.equal(responseStatus, 403)

  console.log('Runtime bridge verified over a real Unix socket')
} finally {
  dispose?.()
  if (server !== undefined) await new Promise(resolve => server.close(resolve))
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  for (const [variable, value] of original) {
    if (value === undefined) delete process.env[variable]
    else process.env[variable] = value
  }
}
