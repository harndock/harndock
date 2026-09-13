import assert from 'node:assert/strict'
import test from 'node:test'
import { loginAdministrator } from '../src/features/auth/administrator-login.ts'
import { resolveManualTokenEntryEnabled } from '../src/features/auth/debug-token.ts'
import { GatewayApiError } from '../src/sync/gateway-api.ts'
import { mobileInstallationId, parseMobileInstallationId } from '../src/sync/mobile-installation.ts'
import { MOBILE_SESSION_SCHEMA_VERSION } from '../src/sync/mobile-session.ts'

const session = {
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
    name: 'Harndock Mobile',
    platform: 'android',
  },
  accessToken: `access_${'a'.repeat(40)}`,
  accessTokenExpiresAt: '2026-08-24T11:15:00.000Z',
  refreshToken: `refresh_${'r'.repeat(64)}`,
  refreshTokenExpiresAt: '2026-09-24T11:00:00.000Z',
  scopes: ['session.read', 'session.control'],
}

const input = {
  gatewayOrigin: 'https://sync.example.test/',
  username: ' admin ',
  password: 'test-password-only',
  deviceName: 'Harndock Mobile',
  platform: 'android',
}

function services(overrides = {}) {
  const calls = { login: [], logout: [], origins: [], sessions: [] }
  return {
    calls,
    authApi: () => ({
      login: async value => { calls.login.push(value); return session },
      logout: async value => { calls.logout.push(value) },
    }),
    loadInstallationId: async () => 'mobile:11111111-2222-4333-8444-555555555555',
    saveGatewayOrigin: async value => { calls.origins.push(value) },
    saveSession: async value => { calls.sessions.push(value) },
    ...overrides,
  }
}

test('Administrator login sends the native device contract and persists only the resulting session', async () => {
  const runtime = services()
  const result = await loginAdministrator(input, runtime)
  assert.deepEqual(result, { ok: true, session })
  assert.deepEqual(runtime.calls.login, [{
  deviceName: 'Harndock Mobile',
    installationId: 'mobile:11111111-2222-4333-8444-555555555555',
    password: 'test-password-only',
    platform: 'android',
    username: 'admin',
  }])
  assert.deepEqual(runtime.calls.origins, ['https://sync.example.test'])
  assert.deepEqual(runtime.calls.sessions, [session])
  assert.equal(JSON.stringify(runtime.calls.sessions).includes(input.password), false)
})

test('Administrator login rejects invalid local fields before touching storage or Gateway', async () => {
  const runtime = services()
  assert.deepEqual(await loginAdministrator({ ...input, gatewayOrigin: 'https://sync.example.test/v1' }, runtime), {
    code: 'invalid_origin',
    message: 'Gateway 必须是当前构建允许的安全 origin。',
    ok: false,
  })
  assert.equal(runtime.calls.login.length, 0)
  assert.equal(runtime.calls.origins.length, 0)

  const shortPassword = await loginAdministrator({ ...input, password: 'short' }, runtime)
  assert.equal(shortPassword.ok, false)
  assert.equal(shortPassword.code, 'invalid_password')
  assert.equal(runtime.calls.login.length, 0)
})

test('Administrator login maps credential denial and rate limiting without server detail leakage', async () => {
  for (const [error, code, message] of [
    [new GatewayApiError('internal credential detail', 401, 'authentication_denied'), 'authentication_denied', '管理员账号或密码不正确。'],
    [new GatewayApiError('raw limiter detail', 429, 'rate_limited'), 'rate_limited', '登录尝试次数过多，请稍后再试。'],
  ]) {
    const runtime = services({
      authApi: () => ({ login: async () => { throw error }, logout: async () => undefined }),
    })
    const result = await loginAdministrator(input, runtime)
    assert.deepEqual(result, { code, message, ok: false })
  }
})

test('Administrator login does not send a password when secure installation storage is unavailable', async () => {
  const runtime = services({
    loadInstallationId: async () => { throw new Error('secure store unavailable') },
  })
  const result = await loginAdministrator(input, runtime)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'storage_unavailable')
  assert.equal(runtime.calls.login.length, 0)
})

test('Administrator login revokes a newly issued remote session when local persistence fails', async () => {
  const runtime = services({
    saveSession: async () => { throw new Error('secure store unavailable') },
  })
  const result = await loginAdministrator(input, runtime)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'storage_unavailable')
  assert.deepEqual(runtime.calls.logout, [session.refreshToken])
})

test('Manual token entry requires both a development build and an explicit flag', () => {
  assert.equal(resolveManualTokenEntryEnabled(false, 'true'), false)
  assert.equal(resolveManualTokenEntryEnabled(true, undefined), false)
  assert.equal(resolveManualTokenEntryEnabled(true, 'false'), false)
  assert.equal(resolveManualTokenEntryEnabled(true, ' TRUE '), true)
})

test('Mobile installation IDs are stable server-compatible opaque identifiers', () => {
  const installationId = mobileInstallationId('11111111-2222-4333-8444-555555555555')
  assert.equal(installationId, 'mobile:11111111-2222-4333-8444-555555555555')
  assert.equal(parseMobileInstallationId(installationId), installationId)
  assert.equal(parseMobileInstallationId('too-short'), undefined)
  assert.equal(parseMobileInstallationId('mobile:not allowed'), undefined)
})
