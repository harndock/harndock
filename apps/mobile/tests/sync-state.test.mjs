import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { isTerminalCommandStatus, shouldResumeCommand, toStoredCommandState } from '../src/sync/command-state.ts'
import { applySessionFrame, createMemoryProjectionStore, projectionFromSummary } from '../src/sync/projection.ts'
import { ProjectionBatcher } from '../src/sync/projection-batcher.ts'
import { GatewayClient } from '../src/sync/gateway-client.ts'
import { GatewayApi, GatewayApiError } from '../src/sync/gateway-api.ts'
import { gatewayWebSocketUrl, normalizeGatewayOrigin, parseGatewayProtocols } from '../src/sync/gateway-url.ts'
import { ViewerSync } from '../src/sync/viewer-sync.ts'
import {
  resolveStoredGatewayConfig,
  shouldClearTokenForOriginChange,
} from '../src/features/connection/gatewayOriginState.ts'
import { parseSessionProjection, parseStoredCommandState } from '../src/sync/storage-codec.ts'
import {
  commandStatusLabel,
  commandStatusKey,
  connectionStateLabel,
  connectionStateKey,
  connectionStateNotice,
  connectionStateNoticeKey,
  sessionStatusLabel,
} from '../src/sync/status-labels.ts'
import { describeEvent, describeEventMessage } from '../src/sync/event-summary.ts'

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances = []

  readyState = FakeWebSocket.CONNECTING
  sent = []
  onopen
  onclose
  onerror
  onmessage

  constructor(url, protocols, options) {
    this.url = url
    this.protocols = protocols
    this.options = options
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({ type: 'open' })
  }

  send(value) {
    assert.equal(this.readyState, FakeWebSocket.OPEN)
    this.sent.push(JSON.parse(value))
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ type: 'close' })
  }

  message(value) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}

const originalWebSocket = globalThis.WebSocket
globalThis.WebSocket = FakeWebSocket
after(() => {
  globalThis.WebSocket = originalWebSocket
})
beforeEach(() => {
  FakeWebSocket.instances.length = 0
})

const snapshot = (lastSeq = 4) => ({
  protocolVersion: 1,
  frameId: 'frame_snapshot',
  kind: 'session.snapshot',
  accountId: 'acct_test',
  deviceId: 'gateway',
  runtimeId: 'runtime_test',
  sessionId: 'session_test',
  sentAt: '2026-08-20T00:00:00.000Z',
  payload: {
    header: { title: 'Test', createdAt: 1, parentSessionId: null },
    projection: { status: 'running', lastSeq, lastActivityAt: 10, unresolvedApproval: null },
  },
})

const event = (seq, type = 'assistant/message', data = { text: 'hello' }) => ({
  protocolVersion: 1,
  frameId: `frame_event_${seq}`,
  kind: 'session.event',
  accountId: 'acct_test',
  deviceId: 'gateway',
  runtimeId: 'runtime_test',
  sessionId: 'session_test',
  seq,
  eventType: type,
  sentAt: '2026-08-20T00:00:00.000Z',
  payload: { event: { type, seq, time: 10 + seq, data } },
})

const serverHello = () => ({
  protocolVersion: 1,
  frameId: 'frame_server_hello',
  kind: 'server.hello',
  sentAt: '2026-08-20T00:00:00.000Z',
  payload: {
    connectionId: 'connection_test',
    negotiatedVersion: 1,
    heartbeatIntervalMs: 30_000,
    serverTime: '2026-08-20T00:00:00.000Z',
  },
})

function completeHandshake(socket) {
  socket.open()
  assert.equal(socket.sent[0].kind, 'client.hello')
  socket.message(serverHello())
}

test('projection applies contiguous events and rejects duplicates and gaps', () => {
  const store = createMemoryProjectionStore()
  assert.equal(store.apply(snapshot()).result, 'applied')
  assert.equal(store.apply(event(5)).result, 'applied')
  assert.equal(store.get('session_test').lastSeq, 5)
  assert.equal(store.apply(event(5)).result, 'duplicate')
  const gap = store.apply(event(7))
  assert.equal(gap.result, 'gap')
  assert.equal(gap.expectedSeq, 6)
  assert.equal(store.get('session_test').lastSeq, 5)
})

test('projection accepts the empty-session cursor before the first zero-based event', () => {
  let projection = applySessionFrame(undefined, snapshot(-1)).projection
  const update = applySessionFrame(projection, event(0, 'turn/start', { turn: 1 }))
  assert.equal(update.result, 'applied')
  assert.equal(update.projection.lastSeq, 0)
})

test('projection does not let an upstream snapshot skip its following events', () => {
  let projection = applySessionFrame(undefined, snapshot(2)).projection
  projection = applySessionFrame(projection, event(3, 'user/message', { text: 'before snapshot' })).projection
  const update = applySessionFrame(projection, snapshot(5))
  assert.equal(update.result, 'applied')
  assert.equal(update.projection.lastSeq, 3)
  assert.deepEqual(update.projection.conversation.map(item => item.text), ['before snapshot'])
  const next = applySessionFrame(update.projection, event(4, 'assistant/message', { text: 'after snapshot' }))
  assert.equal(next.result, 'applied')
  assert.equal(next.projection.lastSeq, 4)
})

