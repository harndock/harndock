import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MOBILE_SESSION_SCHEMA_VERSION,
  mobileSessionState,
  parseMobileAuthSession,
  parseStoredMobileSession,
  serializeMobileSessionMetadata,
} from '../src/sync/mobile-session.ts'
import { createSecureMobileSessionStore } from '../src/sync/secure-session-store.ts'

const session = (suffix = 'one', overrides = {}) => ({
  schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
  gatewayOrigin: 'https://sync.example.test',
  account: {
    accountId: 'acct_test',
    displayName: 'Gateway administrator',
    username: 'admin',
    status: 'active',
  },
  device: {
    deviceId: 'dev_mobile',
    name: 'Test phone',
    platform: 'android',
  },
  accessToken: `access_${suffix}_${'a'.repeat(40)}`,
  accessTokenExpiresAt: '2026-08-24T11:15:00.000Z',
  refreshToken: `refresh_${suffix}_${'r'.repeat(64)}`,
  refreshTokenExpiresAt: '2026-09-24T11:00:00.000Z',
  scopes: ['session.read', 'session.control'],
  ...overrides,
})

class MemorySecureDriver {
  values = new Map()
  operations = []
  failNextActiveWrite = false

  async get(key) {
    this.operations.push(`get:${key}`)
    return this.values.get(key) ?? null
  }

  async set(key, value) {
    this.operations.push(`set:${key}`)
    if (this.failNextActiveWrite && key === 'gateway.session.v1.active') {
      this.failNextActiveWrite = false
      throw new Error('simulated pointer failure')
    }
    this.values.set(key, value)
  }

  async delete(key) {
    this.operations.push(`delete:${key}`)
    this.values.delete(key)
  }
}

test('Mobile session metadata excludes tokens and round-trips the server contract', () => {
  const current = session()
  const parsed = parseMobileAuthSession(current)
  assert.deepEqual(parsed, current)
  const metadata = serializeMobileSessionMetadata(parsed)
  assert.equal(metadata.includes(current.accessToken), false)
  assert.equal(metadata.includes(current.refreshToken), false)
  assert.deepEqual(Object.keys(JSON.parse(metadata)).sort(), [
    'accessTokenExpiresAt',
    'account',
    'device',
    'gatewayOrigin',
    'refreshTokenExpiresAt',
    'schemaVersion',
    'scopes',
  ])
  assert.deepEqual(parseStoredMobileSession(current.accessToken, current.refreshToken, metadata), current)
})

test('Mobile session parsing rejects unsafe origins, malformed tokens, and inverted expiry', () => {
  assert.equal(parseMobileAuthSession(session('public', {
    gatewayOrigin: 'http://sync.example.test:7019',
  }), ['http:', 'https:']), undefined)
  assert.equal(parseMobileAuthSession(session('token', {
    refreshToken: 'not a valid refresh token',
  })), undefined)
  assert.equal(parseMobileAuthSession(session('expiry', {
    accessTokenExpiresAt: '2026-10-24T11:15:00.000Z',
  })), undefined)
  assert.equal(parseMobileAuthSession(session('timestamp', {
    accessTokenExpiresAt: '2026-08-24 11:15:00Z',
  })), undefined)
  assert.equal(parseMobileAuthSession(session('scopes', {
    scopes: Array.from({ length: 65 }, (_, index) => `scope.${index}`),
  })), undefined)
})

test('Mobile session state distinguishes access expiry from refresh expiry', () => {
  const current = parseMobileAuthSession(session())
  assert.equal(mobileSessionState(current, Date.parse('2026-08-24T11:00:00.000Z')), 'valid')
  assert.equal(mobileSessionState(current, Date.parse('2026-08-24T11:16:00.000Z')), 'access_expired')
  assert.equal(mobileSessionState(current, Date.parse('2026-09-24T11:00:00.000Z')), 'refresh_expired')
})

test('Secure session store rotates complete generations without mixing tokens', async () => {
  const driver = new MemorySecureDriver()
  const store = createSecureMobileSessionStore(driver)
  const first = session('first')
  const second = session('second')

  await store.save(first)
  assert.equal(driver.values.get('gateway.session.v1.active'), 'a')
  assert.deepEqual(await store.load(), first)

  await store.save(second)
  assert.equal(driver.values.get('gateway.session.v1.active'), 'b')
  assert.deepEqual(await store.load(), second)
  assert.equal(driver.values.has('gateway.session.v1.a.access'), false)
  assert.equal(driver.values.has('gateway.session.v1.a.refresh'), false)
  assert.equal(driver.values.has('gateway.session.v1.a.metadata'), false)
})

test('Secure session store keeps the previous generation when pointer commit fails', async () => {
  const driver = new MemorySecureDriver()
  const store = createSecureMobileSessionStore(driver)
  const first = session('first')
  await store.save(first)

  driver.failNextActiveWrite = true
  await assert.rejects(store.save(session('second')), /simulated pointer failure/)
  assert.equal(driver.values.get('gateway.session.v1.active'), 'a')
  assert.deepEqual(await store.load(), first)
  assert.equal(driver.values.has('gateway.session.v1.b.access'), false)
  assert.equal(driver.values.has('gateway.session.v1.b.refresh'), false)
})

test('Secure session restore clears an incomplete or malformed active generation', async () => {
  const driver = new MemorySecureDriver()
  driver.values.set('gateway.session.v1.active', 'a')
  driver.values.set('gateway.session.v1.a.access', session().accessToken)
  driver.values.set('gateway.session.v1.a.refresh', session().refreshToken)
  driver.values.set('gateway.session.v1.a.metadata', '{"schemaVersion":99}')
  const store = createSecureMobileSessionStore(driver)
  assert.equal(await store.load(), null)
  assert.deepEqual([...driver.values.entries()], [])
})

test('Secure session clear removes the pointer before every token slot', async () => {
  const driver = new MemorySecureDriver()
  const store = createSecureMobileSessionStore(driver)
  await store.save(session())
  driver.operations.length = 0
  await store.clear()
  assert.equal(driver.operations[0], 'delete:gateway.session.v1.active')
  assert.equal(await store.load(), null)
  assert.deepEqual([...driver.values.entries()], [])
})
