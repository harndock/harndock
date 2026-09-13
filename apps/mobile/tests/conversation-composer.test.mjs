import assert from 'node:assert/strict'
import test from 'node:test'
import { composerViewState, nextCommandAttempt } from '../src/features/conversation/composer-model.ts'

const idleOperation = { kind: 'idle', retry: 'none' }

function view(overrides = {}) {
  return composerViewState({
    busy: false,
    canRetry: false,
    command: undefined,
    commandAcknowledged: false,
    historyLoaded: true,
    lastSeq: 12,
    operation: idleOperation,
    projectionStatus: 'running',
    prompt: '',
    ...overrides,
  })
}

function command(overrides = {}) {
  return {
    accountId: 'account-1',
    commandId: 'command-1',
    sessionId: 'session-1',
    commandType: 'session.prompt',
    status: 'queued',
    baseSeq: 10,
    expiresAt: '2026-08-25T10:02:00.000Z',
    updatedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  }
}

test('Composer blocks commands until snapshot and history are ready', () => {
  assert.equal(view({ projectionStatus: undefined }).mode, 'loading')
  assert.equal(view({ historyLoaded: false }).mode, 'replaying')
  assert.equal(view({ historyLoaded: false }).sendEnabled, false)
})

test('Composer enables prompt and cancel from the real Session state', () => {
  const ready = view({ prompt: 'continue' })
  assert.equal(ready.mode, 'ready')
  assert.equal(ready.inputEnabled, true)
  assert.equal(ready.sendEnabled, true)
  assert.equal(ready.stopEnabled, true)
})

test('Queued and executing commands retain the emergency stop action', () => {
  assert.equal(view({ busy: true, command: command() }).stopEnabled, true)
  assert.equal(view({ busy: true, command: command({ status: 'executing' }) }).stopEnabled, true)
})

test('Completed cancel remains stopping until a real Session event ends the run', () => {
  const cancel = command({ commandType: 'session.cancel', status: 'completed' })
  assert.equal(view({ command: cancel }).mode, 'stopping')
  assert.equal(view({ command: cancel, projectionStatus: 'cancelled' }).mode, 'ready')
})

test('Stale command waits for history before allowing retry or dismissal', () => {
  const operation = { kind: 'stale', retry: 'submit', expectedSeq: 15 }
  const waiting = view({ canRetry: true, lastSeq: 14, operation })
  assert.equal(waiting.retryEnabled, false)
  assert.equal(waiting.dismissEnabled, false)
  const caughtUp = view({ canRetry: true, lastSeq: 15, operation })
  assert.equal(caughtUp.retryEnabled, true)
  assert.equal(caughtUp.dismissEnabled, true)
})

test('Unknown command requires an explicit decision and acknowledgment restores editing', () => {
  const unknown = command({ status: 'unknown' })
  assert.equal(view({ canRetry: true, command: unknown }).mode, 'unknown')
  assert.equal(view({ canRetry: true, command: unknown }).inputEnabled, false)
  assert.equal(view({ command: unknown, commandAcknowledged: true }).mode, 'ready')
})

test('Offline Session disables all command controls', () => {
  const offline = view({ projectionStatus: 'offline', prompt: 'continue' })
  assert.equal(offline.mode, 'offline')
  assert.equal(offline.sendEnabled, false)
  assert.equal(offline.stopEnabled, false)
})

test('Composer ignores approval command state during the resolved-event handoff', () => {
  const approval = command({ commandType: 'approval.respond', status: 'queued' })
  const ready = view({
    command: approval,
    operation: { kind: 'approval-decided', commandType: 'approval.respond', retry: 'none' },
    prompt: 'continue',
  })
  assert.equal(ready.mode, 'ready')
  assert.equal(ready.sendEnabled, true)
})

test('Retry identity distinguishes ambiguous delivery from definitive rejection', () => {
  const previous = command()
  const ambiguous = nextCommandAttempt(previous, {
    createId: () => 'command-2',
    currentSeq: 12,
    now: Date.parse('2026-08-25T10:01:00.000Z'),
    reuseIdentity: true,
  })
  assert.equal(ambiguous.commandId, previous.commandId)
  assert.equal(ambiguous.baseSeq, previous.baseSeq)
  assert.equal(ambiguous.expiresAt, previous.expiresAt)

  const expiredAmbiguous = nextCommandAttempt(previous, {
    createId: () => 'command-2',
    currentSeq: 12,
    now: Date.parse('2026-08-25T10:02:01.000Z'),
    reuseIdentity: true,
  })
  assert.equal(expiredAmbiguous.commandId, 'command-2')
  assert.equal(expiredAmbiguous.baseSeq, 12)

  const definitive = nextCommandAttempt(previous, {
    createId: () => 'command-2',
    currentSeq: 12,
    now: Date.parse('2026-08-25T10:01:00.000Z'),
    reuseIdentity: false,
  })
  assert.equal(definitive.commandId, 'command-2')
  assert.equal(definitive.baseSeq, 12)
  assert.equal(definitive.expiresAt, '2026-08-25T10:03:00.000Z')
})