test('projection tracks and clears one unresolved approval', () => {
  let projection = applySessionFrame(undefined, snapshot()).projection
  projection = applySessionFrame(projection, event(5, 'approval/asked', {
    id: 'approval_test',
    toolName: 'shell',
  })).projection
  assert.deepEqual(projection.unresolvedApproval, { approvalId: 'approval_test', toolName: 'shell' })
  assert.equal(projection.status, 'waiting')
  projection = applySessionFrame(projection, event(6, 'approval/decided', {})).projection
  assert.equal(projection.unresolvedApproval, null)
  assert.equal(projection.status, 'running')
})

test('projection derives terminal status from Harness turn boundaries', () => {
  let projection = applySessionFrame(undefined, snapshot()).projection
  projection = applySessionFrame(projection, event(5, 'turn/start', { turn: 1 })).projection
  assert.equal(projection.status, 'running')
  projection = applySessionFrame(projection, event(6, 'turn/end', {
    turn: 1,
    reason: { kind: 'aborted', reason: { kind: 'user' } },
  })).projection
  assert.equal(projection.status, 'cancelled')
})

test('projection aggregates Harness messages and assistant chunks into conversation', () => {
  let projection = applySessionFrame(undefined, snapshot(-1)).projection
  projection = applySessionFrame(projection, event(0, 'user/message', {
    contentBlocks: [{ type: 'text', text: 'hello Harness' }],
  })).projection
  projection = applySessionFrame(projection, event(1, 'assistant/chunk', {
    messageId: 'assistant_1',
    delta: { text: 'hello ' },
  })).projection
  projection = applySessionFrame(projection, event(2, 'assistant/chunk', {
    messageId: 'assistant_1',
    delta: { text: 'from mobile' },
  })).projection
  projection = applySessionFrame(projection, event(3, 'assistant/message', {
    messageId: 'assistant_1',
    text: 'hello from mobile',
  })).projection
  assert.deepEqual(projection.conversation.map(item => [item.role, item.text, item.streaming]), [
    ['user', 'hello Harness', false],
    ['assistant', 'hello from mobile', false],
  ])

  projection = applySessionFrame(projection, event(4, 'assistant/message', {
    message: {
      id: 'assistant_2',
      content: [
        { type: 'reasoning', text: 'internal reasoning' },
        { type: 'text', text: 'visible answer' },
      ],
    },
  })).projection
  assert.equal(projection.conversation.at(-1).text, 'visible answer')
  assert.equal(projection.conversation.at(-1).text.includes('internal reasoning'), false)
})

test('remote Session summaries use safe projection fallbacks', () => {
  const projection = projectionFromSummary({
    sessionId: 'session_summary',
    runtimeId: 'runtime_test',
    runtimeStatus: 'online',
    header: { title: 'Summary' },
    projection: { status: 'future-status' },
    lastSeq: 8,
    revision: 2,
    updatedAt: '2026-08-20T00:00:00.000Z',
  })
  assert.equal(projection.status, 'offline')
  assert.equal(projection.lastSeq, 8)
  assert.equal(projection.title, 'Summary')
})

test('remote Session summaries expose an offline runtime without hiding terminal state', () => {
  const offline = projectionFromSummary({
    sessionId: 'session_offline',
    runtimeId: 'runtime_test',
    runtimeStatus: 'offline',
    header: { title: 'Offline' },
    projection: { status: 'running', lastActivityAt: 10 },
    lastSeq: 3,
    revision: 1,
    updatedAt: '2026-08-20T00:00:00.000Z',
  })
  assert.equal(offline.status, 'offline')

  const completed = projectionFromSummary({
    sessionId: 'session_completed',
    runtimeId: 'runtime_test',
    runtimeStatus: 'offline',
    header: { title: 'Completed' },
    projection: { status: 'completed', lastActivityAt: 10 },
    lastSeq: 4,
    revision: 1,
    updatedAt: '2026-08-20T00:00:00.000Z',
  })
  assert.equal(completed.status, 'completed')
})

test('persisted command state excludes command payload and identity fields', () => {
  const state = toStoredCommandState({
    accountId: 'acct_secret',
    deviceId: 'device_secret',
    commandId: 'command_test',
    sessionId: 'session_test',
    commandType: 'session.prompt',
    baseSeq: 4,
    status: 'queued',
    expiresAt: '2026-08-20T00:01:00.000Z',
    payload: { contentBlocks: [{ type: 'text', text: 'private prompt' }] },
  })
  assert.deepEqual(state, {
    commandId: 'command_test',
    sessionId: 'session_test',
    commandType: 'session.prompt',
    baseSeq: 4,
    status: 'queued',
    expiresAt: '2026-08-20T00:01:00.000Z',
  })
  assert.equal(JSON.stringify(state).includes('private prompt'), false)
  assert.equal(JSON.stringify(state).includes('acct_secret'), false)
})

test('projection batcher keeps the newest update per Session in one render batch', () => {
  const batches = []
  const batcher = new ProjectionBatcher(batch => batches.push(batch), 60_000)
  batcher.enqueue({ sessionId: 'session_a', lastSeq: 1 })
  batcher.enqueue({ sessionId: 'session_b', lastSeq: 2 })
  batcher.enqueue({ sessionId: 'session_a', lastSeq: 3 })
  batcher.flush()

  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0].map(item => [item.sessionId, item.lastSeq]), [
    ['session_a', 3],
    ['session_b', 2],
  ])
  batcher.cancel()
})

test('projection batcher cancels pending renders when sync stops', () => {
  const batches = []
  const batcher = new ProjectionBatcher(batch => batches.push(batch), 60_000)
  batcher.enqueue({ sessionId: 'session_a', lastSeq: 1 })
  batcher.cancel()
  batcher.flush()
  assert.equal(batches.length, 0)
})

