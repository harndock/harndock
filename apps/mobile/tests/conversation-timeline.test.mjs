import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameConversationProjection } from '../src/features/conversation/projection-equivalence.ts'
import { buildConversationTimeline, buildEventTimeline, timelineTimeLabel } from '../src/features/conversation/timeline-model.ts'

function projection(overrides = {}) {
  return {
    sessionId: 'session-1',
    runtimeId: 'runtime-1',
    title: 'Timeline',
    createdAt: 1,
    parentSessionId: null,
    status: 'running',
    lastSeq: 8,
    lastActivityAt: 8,
    unresolvedApproval: null,
    conversationVersion: 2,
    conversation: [],
    historyLoaded: true,
    recentEvents: [],
    ...overrides,
  }
}

test('Conversation timeline merges aggregated messages and safe events by sequence', () => {
  const timeline = buildEventTimeline(projection({
    conversation: [
      { id: 'user-1', role: 'user', text: 'run tests', startSeq: 1, endSeq: 1, time: 1, streaming: false },
      { id: 'assistant-1', role: 'assistant', text: 'working', startSeq: 2, endSeq: 4, time: 2, streaming: false },
    ],
    recentEvents: [
      { seq: 1, type: 'user/message', time: 1, data: { text: 'run tests' } },
      { seq: 2, type: 'assistant/chunk', time: 2, data: { delta: { text: 'work' } } },
      { seq: 3, type: 'tool/call', time: 3, data: { name: 'shell', arguments: 'secret command' } },
      { seq: 4, type: 'assistant/message', time: 4, data: { text: 'working' } },
      { seq: 5, type: 'tool/result', time: 5, data: { output: 'secret result' } },
    ],
  }))

  assert.deepEqual(timeline.map(item => [item.kind, item.orderSeq]), [
    ['message', 1],
    ['message', 2],
    ['tool', 3],
    ['tool', 5],
  ])
  assert.equal(timeline.some(item => item.summary?.includes('secret')), false)
})

test('Conversation timeline retains unknown event type without exposing its payload', () => {
  const [item] = buildEventTimeline(projection({
    recentEvents: [{ seq: 8, type: 'future/private-event', time: 8, data: { password: 'do-not-render' } }],
  }))
  assert.equal(item.kind, 'unknown')
  assert.equal(item.title, 'future/private-event')
  assert.equal(JSON.stringify(item).includes('do-not-render'), false)
  assert.match(item.detail, /不会展开未知 payload/)
})

test('Conversation timeline exposes streaming assistant state once after chunk aggregation', () => {
  const timeline = buildEventTimeline(projection({
    conversation: [{ id: 'assistant-1', role: 'assistant', text: 'partial answer', startSeq: 6, endSeq: 7, time: 6, streaming: true }],
    recentEvents: [
      { seq: 6, type: 'assistant/chunk', time: 6, data: { delta: { text: 'partial ' } } },
      { seq: 7, type: 'assistant/chunk', time: 7, data: { delta: { text: 'answer' } } },
    ],
  }))
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].kind, 'message')
  assert.equal(timeline[0].message.streaming, true)
  assert.equal(timeline[0].message.text, 'partial answer')
})

test('Conversation timeline inserts a payload-free command status after its base sequence', () => {
  const timeline = buildEventTimeline(projection({
    conversation: [{ id: 'user-1', role: 'user', text: 'continue', startSeq: 4, endSeq: 4, time: 4, streaming: false }],
  }), {
    commandId: 'command-1',
    sessionId: 'session-1',
    commandType: 'session.prompt',
    baseSeq: 4,
    status: 'queued',
    expiresAt: '2026-08-25T01:00:00.000Z',
  })
  assert.deepEqual(timeline.map(item => item.kind), ['message', 'command'])
  assert.equal(timeline[1].title, '已提交远程消息')
  assert.equal(timeline[1].summary, '命令状态：已排队')
  assert.equal(timeline[1].titleMessage?.key, 'timeline.command.remoteMessage')
  assert.equal(timeline[1].summaryMessage?.key, 'timeline.command.status')
  assert.equal(timeline[1].detailMessage?.key, 'timeline.command.detail')
  assert.equal(JSON.stringify(timeline[1]).includes('continue'), false)
})

