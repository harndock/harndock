import assert from 'node:assert/strict'
import test from 'node:test'
import {
  logoutAuthGate,
  restoreAuthGate,
  revokeAuthGate,
} from '../src/features/auth/auth-gate-state.ts'
import { GatewayApiError } from '../src/sync/gateway-api.ts'
import { GatewayAuthApi } from '../src/sync/gateway-auth-api.ts'
import { MOBILE_SESSION_SCHEMA_VERSION } from '../src/sync/mobile-session.ts'

const now = Date.parse('2026-08-24T11:00:00.000Z')

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

function profile(current = session()) {
  return { account: current.account, device: current.device }
}

function services(overrides = {}) {
  const current = session()
  const calls = { clear: 0, clearInstallation: 0, save: [], profile: 0, refresh: 0, logout: 0 }
  const result = {
    allowLegacyDevelopmentSession: true,
    calls,
    loadSession: async () => current,
    loadLegacyAccessToken: async () => null,
    loadGatewayOrigin: async () => null,
    saveSession: async value => { calls.save.push(value) },
    clearInstallationId: async () => { calls.clearInstallation += 1 },
    clearSession: async () => { calls.clear += 1 },
    authApi: () => ({
      profile: async () => { calls.profile += 1; return profile(current) },
      refresh: async () => { calls.refresh += 1; return session('rotated') },
      logout: async () => { calls.logout += 1 },
    }),
    now: () => now,
    ...overrides,
  }
  return result
}

test('GatewayAuthApi uses the native login, refresh, profile, and logout contracts', async () => {
  const calls = []
  const rotated = session('rotated')
  const api = new GatewayAuthApi({
    baseUrl: 'https://sync.example.test/',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/v1/auth/login')) {
        const { gatewayOrigin, schemaVersion, ...serverSession } = rotated
        assert.equal(gatewayOrigin, 'https://sync.example.test')
        assert.equal(schemaVersion, 1)
        return response(200, serverSession)
      }
      if (url.endsWith('/v1/auth/refresh')) {
        const { gatewayOrigin, schemaVersion, ...serverSession } = rotated
        assert.equal(gatewayOrigin, 'https://sync.example.test')
        assert.equal(schemaVersion, 1)
        return response(200, serverSession)
      }
      if (url.endsWith('/v1/me')) return response(200, profile(rotated))
      if (url.endsWith('/v1/auth/logout')) return response(204)
      throw new Error(`unexpected request: ${url}`)
    },
  })

  assert.deepEqual(await api.login({
    deviceName: 'Harndock Mobile',
    installationId: 'mobile:11111111-2222-4333-8444-555555555555',
    password: 'test-password-only',
    platform: 'android',
    username: 'admin',
  }), rotated)
  assert.deepEqual(await api.refresh(session().refreshToken), rotated)
  assert.deepEqual(await api.profile(rotated.accessToken), profile(rotated))
  await api.logout(rotated.refreshToken)

  assert.deepEqual(calls.map(call => call.url), [
    'https://sync.example.test/v1/auth/login',
    'https://sync.example.test/v1/auth/refresh',
    'https://sync.example.test/v1/me',
    'https://sync.example.test/v1/auth/logout',
  ])
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    deviceName: 'Harndock Mobile',
    installationId: 'mobile:11111111-2222-4333-8444-555555555555',
    password: 'test-password-only',
    platform: 'android',
    username: 'admin',
  })
  assert.deepEqual(JSON.parse(calls[1].init.body), { refreshToken: session().refreshToken })
  assert.equal(calls[2].init.headers.Authorization, `Bearer ${rotated.accessToken}`)
  assert.deepEqual(JSON.parse(calls[3].init.body), { refreshToken: rotated.refreshToken })
})

test('AuthGate verifies a valid server session before exposing protected navigation', async () => {
  const runtime = services()
  const state = await restoreAuthGate(runtime)
  assert.equal(state.status, 'authenticated')
  assert.equal(state.mode, 'session')
  assert.equal(state.gatewayOrigin, 'https://sync.example.test')
  assert.equal('accessToken' in state, false)
  assert.equal(runtime.calls.profile, 1)
  assert.equal(runtime.calls.refresh, 0)
})

test('AuthGate rotates an expired access token exactly once and persists it before entry', async () => {
  const expired = session('expired', { accessTokenExpiresAt: '2026-08-24T10:59:59.000Z' })
  const runtime = services({ loadSession: async () => expired })
  const state = await restoreAuthGate(runtime)
  assert.equal(state.status, 'authenticated')
  assert.equal(runtime.calls.profile, 0)
  assert.equal(runtime.calls.refresh, 1)
  assert.deepEqual(runtime.calls.save, [session('rotated')])
})