test('storage codecs ignore malformed rows and strip command payloads during recovery', () => {
  const command = parseStoredCommandState(JSON.stringify({
    commandId: 'command_test',
    sessionId: 'session_test',
    commandType: 'session.prompt',
    baseSeq: 4,
    status: 'queued',
    expiresAt: '2026-08-20T00:01:00.000Z',
    payload: { contentBlocks: [{ type: 'text', text: 'secret' }] },
    accountId: 'acct_secret',
  }))
  assert.deepEqual(command, {
    commandId: 'command_test',
    sessionId: 'session_test',
    commandType: 'session.prompt',
    baseSeq: 4,
    status: 'queued',
    expiresAt: '2026-08-20T00:01:00.000Z',
  })
  assert.equal(parseStoredCommandState('{bad-json'), undefined)
  assert.equal(parseStoredCommandState(JSON.stringify({ commandId: 'missing-fields' })), undefined)
  assert.equal(parseStoredCommandState(JSON.stringify({
    commandId: 'bad-seq',
    sessionId: 'session_test',
    commandType: 'session.prompt',
    baseSeq: 1.5,
    status: 'queued',
    expiresAt: '2026-08-20T00:01:00.000Z',
  })), undefined)
})

test('command status policy resumes only non-terminal states', () => {
  const terminal = ['completed', 'rejected', 'expired', 'unknown']
  const resumable = ['received', 'authorized', 'queued', 'executing']
  for (const status of terminal) {
    assert.equal(isTerminalCommandStatus(status), true, status)
    assert.equal(shouldResumeCommand(status), false, status)
  }
  for (const status of resumable) {
    assert.equal(isTerminalCommandStatus(status), false, status)
    assert.equal(shouldResumeCommand(status), true, status)
  }
})

test('status labels expose stable Chinese UI text with safe unknown fallbacks', () => {
  assert.equal(connectionStateLabel('connected'), '已连接')
  assert.equal(connectionStateLabel('reconnecting'), '正在重连')
  assert.equal(connectionStateLabel('future-state'), '未知连接状态')
  assert.match(connectionStateNotice('reconnecting'), /显示本地缓存/)
  assert.equal(connectionStateNotice('connected'), undefined)
  assert.equal(sessionStatusLabel('running'), '运行中')
  assert.equal(sessionStatusLabel('offline'), 'PC 离线')
  assert.equal(sessionStatusLabel('future-status'), '未知 Session 状态')
  assert.equal(commandStatusLabel('queued'), '已排队')
  assert.equal(commandStatusLabel('unknown'), '状态未知')
  assert.equal(commandStatusLabel('future-status'), '未知命令状态')
  assert.equal(connectionStateKey('reconnecting'), 'status.connection.reconnecting')
  assert.equal(connectionStateKey('future-state'), 'status.connection.unknown')
  assert.equal(connectionStateNoticeKey('closed'), 'connection.notice.offline')
  assert.equal(commandStatusKey('queued'), 'command.status.queued')
})

test('event summaries expose safe text without tool results or unknown payloads', () => {
  assert.equal(describeEvent({ type: 'assistant/message', data: { text: 'hello' } }), 'hello')
  assert.equal(describeEvent({
    type: 'assistant/message',
    data: { message: { content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'visible' }] } },
  }), 'visible')
  const toolCall = describeEvent({ type: 'tool/call', data: { name: 'shell', command: 'cat secret.txt' } })
  assert.match(toolCall, /工具调用：shell/)
  assert.equal(toolCall.includes('cat secret.txt'), false)
  assert.equal(describeEvent({ type: 'tool/result', data: { output: 'secret result' } }), '工具结果已收到（结果内容已隐藏）')
  assert.equal(describeEvent({ type: 'approval/request', data: { toolName: 'shell', args: { secret: true } } }), '需要审批：shell')
  assert.equal(describeEvent({ type: 'custom/future', data: { secret: 'payload' } }), '未知事件已保留，当前客户端不展开其 payload。')
  assert.equal(describeEvent({ type: 'session/status', data: { status: 'waiting' } }), '状态：waiting')
  assert.deepEqual(describeEventMessage({ type: 'tool/call', data: { name: 'shell' } }), {
    key: 'timeline.summary.toolCall',
    params: { tool: 'shell' },
  })
  assert.deepEqual(describeEventMessage({ type: 'tool/result', data: { output: 'secret' } }), {
    key: 'timeline.summary.toolResult',
  })
})

test('storage projection codec recovers valid rows and rejects malformed identity', () => {
  const projection = parseSessionProjection(JSON.stringify({ sessionId: 'session_test', lastSeq: 3, status: 'running' }))
  assert.equal(projection.sessionId, 'session_test')
  assert.equal(projection.lastSeq, 3)
  assert.equal(parseSessionProjection(JSON.stringify({ sessionId: 42, lastSeq: 3 })), undefined)
  assert.equal(parseSessionProjection(JSON.stringify({ sessionId: 'session_test', lastSeq: '3' })), undefined)
})