test('Conversation timeline presents approval and lifecycle events as safe status entries', () => {
  const timeline = buildEventTimeline(projection({
    recentEvents: [
      { seq: 6, type: 'approval/asked', time: 6, data: { toolName: 'shell', arguments: 'private' } },
      { seq: 7, type: 'approval/decided', time: 7, data: { outcome: 'allowed-once' } },
      { seq: 8, type: 'turn/end', time: 8, data: { reason: { kind: 'completed', secret: 'private' } } },
    ],
  }))
  assert.deepEqual(timeline.map(item => item.kind), ['approval', 'approval', 'status'])
  assert.equal(timeline[0].summary, '需要审批：shell')
  assert.equal(timeline[0].titleMessage?.key, 'timeline.event.approvalPending')
  assert.equal(timeline[0].detailMessage?.key, 'timeline.detail.generic')
  assert.equal(timeline[1].summary, '审批结果已由 PC Harness 确认')
  assert.equal(timeline[2].summary, '本轮请求已完成')
  assert.equal(JSON.stringify(timeline).includes('private'), false)
})

test('Conversation timeline keeps raw compatibility labels while exposing locale-ready metadata', () => {
  const timeline = buildEventTimeline(projection({
    conversation: [{ id: 'assistant-1', role: 'assistant', text: 'ok', startSeq: 2, endSeq: 3, time: Date.parse('2026-08-25T01:02:03.000Z'), streaming: false }],
  }))
  assert.equal(timeline[0].timestamp, Date.parse('2026-08-25T01:02:03.000Z'))
  assert.equal(timeline[0].sequence, 3)
  assert.match(timeline[0].meta, /seq 3/)
  assert.equal(timelineTimeLabel(0), '时间未知')
})

test('Conversation projection groups process events and keeps command status out of the transcript', () => {
  const timeline = buildConversationTimeline(projection({
    conversation: [{ id: 'assistant-1', role: 'assistant', text: 'done', startSeq: 1, endSeq: 1, time: 1, streaming: false }],
    recentEvents: [
      { seq: 2, type: 'tool/call', time: 2, data: { name: 'shell', arguments: 'hidden' } },
      { seq: 3, type: 'tool/result', time: 3, data: { output: 'hidden' } },
      { seq: 4, type: 'step/end', time: 4, data: { turn: 1, step: 1 } },
    ],
  }), {
    commandId: 'command-1',
    sessionId: 'session-1',
    commandType: 'session.prompt',
    baseSeq: 1,
    status: 'queued',
    expiresAt: '2026-08-25T01:00:00.000Z',
  })
  assert.deepEqual(timeline.map(item => item.kind), ['message', 'activity'])
  assert.equal(timeline[1].events.length, 3)
  assert.equal(JSON.stringify(timeline).includes('hidden'), false)
})

test('Conversation refresh reuses semantically unchanged SQLite projections', () => {
  const previous = projection({
    conversation: [{ id: 'assistant-1', role: 'assistant', text: 'done', startSeq: 1, endSeq: 1, time: 1, streaming: false }],
    recentEvents: [{ seq: 1, type: 'assistant/message', time: 1, data: { text: 'done' } }],
  })
  const restored = projection({
    conversation: [...previous.conversation],
    recentEvents: [...previous.recentEvents],
  })

  assert.notEqual(previous, restored)
  assert.equal(isSameConversationProjection(previous, restored), true)
  assert.equal(isSameConversationProjection(undefined, restored), false)
})

test('Conversation refresh publishes every scalar change visible to the Session screen', () => {
  const previous = projection()
  const changes = [
    { title: 'Renamed' },
    { status: 'completed' },
    { lastSeq: 9 },
    { lastActivityAt: 9 },
    { conversationVersion: 3 },
    { historyLoaded: false },
    { unresolvedApproval: { approvalId: 'approval-1', toolName: 'shell' } },
  ]

  for (const change of changes) {
    assert.equal(isSameConversationProjection(previous, projection(change)), false, JSON.stringify(change))
  }
})
