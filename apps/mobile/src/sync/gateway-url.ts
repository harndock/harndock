export type GatewayProtocol = 'http:' | 'https:'

const DEFAULT_GATEWAY_URL = 'https://sync.example.test'
const DEFAULT_GATEWAY_PROTOCOLS: readonly GatewayProtocol[] = ['https:']

function toGatewayProtocol(value: string): GatewayProtocol | undefined {
  const normalized = value.trim().toLowerCase().replace(/:$/, '')
  if (normalized === 'http') return 'http:'
  if (normalized === 'https') return 'https:'
  return undefined
}

export function parseGatewayProtocols(value: string | undefined): readonly GatewayProtocol[] {
  if (value === undefined) return DEFAULT_GATEWAY_PROTOCOLS
  const protocols = [...new Set(value.split(',').map(toGatewayProtocol).filter((item): item is GatewayProtocol => item !== undefined))]
  return protocols.length === 0 ? DEFAULT_GATEWAY_PROTOCOLS : protocols
}

export const allowedGatewayProtocols = parseGatewayProtocols(process.env.EXPO_PUBLIC_GATEWAY_PROTOCOLS)

const configuredDefaultGatewayUrl = process.env.EXPO_PUBLIC_GATEWAY_DEFAULT_URL?.trim() || DEFAULT_GATEWAY_URL

export const defaultGatewayUrl = normalizeGatewayOrigin(configuredDefaultGatewayUrl, allowedGatewayProtocols)
  ?? DEFAULT_GATEWAY_URL

export function isAllowedGatewayProtocol(
  protocol: string,
  allowedProtocols: readonly GatewayProtocol[] = allowedGatewayProtocols,
): protocol is GatewayProtocol {
  return allowedProtocols.includes(protocol as GatewayProtocol)
}

export function normalizeGatewayOrigin(
  value: string,
  allowedProtocols: readonly GatewayProtocol[] = allowedGatewayProtocols,
): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  if (!isAllowedGatewayProtocol(url.protocol, allowedProtocols)
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return undefined
  }
  if (url.protocol === 'http:' && !isLocalHttpHostname(url.hostname)) return undefined
  return url.origin
}

export function gatewayWebSocketUrl(
  gatewayOrigin: string,
  allowedProtocols: readonly GatewayProtocol[] = allowedGatewayProtocols,
): string {
  const normalizedOrigin = normalizeGatewayOrigin(gatewayOrigin, allowedProtocols)
  if (normalizedOrigin === undefined) throw new Error('Gateway WebSocket must use an allowed secure origin')
  const url = new URL(normalizedOrigin)
  const websocketProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${websocketProtocol}//${url.host}/v1/stream`
}

function isLocalHttpHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    // Android emulators expose the host machine through this reserved alias.
    || normalized === '10.0.2.2'
    || normalized === '10.0.3.2'
    || isLoopbackIpv4(normalized)
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.')
  return octets.length === 4
    && octets[0] === '127'
    && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}