test('GatewayClient sends subscriptions with the latest cursor after reconnect', async () => {
  const states = []
  const client = new GatewayClient({
    url: 'wss://sync.example.test/v1/stream',
    accessToken: 'token_test',
    reconnectBaseMs: 1,
    reconnectMaxMs: 1,
    onState: state => states.push(state),
  })
  client.subscribe('session_test', 4, false)
  client.connect()
  const first = FakeWebSocket.instances[0]
  completeHandshake(first)
  assert.equal(first.options.headers.Authorization, 'Bearer token_test')
  assert.equal(first.sent[1].kind, 'client.subscribe')
  assert.deepEqual(first.sent[1].payload, { fromSeq: 4, includeSnapshot: false })

  client.advance('session_test', 8)
  first.close()
  await new Promise(resolve => setTimeout(resolve, 5))
  const second = FakeWebSocket.instances[1]
  completeHandshake(second)
  assert.deepEqual(second.sent[1].payload, { fromSeq: 8, includeSnapshot: false })
  assert.ok(states.includes('reconnecting'))
  assert.equal(states.at(-1), 'connected')
  client.close()
})

test('GatewayClient manual retry interrupts backoff and preserves the latest cursor', () => {
  const client = new GatewayClient({
    url: 'wss://sync.example.test/v1/stream',
    accessToken: 'token_test',
    reconnectBaseMs: 60_000,
    reconnectMaxMs: 60_000,
  })
  client.subscribe('session_test', 4, false)
  client.connect()
  const first = FakeWebSocket.instances[0]
  completeHandshake(first)
  client.advance('session_test', 9)
  first.close()

  client.retry()
  assert.equal(FakeWebSocket.instances.length, 2)
  const second = FakeWebSocket.instances[1]
  completeHandshake(second)
  assert.deepEqual(second.sent[1].payload, { fromSeq: 9, includeSnapshot: false })
  client.close()
})

test('GatewayClient forwards events without sending PC-only acknowledgements and ignores invalid inbound JSON', () => {
  const states = []
  const frames = []
  const client = new GatewayClient({
    url: 'wss://sync.example.test/v1/stream',
    accessToken: 'token_test',
    onState: state => states.push(state),
    onFrame: frame => frames.push(frame),
  })
  client.connect()
  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  const event = {
    protocolVersion: 1,
    frameId: 'frame_event_5',
    kind: 'session.event',
    accountId: 'acct_test',
    deviceId: 'gateway',
    runtimeId: 'runtime_test',
    sessionId: 'session_test',
    seq: 5,
    eventType: 'assistant/message',
    sentAt: '2026-08-20T00:00:00.000Z',
    payload: { event: { type: 'assistant/message', seq: 5, time: 15, data: { text: 'hello' } } },
  }
  socket.message(event)
  assert.equal(frames.length, 1)
  assert.deepEqual(socket.sent.map(frame => frame.kind), ['client.hello'])
  socket.onmessage?.({ data: '{invalid-json' })
  assert.equal(states.at(-1), 'error')
  client.close()
})

test('GatewayClient close cancels reconnect and reports closed once', async () => {
  const states = []
  const client = new GatewayClient({
    url: 'wss://sync.example.test/v1/stream',
    accessToken: 'token_test',
    reconnectBaseMs: 10,
    reconnectMaxMs: 10,
    onState: state => states.push(state),
  })
  client.connect()
  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  socket.close()
  client.close()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(FakeWebSocket.instances.length, 1)
  assert.equal(states.at(-1), 'closed')
})

test('GatewayApi enforces protocols and addresses inventory and Session resources', async () => {
  assert.throws(
    () => new GatewayApi({ baseUrl: 'http://sync.example.test', accessToken: 'token_test' }),
    /allowed HTTP\(S\) origin/,
  )
  assert.throws(
    () => new GatewayApi({ baseUrl: 'https://sync.example.test/api', accessToken: 'token_test' }),
    /allowed HTTP\(S\) origin/,
  )

  const requests = []
  const api = new GatewayApi({
    baseUrl: 'https://sync.example.test/',
    accessToken: 'token_test',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [], hasMore: false }),
      }
    },
  })
  await api.listDevices()
  await api.listRuntimes()
  await api.listSessions('cursor/next', 2)
  await api.readEvents('session/one', 4, 2)
  assert.equal(requests[0].url, 'https://sync.example.test/v1/devices')
  assert.equal(requests[1].url, 'https://sync.example.test/v1/runtimes')
  assert.equal(requests[2].url, 'https://sync.example.test/v1/sessions?limit=2&cursor=cursor%2Fnext')
  assert.equal(requests[3].url, 'https://sync.example.test/v1/sessions/session%2Fone/events?afterSeq=4&limit=2')
  assert.equal(requests[0].init.headers.Authorization, 'Bearer token_test')
  assert.equal(requests[0].init.headers.Accept, 'application/json')
})

test('GatewayApi supports HTTP when explicitly configured', async () => {
  const requests = []
  const api = new GatewayApi({
    baseUrl: 'http://127.0.0.1:7019/',
    accessToken: 'token_test',
    allowedProtocols: ['http:'],
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [], hasMore: false }),
      }
    },
  })
  await api.listSessions()
  assert.equal(requests[0].url, 'http://127.0.0.1:7019/v1/sessions?limit=100')
})

test('Gateway URL configuration parses protocols and maps HTTP to WS', () => {
  assert.deepEqual(parseGatewayProtocols(undefined), ['https:'])
  assert.deepEqual(parseGatewayProtocols('http,https,http:'), ['http:', 'https:'])
  assert.deepEqual(parseGatewayProtocols('invalid'), ['https:'])
  assert.equal(gatewayWebSocketUrl('http://127.0.0.1:7019/', ['http:']), 'ws://127.0.0.1:7019/v1/stream')
  assert.equal(gatewayWebSocketUrl('https://sync.example.test'), 'wss://sync.example.test/v1/stream')
})

