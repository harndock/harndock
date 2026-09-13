import { GatewayApiError } from './gateway-api'
import { allowedGatewayProtocols, normalizeGatewayOrigin, type GatewayProtocol } from './gateway-url'
import {
  MOBILE_SESSION_SCHEMA_VERSION,
  parseMobileAuthSession,
  type MobileAuthSession,
  type MobileSessionAccount,
  type MobileSessionDevice,
} from './mobile-session'

export interface GatewayAccountProfile {
  readonly account: MobileSessionAccount
  readonly device: MobileSessionDevice
}

export interface GatewayAuthApiOptions {
  readonly baseUrl: string
  readonly fetchImpl?: typeof fetch
  readonly allowedProtocols?: readonly GatewayProtocol[]
}

export interface GatewayLoginInput {
  readonly username: string
  readonly password: string
  readonly deviceName: string
  readonly platform: string
  readonly installationId: string
}

export class GatewayAuthApi {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly allowedProtocols: readonly GatewayProtocol[]

  constructor(options: GatewayAuthApiOptions) {
    this.allowedProtocols = options.allowedProtocols ?? allowedGatewayProtocols
    const baseUrl = normalizeGatewayOrigin(options.baseUrl, this.allowedProtocols)
    if (baseUrl === undefined) throw new Error('Gateway auth API must use an allowed HTTP(S) origin')
    this.baseUrl = baseUrl
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async login(input: GatewayLoginInput): Promise<MobileAuthSession> {
    const body = await this.request('/v1/auth/login', {
      body: JSON.stringify(input),
      method: 'POST',
    })
    return this.parseSession(body)
  }

  async refresh(refreshToken: string): Promise<MobileAuthSession> {
    const body = await this.request('/v1/auth/refresh', {
      body: JSON.stringify({ refreshToken }),
      method: 'POST',
    })
    return this.parseSession(body)
  }

  private parseSession(body: unknown): MobileAuthSession {
    const session = parseMobileAuthSession({
      ...(isRecord(body) ? body : {}),
      gatewayOrigin: this.baseUrl,
      schemaVersion: MOBILE_SESSION_SCHEMA_VERSION,
    }, this.allowedProtocols)
    if (session === undefined) {
      throw new GatewayApiError('Gateway returned an invalid auth session', 502, 'invalid_auth_response')
    }
    return session
  }

  async profile(accessToken: string): Promise<GatewayAccountProfile> {
    const body = await this.request('/v1/me', {}, accessToken)
    const account = parseAccount(isRecord(body) ? body.account : undefined)
    const device = parseDevice(isRecord(body) ? body.device : undefined)
    if (account === undefined || device === undefined) {
      throw new GatewayApiError('Gateway returned an invalid account profile', 502, 'invalid_profile_response')
    }
    return { account, device }
  }

  async logout(refreshToken: string): Promise<void> {
    await this.request('/v1/auth/logout', {
      body: JSON.stringify({ refreshToken }),
      method: 'POST',
    }, undefined, true)
  }

  private async request(
    path: string,
    init: { readonly method?: 'POST'; readonly body?: string } = {},
    accessToken?: string,
    allowEmpty = false,
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    })
    const text = await response.text()
    let body: unknown
    try {
      body = text.length === 0 ? undefined : JSON.parse(text)
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
      const code = typeof error?.code === 'string' ? error.code : undefined
      const message = typeof error?.message === 'string'
        ? error.message
        : `Gateway auth request failed (${response.status})`
      throw new GatewayApiError(message, response.status, code)
    }
    if (body === undefined && !allowEmpty) {
      throw new GatewayApiError('Gateway returned an empty response', response.status)
    }
    return body
  }
}

function parseAccount(value: unknown): MobileSessionAccount | undefined {
  if (!isRecord(value)) return undefined
  const { accountId, displayName, status, username } = value
  return typeof accountId === 'string' && accountId.length > 0
    && typeof displayName === 'string' && displayName.length > 0
    && typeof status === 'string' && status.length > 0
    && typeof username === 'string' && username.length > 0
    ? { accountId, displayName, status, username }
    : undefined
}

function parseDevice(value: unknown): MobileSessionDevice | undefined {
  if (!isRecord(value)) return undefined
  const { deviceId, name, platform } = value
  return typeof deviceId === 'string' && deviceId.length > 0
    && typeof name === 'string' && name.length > 0
    && typeof platform === 'string' && platform.length > 0
    ? { deviceId, name, platform }
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