test('AuthGate retries a rejected valid access token through refresh rotation', async () => {
  const runtime = services()
  runtime.authApi = () => ({
    profile: async () => {
      runtime.calls.profile += 1
      throw new GatewayApiError('access expired', 401, 'authentication_required')
    },
    refresh: async () => {
      runtime.calls.refresh += 1
      return session('rotated')
    },
    logout: async () => undefined,
  })
  const state = await restoreAuthGate(runtime)
  assert.equal(state.status, 'authenticated')
  assert.equal(runtime.calls.profile, 1)
  assert.equal(runtime.calls.refresh, 1)
})

test('AuthGate clears an expired refresh session without contacting Gateway', async () => {
  const expired = session('expired', {
    accessTokenExpiresAt: '2026-08-24T10:00:00.000Z',
    refreshTokenExpiresAt: '2026-08-24T11:00:00.000Z',
  })
  const runtime = services({ loadSession: async () => expired })
  const state = await restoreAuthGate(runtime)
  assert.deepEqual(state, { reason: 'refresh_expired', status: 'unauthenticated' })
  assert.equal(runtime.calls.clear, 1)
  assert.equal(runtime.calls.refresh, 0)
})

test('AuthGate keeps credentials blocked behind retry on transient verification failure', async () => {
  const runtime = services()
  runtime.authApi = () => ({
    profile: async () => { throw new Error('network unavailable') },
    refresh: async () => session('rotated'),
    logout: async () => undefined,
  })
  const state = await restoreAuthGate(runtime)
  assert.deepEqual(state, {
    message: '无法验证 Gateway 会话，请检查网络后重试。',
    status: 'recovery_error',
  })
  assert.equal(runtime.calls.clear, 0)
})

test('AuthGate handles device revocation as a terminal local session', async () => {
  const runtime = services()
  const state = await revokeAuthGate(runtime, new GatewayApiError('revoked', 401, 'device_revoked'))
  assert.deepEqual(state, { reason: 'device_revoked', status: 'unauthenticated' })
  assert.equal(runtime.calls.clear, 1)
  assert.equal(runtime.calls.clearInstallation, 1)
  assert.equal(runtime.calls.refresh, 0)
})

test('AuthGate logout preserves the stable installation identity', async () => {
  const runtime = services()
  const state = await logoutAuthGate(runtime)
  assert.deepEqual(state, { reason: 'signed_out', status: 'unauthenticated' })
  assert.equal(runtime.calls.logout, 1)
  assert.equal(runtime.calls.clear, 1)
  assert.equal(runtime.calls.clearInstallation, 0)
})

test('AuthGate restores only an explicit legacy development token when no formal session exists', async () => {
  const runtime = services({
    loadSession: async () => null,
    loadLegacyAccessToken: async () => `legacy_${'x'.repeat(40)}`,
    loadGatewayOrigin: async () => 'https://sync.example.test',
  })
  const state = await restoreAuthGate(runtime)
  assert.deepEqual(state, {
    gatewayOrigin: 'https://sync.example.test',
    mode: 'development',
    scopes: [],
    status: 'authenticated',
  })
  assert.equal(runtime.calls.profile, 1)
})

test('AuthGate never exposes protected navigation for an unsafe legacy origin', async () => {
  const runtime = services({
    loadSession: async () => null,
    loadLegacyAccessToken: async () => `legacy_${'x'.repeat(40)}`,
    loadGatewayOrigin: async () => 'https://sync.example.test/v1',
  })
  const state = await restoreAuthGate(runtime)
  assert.deepEqual(state, { reason: 'authentication_required', status: 'unauthenticated' })
  assert.equal(runtime.calls.clear, 1)
  assert.equal(runtime.calls.profile, 0)
})

test('AuthGate purges legacy development tokens when the explicit debug gate is disabled', async () => {
  const runtime = services({
    allowLegacyDevelopmentSession: false,
    loadSession: async () => null,
    loadLegacyAccessToken: async () => `legacy_${'x'.repeat(40)}`,
    loadGatewayOrigin: async () => 'https://sync.example.test',
  })
  const state = await restoreAuthGate(runtime)
  assert.deepEqual(state, { reason: 'missing_session', status: 'unauthenticated' })
  assert.equal(runtime.calls.clear, 1)
  assert.equal(runtime.calls.profile, 0)
})

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body === undefined ? '' : JSON.stringify(body),
  }
}