test('Gateway origin normalization rejects paths, credentials, and public HTTP', () => {
  assert.equal(normalizeGatewayOrigin(' https://sync.example.test/ '), 'https://sync.example.test')
  assert.equal(normalizeGatewayOrigin('https://sync.example.test:443'), 'https://sync.example.test')
  assert.equal(normalizeGatewayOrigin('https://sync.example.test/v1'), undefined)
  assert.equal(normalizeGatewayOrigin('https://sync.example.test?debug=1'), undefined)
  assert.equal(normalizeGatewayOrigin('https://sync.example.test#stream'), undefined)
  assert.equal(normalizeGatewayOrigin('https://admin:secret@sync.example.test'), undefined)
  assert.equal(normalizeGatewayOrigin('http://sync.example.test:7019', ['http:']), undefined)
  assert.equal(normalizeGatewayOrigin('http://localhost:7019', ['http:']), 'http://localhost:7019')
  assert.equal(normalizeGatewayOrigin('http://gateway.localhost:7019', ['http:']), 'http://gateway.localhost:7019')
  assert.equal(normalizeGatewayOrigin('http://127.0.0.2:7019', ['http:']), 'http://127.0.0.2:7019')
  assert.equal(normalizeGatewayOrigin('http://[::1]:7019', ['http:']), 'http://[::1]:7019')
  assert.equal(normalizeGatewayOrigin('http://10.0.2.2:7019', ['http:']), 'http://10.0.2.2:7019')
  assert.equal(normalizeGatewayOrigin('http://10.0.3.2:7019', ['http:']), 'http://10.0.3.2:7019')
  assert.equal(normalizeGatewayOrigin('http://127.evil.example:7019', ['http:']), undefined)
  assert.equal(normalizeGatewayOrigin('http://192.168.1.20:7019', ['http:']), undefined)
})

test('GatewayApi refuses public HTTP even when HTTP is explicitly enabled', () => {
  assert.throws(() => new GatewayApi({
    baseUrl: 'http://sync.example.test:7019',
    accessToken: 'token_test',
    allowedProtocols: ['http:'],
  }), /allowed HTTP\(S\) origin/)
})

test('Gateway configuration restore rejects unsafe stored origins with their token', () => {
  assert.deepEqual(resolveStoredGatewayConfig(
    'http://sync.example.test:7019',
    'old_token',
    'https://sync.example.test',
    ['http:', 'https:'],
  ), {
    accessToken: null,
    credentialGatewayOrigin: undefined,
    gatewayOrigin: 'https://sync.example.test',
    persistedGatewayOrigin: undefined,
    storedOriginRejected: true,
  })
  assert.deepEqual(resolveStoredGatewayConfig(
    'http://127.0.0.1:7019/',
    'local_token',
    'https://sync.example.test',
    ['http:', 'https:'],
  ), {
    accessToken: 'local_token',
    credentialGatewayOrigin: 'http://127.0.0.1:7019',
    gatewayOrigin: 'http://127.0.0.1:7019',
    persistedGatewayOrigin: 'http://127.0.0.1:7019',
    storedOriginRejected: false,
  })
  assert.deepEqual(resolveStoredGatewayConfig(
    null,
    'legacy_token',
    'https://sync.example.test',
    ['https:'],
  ), {
    accessToken: 'legacy_token',
    credentialGatewayOrigin: 'https://sync.example.test',
    gatewayOrigin: 'https://sync.example.test',
    persistedGatewayOrigin: undefined,
    storedOriginRejected: false,
  })
})

test('Gateway origin edits clear an existing token before reconnecting', () => {
  assert.equal(shouldClearTokenForOriginChange(
    'https://sync.example.test/',
    'https://sync.example.test',
    true,
    ['https:'],
  ), false)
  assert.equal(shouldClearTokenForOriginChange(
    'https://other.example.test',
    'https://sync.example.test',
    true,
    ['https:'],
  ), true)
  assert.equal(shouldClearTokenForOriginChange(
    'https://other.example.test',
    'https://sync.example.test',
    false,
    ['https:'],
  ), false)
})

test('GatewayApi submits commands with an explicit id and JSON headers', async () => {
  let request
  const api = new GatewayApi({
    baseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    fetchImpl: async (url, init) => {
      request = { url, init }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ commandId: 'command_test', status: 'queued' }),
      }
    },
  })
  const input = {
    commandId: 'command_test',
    baseSeq: 7,
    commandType: 'session.prompt',
    expiresAt: '2026-08-20T00:02:00.000Z',
    payload: { contentBlocks: [{ type: 'text', text: 'hello' }] },
  }
  await api.submitCommand('session/one', input)
  assert.equal(request.url, 'https://sync.example.test/v1/sessions/session%2Fone/commands')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.init.body), input)
})

test('GatewayApi preserves structured Gateway errors and rejects empty responses', async () => {
  let call = 0
  const api = new GatewayApi({
    baseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    fetchImpl: async () => {
      call += 1
      return call === 1
        ? {
            ok: false,
            status: 409,
            text: async () => JSON.stringify({ error: { code: 'stale_state', message: 'Session changed' }, currentSeq: 9 }),
          }
        : { ok: true, status: 204, text: async () => '' }
    },
  })
  await assert.rejects(api.getCommand('command_test'), error => {
    assert.ok(error instanceof GatewayApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'stale_state')
    assert.deepEqual(error.details, { currentSeq: 9 })
    return true
  })
  await assert.rejects(api.getSession('session_test'), error => {
    assert.ok(error instanceof GatewayApiError)
    assert.equal(error.status, 204)
    assert.match(error.message, /empty response/)
    return true
  })
})

