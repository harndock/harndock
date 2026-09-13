import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  JsonFileOutbox,
  HarnessRemoteControl,
  MemoryOutbox,
  RemoteSyncConnector,
  createSignerFromEndpoint,
  sanitizeConnectorEvent,
} from '../lib/index.js'

function socketHarness() {
  const listeners = new Map()
  const sent = []
  return {
    readyState: 0,
    sent,
    on(event, listener) { listeners.set(event, listener) },
    send(value) { sent.push(JSON.parse(value)) },
    close() { listeners.get('close')?.() },
    open() { this.readyState = 1; listeners.get('open')?.() },
    message(value) { listeners.get('message')?.(JSON.stringify(value)) },
  }
}

async function authenticate(socket, now, suffix = '1') {
  socket.message({
    protocolVersion: 1,
    frameId: `server_hello_${suffix}`,
    kind: 'server.hello',
    sentAt: new Date(now).toISOString(),
    payload: {
      connectionId: `connection_${suffix}`,
      negotiatedVersion: 1,
      heartbeatIntervalMs: 30_000,
      serverTime: new Date(now).toISOString(),
    },
  })
  socket.message({
    protocolVersion: 1,
    frameId: `challenge_frame_${suffix}`,
    kind: 'pc.challenge',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sentAt: new Date(now).toISOString(),
    payload: {
      challengeId: `challenge_${suffix}`,
      nonce: 'uQv3-jBWrtq0HAvNoBmW5jmKSlzxgKrvMrdUJRSsNDI',
      expiresAt: new Date(now + 30_000).toISOString(),
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  socket.message({
    protocolVersion: 1,
    frameId: `registered_${suffix}`,
    kind: 'pc.registered',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sentAt: new Date(now).toISOString(),
    payload: { acceptedAt: new Date(now).toISOString() },
  })
  await new Promise(resolve => setImmediate(resolve))
}

test('connector registers and flushes an event only after event.ack', async () => {
  const socket = socketHarness()
  const outbox = new MemoryOutbox()
  let now = 1_700_000_000_000
  const statuses = []
  const heartbeats = []
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: proof => {
      assert.match(proof, /^dsh-sync-pc-register-v1\nchallenge_1\n/)
      return 'a'.repeat(86)
    },
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    outbox,
    socketFactory: () => socket,
    now: () => now,
    onStatus: status => statuses.push(status),
    onHeartbeat: sentAt => heartbeats.push(sentAt),
  })
  await connector.start()
  socket.open()
  assert.equal(socket.sent[0].kind, 'client.hello')
  await authenticate(socket, now)
  assert.equal(socket.sent[1].kind, 'pc.register')
  assert.equal(socket.sent[1].payload.challengeId, 'challenge_1')
  assert.deepEqual(statuses, ['connecting', 'handshaking', 'connected'])
  assert.deepEqual(heartbeats, [new Date(now).toISOString()])
  assert.equal(socket.sent[2].kind, 'pc.heartbeat')
  await connector.publishSessionEvent('session_test', { type: 'assistant/message', seq: 0, time: now, data: { text: 'hi' } })
  assert.equal(socket.sent.at(-1).kind, 'session.event')
  assert.equal((await outbox.pending()).length, 1)
  const eventFrame = socket.sent.at(-1)
  assert.equal(eventFrame.accountId, 'acct_test')
  assert.equal(eventFrame.deviceId, 'dev_pc')
  assert.equal(eventFrame.runtimeId, 'runtime_test')
  await connector.publishSessionEvent('session_test', { type: 'assistant/message', seq: 0, time: now, data: { text: 'duplicate' } })
  assert.equal((await outbox.pending()).length, 1)
  socket.message({
    protocolVersion: 1,
    frameId: 'ack_wrong_seq',
    kind: 'event.ack',
    sessionId: 'session_test',
    seq: 1,
    sentAt: new Date(++now).toISOString(),
    payload: { ackedFrameId: eventFrame.frameId },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await outbox.pending()).length, 1)
  assert.equal(await outbox.getCursor('session_test'), -1)
  socket.message({
    protocolVersion: 1,
    frameId: 'ack_1',
    kind: 'event.ack',
    sessionId: 'session_test',
    seq: 0,
    sentAt: new Date(++now).toISOString(),
    payload: { ackedFrameId: eventFrame.frameId },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await outbox.pending()).length, 0)
  assert.equal(await outbox.getCursor('session_test'), 0)
  assert.equal(eventFrame.sessionId, 'session_test')
  await connector.stop()
  assert.equal(statuses.at(-1), 'stopped')
})

test('connector sends each pending event once while acknowledgements advance a bounded window', async () => {
  const socket = socketHarness()
  const outbox = new MemoryOutbox()
  const now = 1_700_000_000_000
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    outbox,
    socketFactory: () => socket,
    now: () => now,
    maxInFlightFrames: 16,
  })

  await connector.start()
  for (let seq = 0; seq < 100; seq += 1) {
    await connector.publishSessionEvent(
      'session_window',
      { type: 'assistant/chunk', seq, time: now + seq, data: { text: String(seq) } },
    )
  }
  socket.open()
  await authenticate(socket, now, 'window')

  assert.equal(socket.sent.filter(frame => frame.kind === 'session.event').length, 16)
  for (let index = 0; index < 100; index += 1) {
    const frame = socket.sent.filter(candidate => candidate.kind === 'session.event')[index]
    assert.ok(frame, `event ${String(index)} should enter the send window`)
    socket.message({
      protocolVersion: 1,
      frameId: `ack_window_${String(index)}`,
      kind: 'event.ack',
      sessionId: frame.sessionId,
      seq: frame.seq,
      sentAt: new Date(now + index).toISOString(),
      payload: { ackedFrameId: frame.frameId },
    })
    await new Promise(resolve => setImmediate(resolve))
  }

  const sentEvents = socket.sent.filter(frame => frame.kind === 'session.event')
  assert.equal(sentEvents.length, 100)
  assert.equal(new Set(sentEvents.map(frame => frame.frameId)).size, 100)
  assert.equal((await outbox.pending()).length, 0)
  await connector.stop()
})

