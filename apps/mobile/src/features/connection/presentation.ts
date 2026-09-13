import { GatewayApiError } from '../../services/transport'

export function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof GatewayApiError
    && (error.status === 401
      || error.code === 'authentication_denied'
      || error.code === 'authentication_required'
      || error.code === 'device_revoked')
}

export function formatHeartbeat(value: string | undefined): string {
  if (value === undefined) return '尚未收到'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleTimeString()
}

export function formatInventoryError(scope: string, error: unknown): string {
  if (error instanceof GatewayApiError) return `${scope}读取失败：${error.code ?? error.message}`
  return `${scope}读取失败，请检查网络和凭据`
}