test('ViewerSync hydrates local and paginated remote projections before subscribing', async () => {
  const local = {
    sessionId: 'session_local',
    runtimeId: 'runtime_local',
    title: 'Local session',
    createdAt: 1,
    parentSessionId: null,
    status: 'idle',
    lastSeq: 2,
    lastActivityAt: 2,
    unresolvedApproval: null,
    recentEvents: [],
  }
  const saved = []
  const callbacks = []
  const requests = []
  const summary = (sessionId, lastSeq) => ({
    sessionId,
    runtimeId: 'runtime_remote',
    runtimeStatus: 'online',
    header: { title: sessionId, createdAt: 1, parentSessionId: null },
    projection: { status: 'running', lastActivityAt: lastSeq, unresolvedApproval: null },
    lastSeq,
    revision: 1,
    updatedAt: '2026-08-20T00:00:00.000Z',
  })
  const viewer = new ViewerSync({
    gatewayUrl: 'wss://sync.example.test/v1/stream',
    apiBaseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    storage: {
      loadSessionProjections: () => [local],
      saveSessionProjection: projection => saved.push(projection),
    },
    fetchImpl: async url => {
      requests.push(String(url))
      if (String(url).includes('/events?')) {
        const sessionId = String(url).split('/v1/sessions/')[1].split('/events?')[0]
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            session: summary(sessionId, sessionId === 'session_remote_1' ? 5 : 6),
            items: [],
            hasMore: false,
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        text: async () => String(url).includes('cursor=page2')
          ? JSON.stringify({ items: [summary('session_remote_2', 6)] })
          : JSON.stringify({ items: [summary('session_remote_1', 5)], nextCursor: 'page2' }),
      }
    },
    onProjections: projections => callbacks.push(projections),
  })
  await viewer.start()
  assert.deepEqual(viewer.listSessions().map(item => item.sessionId), [
    'session_remote_2',
    'session_remote_1',
    'session_local',
  ])
  assert.deepEqual(requests, [
    'https://sync.example.test/v1/sessions?limit=100',
    'https://sync.example.test/v1/sessions/session_remote_1/events?afterSeq=-1&limit=500',
    'https://sync.example.test/v1/sessions?limit=100&cursor=page2',
    'https://sync.example.test/v1/sessions/session_remote_2/events?afterSeq=-1&limit=500',
  ])
  assert.deepEqual(saved.map(item => item.sessionId), ['session_remote_1', 'session_remote_2'])

  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'client.subscribe')
    .map(frame => [frame.sessionId, frame.payload.fromSeq]), [
      ['session_remote_2', 7],
      ['session_remote_1', 6],
      ['session_local', 3],
    ])
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(callbacks.length, 1)
  assert.equal(callbacks[0].length, 3)
  viewer.stop()
})

test('ViewerSync replays remote event history so mobile can render the full conversation', async () => {
  const viewer = new ViewerSync({
    gatewayUrl: 'wss://sync.example.test/v1/stream',
    apiBaseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    storage: {
      loadSessionProjections: () => [],
      saveSessionProjection: () => {},
    },
    fetchImpl: async url => {
      const value = String(url)
      if (value.includes('/events?')) {
        const firstPage = value.includes('afterSeq=-1')
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            session: {
              sessionId: 'session_history',
              runtimeId: 'runtime_history',
              runtimeStatus: 'online',
              header: { title: 'History' },
              projection: { status: 'completed', lastActivityAt: 3, unresolvedApproval: null },
              lastSeq: 2,
              revision: 1,
              updatedAt: '2026-08-20T00:00:00.000Z',
            },
            items: firstPage
              ? [
                  { seq: 0, eventType: 'user/message', receivedAt: '2026-08-20T00:00:00.000Z', event: { type: 'user/message', seq: 0, time: 1, data: { text: 'question' } } },
                  { seq: 1, eventType: 'assistant/chunk', receivedAt: '2026-08-20T00:00:00.000Z', event: { type: 'assistant/chunk', seq: 1, time: 2, data: { messageId: 'assistant_1', delta: { text: 'answer' } } } },
                ]
              : [{ seq: 2, eventType: 'assistant/message', receivedAt: '2026-08-20T00:00:00.000Z', event: { type: 'assistant/message', seq: 2, time: 3, data: { messageId: 'assistant_1', text: 'answer' } } }],
            hasMore: firstPage,
            ...(firstPage ? { nextAfterSeq: 1 } : {}),
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          items: [{
            sessionId: 'session_history',
            runtimeId: 'runtime_history',
            runtimeStatus: 'online',
            header: { title: 'History', createdAt: 1, parentSessionId: null },
            projection: { status: 'completed', lastActivityAt: 3, unresolvedApproval: null },
            lastSeq: 2,
            revision: 1,
            updatedAt: '2026-08-20T00:00:00.000Z',
          }],
        }),
      }
    },
  })
  await viewer.start()
  assert.deepEqual(viewer.listSessions()[0].conversation.map(item => [item.role, item.text]), [
    ['user', 'question'],
    ['assistant', 'answer'],
  ])
  assert.equal(viewer.listSessions()[0].historyLoaded, true)
  viewer.stop()
})