test('connector replays unacknowledged frames only after reconnecting', async () => {
  const sockets = [socketHarness(), socketHarness()]
  const outbox = new MemoryOutbox()
  const now = 1_700_000_000_000
  let socketIndex = 0
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    outbox,
    socketFactory: () => sockets[socketIndex++],
    now: () => now,
    reconnectBaseMs: 0,
    reconnectMaxMs: 0,
    maxInFlightFrames: 2,
  })

  await connector.start()
  for (let seq = 0; seq < 3; seq += 1) {
    await connector.publishSessionEvent(
      'session_reconnect',
      { type: 'assistant/chunk', seq, time: now + seq, data: { text: String(seq) } },
    )
  }
  sockets[0].open()
  await authenticate(sockets[0], now, 'reconnect-1')
  assert.deepEqual(
    sockets[0].sent.filter(frame => frame.kind === 'session.event').map(frame => frame.seq),
    [0, 1],
  )

  sockets[0].close()
  await new Promise(resolve => setTimeout(resolve, 0))
  sockets[1].open()
  await authenticate(sockets[1], now, 'reconnect-2')
  const replayed = sockets[1].sent.filter(frame => frame.kind === 'session.event')
  assert.deepEqual(replayed.map(frame => frame.seq), [0, 1])

  sockets[1].message({
    protocolVersion: 1,
    frameId: 'ack_reconnect_0',
    kind: 'event.ack',
    sessionId: 'session_reconnect',
    seq: 0,
    sentAt: new Date(now).toISOString(),
    payload: { ackedFrameId: replayed[0].frameId },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(
    sockets[1].sent.filter(frame => frame.kind === 'session.event').map(frame => frame.seq),
    [0, 1, 2],
  )
  await connector.stop()
})

test('connector publishes a new Session snapshot before its first live event', async () => {
  const outbox = new MemoryOutbox()
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    outbox,
    socketFactory: () => socketHarness(),
  })
  await connector.start()
  await connector.publishSessionEvent(
    'session_live',
    { type: 'permission/preset', seq: 0, time: 11, data: {} },
    { id: 'session_live', createdAt: 10 },
  )

  const pending = await outbox.pending()
  assert.deepEqual(pending.map(frame => frame.kind), ['session.snapshot', 'session.event'])
  assert.equal(pending[0].sessionId, 'session_live')
  assert.equal(pending[0].payload.projection.lastSeq, -1)
  assert.equal(pending[1].seq, 0)
  await connector.stop()
})

