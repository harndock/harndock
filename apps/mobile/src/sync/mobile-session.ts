import { normalizeGatewayOrigin, type GatewayProtocol } from './gateway-url'

export const MOBILE_SESSION_SCHEMA_VERSION = 1 as const

export interface MobileSessionAccount {
  readonly accountId: string
  readonly displayName: string
  readonly username: string
  readonly status: string
}

export interface MobileSessionDevice {
  readonly deviceId: string
  readonly name: string
  readonly platform: string
}

export interface MobileAuthSession {
  readonly schemaVersion: typeof MOBILE_SESSION_SCHEMA_VERSION
  readonly gatewayOrigin: string
  readonly account: MobileSessionAccount
  readonly device: MobileSessionDevice
  readonly accessToken: string
  readonly accessTokenExpiresAt: string
  readonly refreshToken: string
  readonly refreshTokenExpiresAt: string
  readonly scopes: readonly string[]
}

export type MobileSessionState = 'valid' | 'access_expired' | 'refresh_expired'

interface StoredMobileSessionMetadata {
  readonly schemaVersion: typeof MOBILE_SESSION_SCHEMA_VERSION
  readonly gatewayOrigin: string
  readonly account: MobileSessionAccount
  readonly device: MobileSessionDevice
  readonly accessTokenExpiresAt: string
  readonly refreshTokenExpiresAt: string
  readonly scopes: readonly string[]
}

export function parseMobileAuthSession(
  value: unknown,
  allowedProtocols?: readonly GatewayProtocol[],
): MobileAuthSession | undefined {
  if (!isRecord(value) || value.schemaVersion !== MOBILE_SESSION_SCHEMA_VERSION) return undefined
  const gatewayOrigin = typeof value.gatewayOrigin === 'string'
    ? normalizeGatewayOrigin(value.gatewayOrigin, allowedProtocols)
    : undefined
  const account = parseAccount(value.account)
  const device = parseDevice(value.device)
  const accessTokenExpiresAt = parseTimestamp(value.accessTokenExpiresAt)
  const refreshTokenExpiresAt = parseTimestamp(value.refreshTokenExpiresAt)
  const accessToken = parseToken(value.accessToken, 32)
  const refreshToken = parseToken(value.refreshToken, 64)
  const scopes = parseScopes(value.scopes)
  if (gatewayOrigin === undefined || account === undefined || device === undefined
    || accessTokenExpiresAt === undefined || refreshTokenExpiresAt === undefined
    || Date.parse(accessTokenExpiresAt) > Date.parse(refreshTokenExpiresAt)
    || accessToken === undefined || refreshToken === undefined || scopes === undefined) {
    return undefined
  }
  return {
    accessToken,
    accessTokenExpiresAt,
    account,
    device,
    gatewayOrigin,
    refreshToken,
    refreshTokenExpiresAt,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    scopes,
  }
}

export function serializeMobileSessionMetadata(session: MobileAuthSession): string {
  const metadata: StoredMobileSessionMetadata = {
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    account: session.account,
    device: session.device,
    gatewayOrigin: session.gatewayOrigin,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    scopes: session.scopes,
  }
  return JSON.stringify(metadata)
}

export function parseStoredMobileSession(
  accessToken: string,
  refreshToken: string,
  metadataJson: string,
  allowedProtocols?: readonly GatewayProtocol[],
): MobileAuthSession | undefined {
  let metadata: unknown
  try {
    metadata = JSON.parse(metadataJson)
  } catch {
    return undefined
  }
  return parseMobileAuthSession({
    ...(isRecord(metadata) ? metadata : {}),
    accessToken,
    refreshToken,
  }, allowedProtocols)
}

export function mobileSessionState(session: MobileAuthSession, now = Date.now()): MobileSessionState {
  if (Date.parse(session.refreshTokenExpiresAt) <= now) return 'refresh_expired'
  if (Date.parse(session.accessTokenExpiresAt) <= now) return 'access_expired'
  return 'valid'
}

function parseAccount(value: unknown): MobileSessionAccount | undefined {
  if (!isRecord(value)) return undefined
  const accountId = parseText(value.accountId, 1, 256)
  const displayName = parseText(value.displayName, 1, 256)
  const username = parseText(value.username, 1, 320)
  const status = parseText(value.status, 1, 64)
  return accountId === undefined || displayName === undefined || username === undefined || status === undefined
    ? undefined
    : { accountId, displayName, status, username }
}

function parseDevice(value: unknown): MobileSessionDevice | undefined {
  if (!isRecord(value)) return undefined
  const deviceId = parseText(value.deviceId, 1, 256)
  const name = parseText(value.name, 1, 256)
  const platform = parseText(value.platform, 1, 64)
  return deviceId === undefined || name === undefined || platform === undefined
    ? undefined
    : { deviceId, name, platform }
}

function parseScopes(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined
  const scopes = value.map(item => parseText(item, 1, 128))
  if (scopes.some(scope => scope === undefined)) return undefined
  return [...new Set(scopes as string[])]
}

function parseToken(value: unknown, minimumLength: number): string | undefined {
  return typeof value === 'string'
    && value.length >= minimumLength
    && value.length <= 4_096
    && /^[A-Za-z0-9_-]+$/.test(value)
    ? value
    : undefined
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  const normalized = new Date(timestamp).toISOString()
  return value === normalized ? normalized : undefined
}

function parseText(value: unknown, minimumLength: number, maximumLength: number): string | undefined {
  return typeof value === 'string' && value.length >= minimumLength && value.length <= maximumLength
    ? value
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
