import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupSessionDirectory,
  pcConnectionSummary,
  sessionActivityLabel,
  sessionActivityMessage,
  sessionDirectorySummary,
  sessionDirectorySummaryMessage,
} from '../src/features/sessions/directory-model.ts'

function session(overrides = {}) {
  return {
    sessionId: 'session-default',
    runtimeId: 'runtime-1',
    title: 'Default session',
    cwdLabel: 'harndock',
    createdAt: 1,
    parentSessionId: null,
    status: 'idle',
    lastSeq: 1,
    lastActivityAt: 100,
    unresolvedApproval: null,
    conversationVersion: 2,
    conversation: [],
    historyLoaded: true,
    recentEvents: [],
    ...overrides,
  }
}

test('Session directory separates attention from recent and sorts each group stably', () => {
  const sections = groupSessionDirectory([
    session({ sessionId: 'recent-old', lastActivityAt: 10 }),
    session({ sessionId: 'approval', lastActivityAt: 20, unresolvedApproval: { approvalId: 'a1', toolName: 'shell' } }),
    session({ sessionId: 'recent-b', lastActivityAt: 30 }),
    session({ sessionId: 'waiting', lastActivityAt: 40, status: 'waiting' }),
    session({ sessionId: 'recent-a', lastActivityAt: 30 }),
  ])

  assert.deepEqual(sections.attention.map(item => item.sessionId), ['waiting', 'approval'])
  assert.deepEqual(sections.recent.map(item => item.sessionId), ['recent-a', 'recent-b', 'recent-old'])
})

test('Session activity labels use compact relative time', () => {
  const now = 10 * 24 * 60 * 60_000
  assert.equal(sessionActivityLabel(now - 10_000, now), '刚刚')
  assert.equal(sessionActivityLabel(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(sessionActivityLabel(now - 3 * 60 * 60_000, now), '3 小时前')
  assert.equal(sessionActivityLabel(now - 2 * 24 * 60 * 60_000, now), '2 天前')
  assert.equal(sessionActivityLabel(0, now), '活动时间未知')
})

test('Session directory exposes locale-neutral descriptors for rendered labels', () => {
  const now = 10 * 24 * 60 * 60_000
  assert.deepEqual(sessionActivityMessage(now - 5 * 60_000, now), { key: 'session.activity.minutesAgo', params: { count: 5 } })
  assert.deepEqual(sessionDirectorySummaryMessage(session({ historyLoaded: false })), { key: 'session.summary.syncingHistory' })
})

test('Session summary prioritizes approvals then latest visible conversation', () => {
  assert.equal(sessionDirectorySummary(session({
    unresolvedApproval: { approvalId: 'a1', toolName: 'filesystem' },
  })), '等待审批：filesystem')
  assert.equal(sessionDirectorySummary(session({
    conversation: [{ id: 'm1', role: 'assistant', text: '  已完成代码核验  ', startSeq: 1, endSeq: 1, time: 1, streaming: false }],
  })), '已完成代码核验')
  assert.equal(sessionDirectorySummary(session({ historyLoaded: false })), '正在同步对话历史')
})

test('PC summary selects the freshest online Runtime and includes Gateway state', () => {
  const summary = pcConnectionSummary(
    [{ deviceId: 'pc-1', deviceType: 'desktop', name: 'Office Mac', platform: 'darwin', status: 'active', runtimeCount: 2, onlineRuntimeCount: 1 }],
    [
      { runtimeId: 'r-old', deviceId: 'pc-1', profile: 'old', status: 'online', lastHeartbeatAt: '2026-08-25T01:00:00.000Z' },
      { runtimeId: 'r-new', deviceId: 'pc-1', profile: 'main', status: 'online', lastHeartbeatAt: '2026-08-25T01:01:30.000Z' },
    ],
    'connected',
    Date.parse('2026-08-25T01:02:00.000Z'),
  )

  assert.equal(summary.title, 'Office Mac · 在线')
  assert.match(summary.detail, /^main · 心跳 刚刚 · Gateway 已连接$/)
  assert.deepEqual(summary.titleMessage, { key: 'pc.title.online', params: { device: 'Office Mac' } })
  assert.equal(summary.detailMessage?.key, 'pc.detail.online')
  assert.equal(summary.tone, 'online')
})

test('PC summary distinguishes an offline paired PC from no paired PC', () => {
  const offline = pcConnectionSummary(
    [{ deviceId: 'pc-1', deviceType: 'desktop', name: 'Office Mac', platform: 'darwin', status: 'active', runtimeCount: 1, onlineRuntimeCount: 0 }],
    [],
    'connected',
  )
  assert.equal(offline.title, 'Office Mac · 离线')
  assert.equal(offline.tone, 'offline')

  const absent = pcConnectionSummary([], [], 'reconnecting')
  assert.equal(absent.title, '尚未连接 PC')
  assert.match(absent.detail, /重连中/)
  assert.equal(absent.tone, 'warning')
})