test('connector restores a missing persisted event before later live events', async () => {
  let now = Date.now()
  const socket = socketHarness()
  const outbox = new MemoryOutbox()
  await outbox.setCursor('session_gap', 41)
  await outbox.enqueue({
    protocolVersion: 1,
    frameId: 'pending_43',
    kind: 'session.event',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sessionId: 'session_gap',
    seq: 43,
    eventType: 'turn/start',
    sentAt: new Date(now).toISOString(),
    payload: { event: { type: 'turn/start', seq: 43, time: now, data: {} } },
  })
  const readFromCalls = []
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    outbox,
    socketFactory: () => socket,
    now: () => now,
    persistence: {
      async listSnapshots() { return [] },
      async readFrom(sessionId, fromSeq) {
        readFromCalls.push([sessionId, fromSeq])
        return {
          meta: { id: sessionId, createdAt: 1 },
          events: [
            { type: 'session/end-seed', seq: 42, time: ++now, data: {} },
            { type: 'turn/start', seq: 43, time: ++now, data: {} },
          ],
        }
      },
    },
  })

  await connector.start()
  socket.open()
  await authenticate(socket, now, 'gap')
  await connector.publishSessionEvent(
    'session_gap',
    { type: 'turn/start', seq: 43, time: ++now, data: {} },
    { id: 'session_gap', createdAt: 1 },
  )

  assert.deepEqual(readFromCalls, [['session_gap', 42]])
  assert.deepEqual(
    socket.sent.filter(frame => frame.kind === 'session.event').slice(-2).map(frame => frame.seq),
    [42, 43],
  )
  assert.deepEqual(
    (await outbox.pending()).filter(frame => frame.kind === 'session.event').map(frame => frame.seq),
    [43, 42],
  )
  await connector.stop()
})

test('connector authorizes and executes downstream control commands', async () => {
  const socket = socketHarness()
  const calls = []
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    socketFactory: () => socket,
    commandHandler: {
      async prompt(sessionId, contentBlocks) { calls.push(['prompt', sessionId, contentBlocks]) },
      async cancel(sessionId) { calls.push(['cancel', sessionId]) },
      async respondApproval(sessionId, approvalId, outcome) { calls.push(['approval', sessionId, approvalId, outcome]) },
    },
  })
  await connector.start()
  socket.open()
  await authenticate(socket, Date.now(), 'command')
  socket.message({
    protocolVersion: 1,
    frameId: 'command_submit_1',
    kind: 'command.submit',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sessionId: 'session_test',
    commandId: 'cmd_test_1',
    baseSeq: 0,
    commandType: 'session.prompt',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sentAt: new Date().toISOString(),
    payload: { contentBlocks: [{ type: 'text', text: 'continue' }] },
  })
  await new Promise(resolve => setImmediate(resolve))
  const statuses = socket.sent.filter(frame => frame.kind === 'command.status')
  assert.deepEqual(statuses.map(frame => frame.payload.status), ['authorized', 'completed'])
  assert.deepEqual(calls, [['prompt', 'session_test', [{ type: 'text', text: 'continue' }]]])
  await connector.stop()
})

test('connector rechecks local Session authorization before executing a command', async () => {
  const socket = socketHarness()
  const calls = []
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    socketFactory: () => socket,
    commandHandler: {
      async authorizeCommand() { throw new Error('Session is no longer available') },
      async prompt() { calls.push('prompt') },
      async cancel() { calls.push('cancel') },
      async respondApproval() { calls.push('approval') },
    },
  })
  await connector.start()
  socket.open()
  await authenticate(socket, Date.now(), 'authorize-command')
  socket.message({
    protocolVersion: 1,
    frameId: 'command_authorize_rejected',
    kind: 'command.submit',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sessionId: 'session_test',
    commandId: 'cmd_authorize_rejected',
    baseSeq: 0,
    commandType: 'session.prompt',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sentAt: new Date().toISOString(),
    payload: { contentBlocks: [{ type: 'text', text: 'must not run' }] },
  })
  await new Promise(resolve => setImmediate(resolve))
  const statuses = socket.sent.filter(frame => frame.kind === 'command.status')
  assert.deepEqual(statuses.map(frame => frame.payload.status), ['rejected'])
  assert.equal(statuses[0].payload.reason, 'Session is no longer available')
  assert.deepEqual(calls, [])
  await connector.stop()
})

