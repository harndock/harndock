import { GatewayApiError } from '../../sync/gateway-api'
import type { GatewayAuthApi } from '../../sync/gateway-auth-api'
import { normalizeGatewayOrigin } from '../../sync/gateway-url'
import type { MobileAuthSession } from '../../sync/mobile-session'

export interface AdministratorLoginInput {
  readonly gatewayOrigin: string
  readonly username: string
  readonly password: string
  readonly deviceName: string
  readonly platform: string
}

export interface AdministratorLoginServices {
  readonly authApi: (gatewayOrigin: string) => Pick<GatewayAuthApi, 'login' | 'logout'>
  readonly loadInstallationId: () => Promise<string>
  readonly saveGatewayOrigin: (gatewayOrigin: string) => Promise<void>
  readonly saveSession: (session: MobileAuthSession) => Promise<void>
}

export type AdministratorLoginResult =
  | { readonly ok: true; readonly session: MobileAuthSession }
  | { readonly ok: false; readonly code: AdministratorLoginErrorCode; readonly message: string }

export type AdministratorLoginErrorCode =
  | 'invalid_origin'
  | 'invalid_username'
  | 'invalid_password'
  | 'authentication_denied'
  | 'rate_limited'
  | 'gateway_unavailable'
  | 'invalid_response'
  | 'storage_unavailable'
  | 'unknown'

export async function loginAdministrator(
  input: AdministratorLoginInput,
  services: AdministratorLoginServices,
): Promise<AdministratorLoginResult> {
  const gatewayOrigin = normalizeGatewayOrigin(input.gatewayOrigin)
  if (gatewayOrigin === undefined) {
    return failure('invalid_origin', 'Gateway 必须是当前构建允许的安全 origin。')
  }
  const username = input.username.trim()
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    return failure('invalid_username', '管理员账号需为 3–64 位字母、数字、点、下划线或连字符。')
  }
  if (input.password.length < 8 || input.password.length > 128) {
    return failure('invalid_password', '密码长度需为 8–128 个字符。')
  }

  let installationId: string
  try {
    const [loadedInstallationId] = await Promise.all([
      services.loadInstallationId(),
      services.saveGatewayOrigin(gatewayOrigin),
    ])
    installationId = loadedInstallationId
  } catch {
    return failure('storage_unavailable', '无法访问系统安全存储，登录尚未发送。')
  }

  const api = services.authApi(gatewayOrigin)
  let session: MobileAuthSession
  try {
    session = await api.login({
      deviceName: input.deviceName,
      installationId,
      password: input.password,
      platform: input.platform,
      username,
    })
  } catch (error) {
    return loginFailure(error)
  }

  try {
    await services.saveSession(session)
  } catch {
    await api.logout(session.refreshToken).catch(() => undefined)
    return failure('storage_unavailable', '登录成功，但无法安全保存会话；本次会话已退出。')
  }
  return { ok: true, session }
}

function loginFailure(error: unknown): AdministratorLoginResult {
  if (!(error instanceof GatewayApiError)) {
    return failure('gateway_unavailable', '无法连接 Gateway，请检查地址和网络后重试。')
  }
  if (error.status === 401 || error.code === 'authentication_denied') {
    return failure('authentication_denied', '管理员账号或密码不正确。')
  }
  if (error.status === 429 || error.code === 'rate_limited') {
    return failure('rate_limited', '登录尝试次数过多，请稍后再试。')
  }
  if (error.code === 'invalid_auth_response') {
    return failure('invalid_response', 'Gateway 返回的登录会话无效，请联系部署管理员。')
  }
  if (error.status >= 500) {
    return failure('gateway_unavailable', 'Gateway 登录服务暂不可用，请稍后重试。')
  }
  return failure('unknown', '登录失败，请检查输入后重试。')
}

function failure(code: AdministratorLoginErrorCode, message: string): AdministratorLoginResult {
  return { code, message, ok: false }
}