test('ViewerSync retries a failed hydrate and subscribes recovered Sessions', async () => {
  let attempts = 0
  const errors = []
  let recovered = 0
  const viewer = new ViewerSync({
    gatewayUrl: 'wss://sync.example.test/v1/stream',
    apiBaseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    storage: {
      loadSessionProjections: () => [],
      saveSessionProjection: () => {},
    },
    fetchImpl: async url => {
      if (String(url).includes('/events?')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            session: {
              sessionId: 'session_recovered',
              runtimeId: 'runtime_recovered',
              runtimeStatus: 'online',
              header: { title: 'Recovered session', createdAt: 1, parentSessionId: null },
              projection: { status: 'running', lastActivityAt: 1, unresolvedApproval: null },
              lastSeq: 0,
              revision: 1,
              updatedAt: '2026-08-20T00:00:00.000Z',
            },
            items: [],
            hasMore: false,
          }),
        }
      }
      attempts += 1
      return {
        ok: true,
        status: 200,
        text: async () => attempts === 1 ? '' : JSON.stringify({
          items: [{
            sessionId: 'session_recovered',
            runtimeId: 'runtime_recovered',
            runtimeStatus: 'online',
            header: { title: 'Recovered session', createdAt: 1, parentSessionId: null },
            projection: { status: 'running', lastActivityAt: 1, unresolvedApproval: null },
            lastSeq: 0,
            revision: 1,
            updatedAt: '2026-08-20T00:00:00.000Z',
          }],
        }),
      }
    },
    onSyncError: error => errors.push(error),
    onSyncRecovered: () => { recovered += 1 },
  })
  await viewer.start()
  assert.equal(errors.length, 1)
  await viewer.refresh()
  assert.equal(recovered, 1)
  assert.deepEqual(viewer.listSessions().map(item => item.sessionId), ['session_recovered'])

  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'client.subscribe')
    .map(frame => [frame.sessionId, frame.payload.fromSeq]), [['session_recovered', 1]])
  viewer.stop()
})

test('ViewerSync recovers a realtime gap from REST and resumes the live cursor', async () => {
  const stored = []
  const gaps = []
  const recoveredGaps = []
  const errors = []
  const local = {
    sessionId: 'session_gap',
    runtimeId: 'runtime_gap',
    title: 'Gap session',
    createdAt: 1,
    parentSessionId: null,
    status: 'running',
    lastSeq: 1,
    lastActivityAt: 10,
    unresolvedApproval: null,
    recentEvents: [],
  }
  const eventAt = seq => ({
    seq,
    eventType: 'assistant/message',
    receivedAt: '2026-08-20T00:00:00.000Z',
    event: { type: 'assistant/message', seq, time: 10 + seq, data: { text: `event-${seq}` } },
  })
  const viewer = new ViewerSync({
    gatewayUrl: 'wss://sync.example.test/v1/stream',
    apiBaseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    storage: {
      loadSessionProjections: () => [local],
      saveSessionProjection: projection => stored.push(projection),
    },
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      text: async () => String(url).includes('/events?')
        ? JSON.stringify({
            session: {
              sessionId: 'session_gap',
              runtimeId: 'runtime_gap',
              runtimeStatus: 'online',
              header: { title: 'Gap session' },
              projection: { status: 'running' },
              lastSeq: 2,
              revision: 1,
              updatedAt: '2026-08-20T00:00:00.000Z',
            },
            items: [eventAt(2)],
            hasMore: false,
          })
        : JSON.stringify({ items: [] }),
    }),
    onGap: (sessionId, expectedSeq) => gaps.push([sessionId, expectedSeq]),
    onGapRecovered: sessionId => recoveredGaps.push(sessionId),
    onSyncError: error => errors.push(error),
  })
  await viewer.start()
  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  const eventThree = {
    protocolVersion: 1,
    frameId: 'frame_event_3',
    kind: 'session.event',
    accountId: 'acct_test',
    deviceId: 'gateway',
    runtimeId: 'runtime_gap',
    sessionId: 'session_gap',
    seq: 3,
    eventType: 'assistant/message',
    sentAt: '2026-08-20T00:00:00.000Z',
    payload: { event: { type: 'assistant/message', seq: 3, time: 13, data: { text: 'event-3' } } },
  }
  socket.message(eventThree)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(gaps, [['session_gap', 2]])
  assert.deepEqual(recoveredGaps, ['session_gap'])
  assert.deepEqual(errors, [])
  assert.equal(viewer.listSessions()[0].lastSeq, 2)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'client.subscribe').map(frame => frame.payload.fromSeq), [2, 3])

  socket.message(eventThree)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(viewer.listSessions()[0].lastSeq, 3)
  assert.equal(socket.sent.some(frame => frame.kind === 'event.ack'), false)
  assert.deepEqual(stored.map(item => item.lastSeq), [2, 3])
  viewer.stop()
})