test('connector does not execute a replayed command twice', async () => {
  const socket = socketHarness()
  let calls = 0
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    socketFactory: () => socket,
    commandHandler: {
      async prompt() { calls += 1 },
      async cancel() {},
      async respondApproval() {},
    },
  })
  await connector.start()
  socket.open()
  await authenticate(socket, Date.now(), 'replayed-command')
  const command = {
    protocolVersion: 1,
    frameId: 'command_replayed_1',
    kind: 'command.submit',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sessionId: 'session_test',
    commandId: 'cmd_replayed_1',
    baseSeq: 0,
    commandType: 'session.prompt',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sentAt: new Date().toISOString(),
    payload: { contentBlocks: [{ type: 'text', text: 'once' }] },
  }
  socket.message(command)
  await new Promise(resolve => setImmediate(resolve))
  socket.message({ ...command, frameId: 'command_replayed_2' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'command.status').map(frame => frame.payload.status), ['authorized', 'completed'])
  await connector.stop()
})

test('connector rejects malformed approval commands before authorization', async () => {
  const socket = socketHarness()
  let authorized = 0
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    socketFactory: () => socket,
    commandHandler: {
      async authorizeCommand() { authorized += 1 },
      async prompt() {},
      async cancel() {},
      async respondApproval() {},
    },
  })
  await connector.start()
  socket.open()
  await authenticate(socket, Date.now(), 'malformed-approval')
  socket.message({
    protocolVersion: 1,
    frameId: 'command_bad_approval',
    kind: 'command.submit',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sessionId: 'session_test',
    commandId: 'cmd_bad_approval',
    baseSeq: 0,
    commandType: 'approval.respond',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sentAt: new Date().toISOString(),
    payload: {},
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(authorized, 0)
  assert.deepEqual(socket.sent.filter(frame => frame.kind === 'command.status').map(frame => frame.payload.status), ['rejected'])
  await connector.stop()
})

test('Harness control adapter executes host RPCs and resolves the exact pending approval', async () => {
  const calls = []
  const api = {
    async invoke(request) {
      calls.push([request.method, request.args.request])
      return { accepted: true }
    },
  }
  const persistence = {
    async listSnapshots() { return [] },
    async readFrom() {
      return {
        meta: { id: 'session_test', createdAt: 1 },
        events: [{ type: 'user/message', seq: 4, time: 4, data: {} }],
      }
    },
  }
  const control = new HarnessRemoteControl(api, persistence)
  control.start()
  const approval = control.answerApproval({
    agent: { session: {
      id: 'session_test',
      events: [{ type: 'approval/asked', data: { id: 'approval_test', toolName: 'shell' } }],
    } },
    toolName: 'shell',
  }, async () => new Promise(() => {}))
  await new Promise(resolve => setImmediate(resolve))

  const approvalCommand = {
    sessionId: 'session_test',
    baseSeq: 4,
    commandType: 'approval.respond',
    payload: { approvalId: 'approval_test', outcome: 'allowed-once' },
  }
  await control.authorizeCommand(approvalCommand)
  await control.prompt('session_test', [{ type: 'text', text: 'continue' }])
  await control.cancel('session_test')
  await control.respondApproval('session_test', 'approval_test', 'allowed-once')

  assert.equal(calls[0][0], 'prompt')
  const { requestId, ...promptPayload } = calls[0][1]
  assert.equal(typeof requestId, 'string')
  assert.deepEqual(promptPayload, {
    sessionId: 'session_test',
    mode: 'queue',
    content: [{ type: 'text', text: 'continue' }],
  })
  assert.deepEqual(calls[1], ['cancel', { sessionId: 'session_test' }])
  assert.equal(await approval, 'allowed-once')
  await assert.rejects(() => control.authorizeCommand(approvalCommand), /no longer pending/)
  await assert.rejects(() => control.authorizeCommand({ ...approvalCommand, baseSeq: 3, commandType: 'session.cancel', payload: {} }), /stale/)
  await control.stop()
})

