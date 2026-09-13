import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accountInitials,
  mobileSettingsSummary,
  redactIdentifier,
} from '../src/features/settings/settings-model.ts'

const auth = {
  status: 'authenticated',
  mode: 'session',
  gatewayOrigin: 'https://gateway.example.test:7019',
  account: {
    accountId: 'account-secret-id',
    displayName: 'Admin User',
    username: 'admin',
    status: 'active',
  },
  device: {
    deviceId: 'mobile-device-secret-id',
    name: 'Pixel 9',
    platform: 'android',
  },
  scopes: ['session.read', 'session.control'],
}

function projection(overrides = {}) {
  return {
    sessionId: 'session-secret-id',
    runtimeId: 'runtime-secret-id',
    title: 'Private customer task',
    cwdLabel: '/private/customer/repository',
    createdAt: 1,
    parentSessionId: null,
    status: 'running',
    lastSeq: 42,
    lastActivityAt: 100,
    unresolvedApproval: { approvalId: 'approval-secret-id', toolName: 'shell' },
    conversationVersion: 2,
    conversation: [{
      id: 'message-secret-id',
      role: 'user',
      text: 'private prompt body',
      startSeq: 1,
      endSeq: 1,
      time: 1,
      streaming: false,
    }],
    historyLoaded: true,
    recentEvents: [{ seq: 2, type: 'tool/result', time: 2, data: { token: 'access-secret-value' } }],
    ...overrides,
  }
}

function directory(overrides = {}) {
  return {
    connectionState: 'connected',
    devices: [{
      deviceId: 'desktop-device-secret-id',
      deviceType: 'desktop',
      name: 'Office Mac',
      platform: 'darwin',
      status: 'active',
      runtimeCount: 1,
      onlineRuntimeCount: 1,
    }],
    inventoryMessage: '',
    runtimes: [{
      runtimeId: 'runtime-secret-id',
      deviceId: 'desktop-device-secret-id',
      profile: 'default',
      status: 'online',
      lastHeartbeatAt: new Date().toISOString(),
    }],
    sessions: [projection()],
    syncMessage: '',
    ...overrides,
  }
}

test('MP-05 derives account, Runtime, stream, and current cursor from real controller state', () => {
  const summary = mobileSettingsSummary(auth, directory(), 'session-secret-id')

  assert.equal(summary.account.value, 'Admin User')
  assert.match(summary.device.detail, /^android · mobi…t-id$/)
  assert.equal(summary.gateway.value, 'https://gateway.example.test:7019')
  assert.equal(summary.runtime.value, 'Office Mac · 在线')
  assert.equal(summary.stream.value, '已连接')
  assert.match(summary.stream.detail, /1 个 Session · 无历史补发/)
  assert.equal(summary.cursor.value, 'seq 42')
  assert.equal(summary.cursor.detail, '已跟上确认历史')
  assert.equal(summary.hasDiagnosticIssue, false)
  assert.equal(summary.runtime.valueMessage?.key, 'pc.title.online')
  assert.equal(summary.stream.valueMessage?.key, 'status.connection.connected')
  assert.equal(summary.cursor.detailMessage?.key, 'settings.row.cursorSynced')
})

test('MP-05 diagnostic output excludes event bodies and opaque resource identifiers', () => {
  const serialized = JSON.stringify(mobileSettingsSummary(auth, directory(), 'session-secret-id'))

  for (const secret of [
    'account-secret-id',
    'mobile-device-secret-id',
    'desktop-device-secret-id',
    'session-secret-id',
    'runtime-secret-id',
    'Private customer task',
    '/private/customer/repository',
    'approval-secret-id',
    'private prompt body',
    'access-secret-value',
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`)
  }
})

test('MP-05 reports replay and sanitized failure state without server error text', () => {
  const summary = mobileSettingsSummary(auth, directory({
    inventoryMessage: '设备失败：database password leaked',
    sessions: [projection({ historyLoaded: false })],
    syncMessage: '同步失败：internal-stack-and-token',
  }))
  const serialized = JSON.stringify(summary)

  assert.equal(summary.hasDiagnosticIssue, true)
  assert.match(summary.stream.detail, /1 个正在补发/)
  assert.equal(summary.cursor.detail, '正在补发确认历史')
  assert.equal(serialized.includes('database password leaked'), false)
  assert.equal(serialized.includes('internal-stack-and-token'), false)
})

test('MP-05 keeps navigation identity compact and masks device identifiers', () => {
  assert.equal(accountInitials(auth), 'AU')
  assert.equal(redactIdentifier('mobile-device-secret-id'), 'mobi…t-id')
  assert.equal(redactIdentifier('short'), '••••')
})
