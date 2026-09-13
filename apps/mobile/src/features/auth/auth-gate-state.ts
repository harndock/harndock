import { GatewayApiError } from '../../sync/gateway-api'
import type { GatewayAccountProfile, GatewayAuthApi } from '../../sync/gateway-auth-api'
import { normalizeGatewayOrigin } from '../../sync/gateway-url'
import {
  mobileSessionState,
  type MobileAuthSession,
  type MobileSessionAccount,
  type MobileSessionDevice,
} from '../../sync/mobile-session'

export type AuthExitReason =
  | 'authentication_required'
  | 'device_revoked'
  | 'missing_session'
  | 'refresh_expired'
  | 'signed_out'

export interface AuthenticatedAuthGateState {
  readonly status: 'authenticated'
  readonly mode: 'session' | 'development'
  readonly gatewayOrigin: string
  readonly account?: MobileSessionAccount
  readonly device?: MobileSessionDevice
  readonly scopes: readonly string[]
}

export type AuthGateState =
  | { readonly status: 'loading'; readonly phase: 'restoring' | 'refreshing' | 'signing_out' }
  | AuthenticatedAuthGateState
  | { readonly status: 'unauthenticated'; readonly reason: AuthExitReason }
  | { readonly status: 'recovery_error'; readonly message: string }

export interface AuthGateServices {
  readonly allowLegacyDevelopmentSession?: boolean
  readonly loadSession: () => Promise<MobileAuthSession | null>
  readonly loadLegacyAccessToken: () => Promise<string | null>
  readonly loadGatewayOrigin: () => Promise<string | null>
  readonly saveSession: (session: MobileAuthSession) => Promise<void>
  readonly clearInstallationId: () => Promise<void>
  readonly clearSession: () => Promise<void>
  readonly authApi: (gatewayOrigin: string) => Pick<GatewayAuthApi, 'logout' | 'profile' | 'refresh'>
  readonly now?: () => number
}

export async function restoreAuthGate(services: AuthGateServices): Promise<AuthGateState> {
  try {
    const session = await services.loadSession()
    if (session === null) return restoreDevelopmentSession(services)
    const state = mobileSessionState(session, services.now?.() ?? Date.now())
    if (state === 'refresh_expired') return clearAndExit(services, 'refresh_expired')
    if (state === 'access_expired') return refreshSession(services, session)
    try {
      const profile = await services.authApi(session.gatewayOrigin).profile(session.accessToken)
      if (!profileMatchesSession(profile, session)) {
        return clearAndExit(services, 'authentication_required')
      }
      return sessionAuthState(session, profile)
    } catch (error) {
      if (isDeviceRevoked(error)) return clearRevokedDeviceAndExit(services)
      if (isAuthenticationRejection(error)) return refreshSession(services, session)
      return recoveryError(error, '无法验证 Gateway 会话，请检查网络后重试。')
    }
  } catch (error) {
    return recoveryError(error, '无法读取本机安全会话，请重试。')
  }
}

export async function refreshAuthGate(services: AuthGateServices): Promise<AuthGateState> {
  try {
    const session = await services.loadSession()
    if (session === null) return clearAndExit(services, 'missing_session')
    if (mobileSessionState(session, services.now?.() ?? Date.now()) === 'refresh_expired') {
      return clearAndExit(services, 'refresh_expired')
    }
    return refreshSession(services, session)
  } catch (error) {
    return recoveryError(error, '无法读取本机安全会话，请重试。')
  }
}

export async function revokeAuthGate(
  services: AuthGateServices,
  error?: unknown,
): Promise<AuthGateState> {
  if (isDeviceRevoked(error)) return clearRevokedDeviceAndExit(services)
  return refreshAuthGate(services)
}

export async function logoutAuthGate(services: AuthGateServices): Promise<AuthGateState> {
  let session: MobileAuthSession | null = null
  try {
    session = await services.loadSession()
    if (session !== null) {
      await services.authApi(session.gatewayOrigin).logout(session.refreshToken)
    }
  } catch {
    // Local sign-out is authoritative on this device. A failed remote request must
    // not leave refresh credentials accessible to the app.
  }
  return clearAndExit(services, 'signed_out')
}

