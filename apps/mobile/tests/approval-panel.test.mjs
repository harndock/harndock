import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalPanelState,
  createApprovalSubmissionLock,
} from '../src/features/conversation/approval-model.ts'

const idleOperation = { kind: 'idle', retry: 'none' }

function view(overrides = {}) {
  return approvalPanelState({
    approvalId: 'approval-1',
    attempt: undefined,
    busy: false,
    canRetry: false,
    command: undefined,
    historyLoaded: true,
    lastSeq: 12,
    operation: idleOperation,
    projectionStatus: 'waiting',
    ...overrides,
  })
}

function attempt(overrides = {}) {
  return {
    approvalId: 'approval-1',
    commandId: 'command-1',
    outcome: 'allowed-once',
    ...overrides,
  }
}

function command(overrides = {}) {
  return {
    commandId: 'command-1',
    sessionId: 'session-1',
    commandType: 'approval.respond',
    status: 'queued',
    baseSeq: 12,
    expiresAt: '2026-08-25T10:02:00.000Z',
    ...overrides,
  }
}

test('Approval takeover exposes one-time allow and reject only while pending', () => {
  const pending = view()
  assert.equal(pending.mode, 'pending')
  assert.equal(pending.actionsEnabled, true)
  assert.equal(view({ busy: true }).actionsEnabled, false)
})

test('Approval takeover blocks decisions during history replay and Runtime offline', () => {
  assert.equal(view({ historyLoaded: false }).mode, 'stale')
  assert.equal(view({ historyLoaded: false }).actionsEnabled, false)
  assert.equal(view({ projectionStatus: 'offline' }).mode, 'offline')
  assert.equal(view({ projectionStatus: 'offline' }).actionsEnabled, false)
})

test('Approval submission lock rejects double taps until the matching event releases it', () => {
  const lock = createApprovalSubmissionLock()
  assert.equal(lock.claim('approval-1'), true)
  assert.equal(lock.claim('approval-1'), false)
  assert.equal(lock.claim('approval-2'), false)
  lock.release('approval-2')
  assert.equal(lock.current, 'approval-1')
  lock.release('approval-1')
  assert.equal(lock.claim('approval-2'), true)
})

test('Approval state correlates commands to the active approval attempt', () => {
  assert.equal(view({ command: command() }).mode, 'pending')
  assert.equal(view({ attempt: attempt(), command: command({ commandId: 'old-command' }) }).mode, 'confirming')
  assert.equal(view({ attempt: attempt(), command: command() }).mode, 'queued')
})

test('Approval submission locks both actions while Gateway and Harness process it', () => {
  const submitting = view({
    attempt: attempt({ outcome: 'rejected' }),
    operation: { kind: 'submitting', commandType: 'approval.respond', retry: 'none' },
  })
  assert.equal(submitting.mode, 'submitting')
  assert.equal(submitting.actionsEnabled, false)
  assert.match(submitting.title, /拒绝/)
  assert.equal(view({ attempt: attempt(), command: command({ status: 'executing' }) }).mode, 'executing')
})

test('Completed approval command waits for the real decided event', () => {
  const confirming = view({ attempt: attempt(), command: command({ status: 'completed' }) })
  assert.equal(confirming.mode, 'confirming')
  assert.equal(confirming.pending, true)
  assert.equal(confirming.actionsEnabled, false)
})

test('Approval already decided is terminal until projection synchronization', () => {
  const decided = view({
    attempt: attempt(),
    canRetry: true,
    operation: { kind: 'approval-decided', commandType: 'approval.respond', retry: 'none' },
  })
  assert.equal(decided.mode, 'already-decided')
  assert.equal(decided.retryEnabled, false)
  assert.equal(decided.actionsEnabled, false)
})

test('Stale approval enables only the original decision after history catches up', () => {
  const operation = { kind: 'stale', commandType: 'approval.respond', expectedSeq: 15, retry: 'submit' }
  assert.equal(view({ attempt: attempt(), canRetry: true, lastSeq: 14, operation }).retryEnabled, false)
  const ready = view({ attempt: attempt(), canRetry: true, lastSeq: 15, operation })
  assert.equal(ready.retryEnabled, true)
  assert.match(ready.detail, /允许一次/)
})

test('Unknown approval command requires an explicit same-decision retry', () => {
  const unknown = view({
    attempt: attempt({ outcome: 'rejected' }),
    canRetry: true,
    command: command({ status: 'unknown' }),
  })
  assert.equal(unknown.mode, 'unknown')
  assert.equal(unknown.retryEnabled, true)
  assert.match(unknown.detail, /拒绝/)
})