test('ViewerSync reports malformed REST history and resubscribes from the durable cursor', async () => {
  const errors = []
  const recoveredGaps = []
  let historyAttempts = 0
  const viewer = new ViewerSync({
    gatewayUrl: 'wss://sync.example.test/v1/stream',
    apiBaseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    storage: {
      loadSessionProjections: () => [{
        sessionId: 'session_invalid_history',
        runtimeId: 'runtime_test',
        title: 'Invalid history',
        createdAt: 1,
        parentSessionId: null,
        status: 'running',
        lastSeq: 1,
        lastActivityAt: 10,
        unresolvedApproval: null,
        recentEvents: [],
      }],
      saveSessionProjection: () => {},
    },
    fetchImpl: async url => {
      const isHistory = String(url).includes('/events?')
      if (isHistory) historyAttempts += 1
      return {
        ok: true,
        status: 200,
        text: async () => isHistory
          ? JSON.stringify({
            session: {
              sessionId: 'session_invalid_history',
              runtimeId: 'runtime_test',
              runtimeStatus: 'online',
              header: { title: 'Invalid history' },
              projection: { status: 'running' },
              lastSeq: 1,
              revision: 1,
              updatedAt: '2026-08-20T00:00:00.000Z',
            },
            items: historyAttempts === 1
              ? [{
                  seq: 2,
                  eventType: 'assistant/message',
                  receivedAt: '2026-08-20T00:00:00.000Z',
                  event: { type: 'assistant/message', data: { text: 'missing seq and time' } },
                }]
              : [{
                  seq: 2,
                  eventType: 'assistant/message',
                  receivedAt: '2026-08-20T00:00:00.000Z',
                  event: { type: 'assistant/message', seq: 2, time: 12, data: { text: 'recovered' } },
                }],
            hasMore: false,
          })
          : JSON.stringify({ items: [] }),
      }
    },
    onGapRecovered: sessionId => recoveredGaps.push(sessionId),
    onSyncError: error => errors.push(error),
  })
  await viewer.start()
  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  socket.message({
    protocolVersion: 1,
    frameId: 'frame_event_3_invalid_history',
    kind: 'session.event',
    accountId: 'acct_test',
    deviceId: 'gateway',
    runtimeId: 'runtime_test',
    sessionId: 'session_invalid_history',
    seq: 3,
    eventType: 'assistant/message',
    sentAt: '2026-08-20T00:00:00.000Z',
    payload: { event: { type: 'assistant/message', seq: 3, time: 13, data: { text: 'live' } } },
  })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /invalid event at seq 2/)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'client.subscribe')
    .map(frame => frame.payload.fromSeq), [2, 2])
  await viewer.retry()
  assert.equal(historyAttempts, 2)
  assert.deepEqual(recoveredGaps, ['session_invalid_history'])
  assert.equal(viewer.listSessions()[0].lastSeq, 2)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'client.subscribe')
    .map(frame => frame.payload.fromSeq), [2, 2, 3])
  viewer.stop()
})

test('ViewerSync rejects a non-advancing REST history cursor after applying its page', async () => {
  const errors = []
  const stored = []
  const viewer = new ViewerSync({
    gatewayUrl: 'wss://sync.example.test/v1/stream',
    apiBaseUrl: 'https://sync.example.test',
    accessToken: 'token_test',
    storage: {
      loadSessionProjections: () => [{
        sessionId: 'session_bad_cursor',
        runtimeId: 'runtime_test',
        title: 'Bad cursor',
        createdAt: 1,
        parentSessionId: null,
        status: 'running',
        lastSeq: 1,
        lastActivityAt: 10,
        unresolvedApproval: null,
        recentEvents: [],
      }],
      saveSessionProjection: projection => stored.push(projection),
    },
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      text: async () => String(url).includes('/events?')
        ? JSON.stringify({
            session: {
              sessionId: 'session_bad_cursor',
              runtimeId: 'runtime_test',
              runtimeStatus: 'online',
              header: { title: 'Bad cursor' },
              projection: { status: 'running' },
              lastSeq: 2,
              revision: 1,
              updatedAt: '2026-08-20T00:00:00.000Z',
            },
            items: [{
              seq: 2,
              eventType: 'assistant/message',
              receivedAt: '2026-08-20T00:00:00.000Z',
              event: { type: 'assistant/message', seq: 2, time: 12, data: { text: 'history' } },
            }],
            hasMore: true,
            nextAfterSeq: 1,
          })
        : JSON.stringify({ items: [] }),
    }),
    onSyncError: error => errors.push(error),
  })
  await viewer.start()
  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  socket.message({
    protocolVersion: 1,
    frameId: 'frame_event_3_bad_cursor',
    kind: 'session.event',
    accountId: 'acct_test',
    deviceId: 'gateway',
    runtimeId: 'runtime_test',
    sessionId: 'session_bad_cursor',
    seq: 3,
    eventType: 'assistant/message',
    sentAt: '2026-08-20T00:00:00.000Z',
    payload: { event: { type: 'assistant/message', seq: 3, time: 13, data: { text: 'live' } } },
  })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /invalid event page cursor/)
  assert.equal(stored.at(-1).lastSeq, 2)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'client.subscribe')
    .map(frame => frame.payload.fromSeq), [2, 3])
  viewer.stop()
})

test('ViewerSync surfaces a device revocation frame as an authentication error', async () => {
  const errors = []
  const viewer = new ViewerSync({
    gatewayUrl: 'wss://sync.example.test/v1/stream',
    accessToken: 'token_test',
    storage: {
      loadSessionProjections: () => [],
      saveSessionProjection: () => undefined,
    },
    onSyncError: error => errors.push(error),
  })
  await viewer.start()
  const socket = FakeWebSocket.instances[0]
  completeHandshake(socket)
  socket.message({
    protocolVersion: 1,
    frameId: 'frame_device_revoked',
    kind: 'error',
    sentAt: '2026-08-20T00:00:00.000Z',
    payload: {
      code: 'device_revoked',
      message: 'device was revoked',
      retryable: false,
    },
  })
  assert.equal(errors.length, 1)
  assert.ok(errors[0] instanceof GatewayApiError)
  assert.equal(errors[0].status, 401)
  assert.equal(errors[0].code, 'device_revoked')
  viewer.stop()
})