test('JSON outbox persists pending frames and advances its cursor atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harndock-remote-sync-'))
  const path = join(directory, 'outbox.json')
  const frame = {
    protocolVersion: 1,
    frameId: 'event_persisted_1',
    kind: 'session.event',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    sessionId: 'session_test',
    seq: 4,
    eventType: 'assistant/message',
    sentAt: new Date().toISOString(),
    payload: { event: { type: 'assistant/message', seq: 4, time: 4, data: { text: 'persisted' } } },
  }
  try {
    const first = new JsonFileOutbox(path)
    await first.enqueue(frame)
    const restored = new JsonFileOutbox(path)
    assert.equal((await restored.pending()).length, 1)
    assert.equal(await restored.acknowledge(frame.frameId, frame.sessionId, frame.seq + 1), false)
    assert.equal((await restored.pending()).length, 1)
    assert.equal(await restored.acknowledge(frame.frameId, frame.sessionId, frame.seq), true)
    const verified = new JsonFileOutbox(path)
    assert.equal((await verified.pending()).length, 0)
    assert.equal(await verified.getCursor(frame.sessionId), frame.seq)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('upload policy redacts local and tool-sensitive data without mutating the source event', () => {
  const event = {
    type: 'tool/call',
    seq: 7,
    time: 7,
    data: {
      name: 'bash',
      arguments: '{"command":"cat .env"}',
      cwd: '/Users/alice/private-project',
      environment: { API_KEY: 'secret-value' },
    },
  }
  const sanitized = sanitizeConnectorEvent(event)
  assert.deepEqual(sanitized.data, {
    name: 'bash',
    arguments: '[redacted]',
    cwd: '[redacted]',
    environment: '[redacted]',
  })
  assert.equal(event.data.cwd, '/Users/alice/private-project')
  assert.equal(sanitizeConnectorEvent(event, { includeToolContent: true }).data.arguments, event.data.arguments)
})

test('connector rejects plaintext non-loopback gateways', () => {
  assert.throws(() => new RemoteSyncConnector({
    gatewayUrl: 'ws://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
  }), /must use wss/)
})

test('local signer client exchanges one bounded NDJSON request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harndock-remote-signer-'))
  const path = join(directory, 'signer.sock')
  const server = createServer(socket => {
    let body = ''
    socket.on('data', chunk => { body += String(chunk) })
    socket.on('end', () => {
      const request = JSON.parse(body)
      assert.equal(request.proof, 'dsh-sync-pc-register-v1\nchallenge\nnonce\naccount\ndevice\nruntime')
      socket.end(JSON.stringify({ signature: 'a'.repeat(86) }) + '\n')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  try {
    const signature = await createSignerFromEndpoint(`unix:${path}`)('dsh-sync-pc-register-v1\nchallenge\nnonce\naccount\ndevice\nruntime')
    assert.equal(signature, 'a'.repeat(86))
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test('connector restores persisted events from the saved cursor', async () => {
  const socket = socketHarness()
  const outbox = new MemoryOutbox()
  await outbox.setCursor('session_test', 0)
  const connector = new RemoteSyncConnector({
    gatewayUrl: 'wss://sync.example.test/v1/ws',
    accountId: 'acct_test',
    deviceId: 'dev_pc',
    runtimeId: 'runtime_test',
    publicKey: 'public-key',
    signRegistrationProof: () => 'a'.repeat(86),
    runtimeVersion: '2026.08.18.1',
    runtimeApi: 1,
    harnessCommit: '0123456789abcdef0123456789abcdef01234567',
    outbox,
    socketFactory: () => socket,
    persistence: {
      async listSnapshots() {
        return [{ header: { id: 'session_test', createdAt: 1, cwd: '/Users/alice/private-project' }, revision: 'r1' }]
      },
      async readFrom(_sessionId, fromSeq) {
        assert.equal(fromSeq, 0)
        return {
          meta: { id: 'session_test', createdAt: 1, cwd: '/Users/alice/private-project' },
          events: [
            { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
            { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
          ],
        }
      },
    },
  })
  await connector.start()
  assert.equal((await outbox.pending()).length, 2)
  assert.equal((await outbox.pending())[0].kind, 'session.snapshot')
  assert.equal((await outbox.pending())[1].kind, 'session.event')
  for (const frame of await outbox.pending()) {
    assert.equal(frame.accountId, 'acct_test')
    assert.equal(frame.deviceId, 'dev_pc')
    assert.equal(frame.runtimeId, 'runtime_test')
  }
  assert.equal((await outbox.pending())[0].payload.header.cwdLabel, 'private-project')
  assert.equal((await outbox.pending())[0].payload.header.title, 'session_test')
  assert.equal((await outbox.pending())[0].payload.projection.status, 'completed')
  assert.equal((await outbox.pending())[0].payload.projection.lastActivityAt, 2)
  socket.open()
  assert.deepEqual(socket.sent.map(frame => frame.kind), ['client.hello'])
  await authenticate(socket, Date.now(), '2')
  assert.deepEqual(
    socket.sent.map(frame => frame.kind),
    ['client.hello', 'pc.register', 'pc.heartbeat', 'session.snapshot', 'session.event'],
  )
  await connector.stop()
})