export function developmentAuthState(gatewayOrigin: string): AuthenticatedAuthGateState {
  return {
    gatewayOrigin,
    mode: 'development',
    scopes: [],
    status: 'authenticated',
  }
}

export function sessionAuthState(
  session: MobileAuthSession,
  profile?: GatewayAccountProfile,
): AuthenticatedAuthGateState {
  return {
    account: profile?.account ?? session.account,
    device: profile?.device ?? session.device,
    gatewayOrigin: session.gatewayOrigin,
    mode: 'session',
    scopes: session.scopes,
    status: 'authenticated',
  }
}

export function isAuthenticationRejection(error: unknown): boolean {
  return error instanceof GatewayApiError && (
    error.status === 401
    || error.code === 'authentication_denied'
    || error.code === 'authentication_required'
    || error.code === 'device_revoked'
  )
}

async function restoreDevelopmentSession(services: AuthGateServices): Promise<AuthGateState> {
  const [accessToken, gatewayOrigin] = await Promise.all([
    services.loadLegacyAccessToken(),
    services.loadGatewayOrigin(),
  ])
  if (accessToken === null) {
    return { reason: 'missing_session', status: 'unauthenticated' }
  }
  if (services.allowLegacyDevelopmentSession !== true) {
    return clearAndExit(services, 'missing_session')
  }
  if (gatewayOrigin === null) return clearAndExit(services, 'authentication_required')
  const normalizedOrigin = normalizeGatewayOrigin(gatewayOrigin)
  if (normalizedOrigin === undefined) return clearAndExit(services, 'authentication_required')
  try {
    await services.authApi(normalizedOrigin).profile(accessToken)
    return developmentAuthState(normalizedOrigin)
  } catch (error) {
    if (isDeviceRevoked(error)) return clearRevokedDeviceAndExit(services)
    if (isAuthenticationRejection(error)) return clearAndExit(services, 'authentication_required')
    return recoveryError(error, '无法验证开发凭据，请检查网络后重试。')
  }
}

async function refreshSession(
  services: AuthGateServices,
  session: MobileAuthSession,
): Promise<AuthGateState> {
  try {
    const rotated = await services.authApi(session.gatewayOrigin).refresh(session.refreshToken)
    if (rotated.account.accountId !== session.account.accountId
      || rotated.device.deviceId !== session.device.deviceId) {
      return clearAndExit(services, 'authentication_required')
    }
    await services.saveSession(rotated)
    return sessionAuthState(rotated)
  } catch (error) {
    if (isDeviceRevoked(error)) return clearRevokedDeviceAndExit(services)
    if (isAuthenticationRejection(error)) return clearAndExit(services, 'authentication_required')
    return recoveryError(error, 'Gateway 会话刷新失败，请检查网络后重试。')
  }
}

async function clearAndExit(
  services: AuthGateServices,
  reason: AuthExitReason,
): Promise<AuthGateState> {
  try {
    await services.clearSession()
    return { reason, status: 'unauthenticated' }
  } catch (error) {
    return recoveryError(error, '无法清除本机安全会话，请重试。')
  }
}

async function clearRevokedDeviceAndExit(services: AuthGateServices): Promise<AuthGateState> {
  try {
    // A revoked installation cannot be revived by Gateway. Rotate it before
    // clearing the session so the next explicit login registers a new device.
    await services.clearInstallationId()
    await services.clearSession()
    return { reason: 'device_revoked', status: 'unauthenticated' }
  } catch (error) {
    return recoveryError(error, '无法清除已撤销设备的本机身份，请重试。')
  }
}

function profileMatchesSession(profile: GatewayAccountProfile, session: MobileAuthSession): boolean {
  return profile.account.accountId === session.account.accountId
    && profile.device.deviceId === session.device.deviceId
}

function isDeviceRevoked(error: unknown): boolean {
  return error instanceof GatewayApiError && error.code === 'device_revoked'
}

function recoveryError(error: unknown, fallback: string): AuthGateState {
  return {
    message: error instanceof GatewayApiError && error.message.length > 0 ? error.message : fallback,
    status: 'recovery_error',
  }
}
