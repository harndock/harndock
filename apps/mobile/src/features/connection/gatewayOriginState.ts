import { normalizeGatewayOrigin, type GatewayProtocol } from '../../sync/gateway-url'

export interface RestoredGatewayConfig {
  readonly gatewayOrigin: string
  readonly persistedGatewayOrigin: string | undefined
  readonly credentialGatewayOrigin: string | undefined
  readonly accessToken: string | null
  readonly storedOriginRejected: boolean
}

export function resolveStoredGatewayConfig(
  storedOrigin: string | null,
  accessToken: string | null,
  fallbackOrigin: string,
  allowedProtocols: readonly GatewayProtocol[],
): RestoredGatewayConfig {
  const restoredOrigin = storedOrigin === null
    ? undefined
    : normalizeGatewayOrigin(storedOrigin, allowedProtocols)
  const storedOriginRejected = storedOrigin !== null && restoredOrigin === undefined
  return {
    accessToken: storedOriginRejected ? null : accessToken,
    credentialGatewayOrigin: storedOriginRejected || accessToken === null
      ? undefined
      : (restoredOrigin ?? fallbackOrigin),
    gatewayOrigin: restoredOrigin ?? fallbackOrigin,
    persistedGatewayOrigin: restoredOrigin,
    storedOriginRejected,
  }
}

export function shouldClearTokenForOriginChange(
  value: string,
  credentialOrigin: string | undefined,
  hasAccessToken: boolean,
  allowedProtocols: readonly GatewayProtocol[],
): boolean {
  if (credentialOrigin === undefined || !hasAccessToken) return false
  return normalizeGatewayOrigin(value, allowedProtocols) !== credentialOrigin
}
