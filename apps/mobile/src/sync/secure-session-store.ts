import { allowedGatewayProtocols, type GatewayProtocol } from './gateway-url'
import {
  parseMobileAuthSession,
  parseStoredMobileSession,
  serializeMobileSessionMetadata,
  type MobileAuthSession,
} from './mobile-session'

export interface SecureSessionDriver {
  readonly get: (key: string) => Promise<string | null>
  readonly set: (key: string, value: string) => Promise<void>
  readonly delete: (key: string) => Promise<void>
}

export interface SecureMobileSessionStore {
  readonly load: () => Promise<MobileAuthSession | null>
  readonly save: (session: MobileAuthSession) => Promise<void>
  readonly clear: () => Promise<void>
}

type SessionSlot = 'a' | 'b'

const ACTIVE_SLOT_KEY = 'gateway.session.v1.active'
const SLOT_KEYS = {
  a: {
    access: 'gateway.session.v1.a.access',
    refresh: 'gateway.session.v1.a.refresh',
    metadata: 'gateway.session.v1.a.metadata',
  },
  b: {
    access: 'gateway.session.v1.b.access',
    refresh: 'gateway.session.v1.b.refresh',
    metadata: 'gateway.session.v1.b.metadata',
  },
} as const

export function createSecureMobileSessionStore(
  driver: SecureSessionDriver,
  protocols: readonly GatewayProtocol[] = allowedGatewayProtocols,
): SecureMobileSessionStore {
  const clearSlot = async (slot: SessionSlot): Promise<void> => {
    const keys = SLOT_KEYS[slot]
    const results = await Promise.allSettled([
      driver.delete(keys.access),
      driver.delete(keys.refresh),
      driver.delete(keys.metadata),
    ])
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  const clearSlotsBestEffort = async (slots: readonly SessionSlot[]): Promise<void> => {
    await Promise.allSettled(slots.map(clearSlot))
  }

  const load = async (): Promise<MobileAuthSession | null> => {
    const activeSlot = parseSlot(await driver.get(ACTIVE_SLOT_KEY))
    if (activeSlot === undefined) {
      await Promise.allSettled([driver.delete(ACTIVE_SLOT_KEY), clearSlotsBestEffort(['a', 'b'])])
      return null
    }
    const keys = SLOT_KEYS[activeSlot]
    const [accessToken, refreshToken, metadata] = await Promise.all([
      driver.get(keys.access),
      driver.get(keys.refresh),
      driver.get(keys.metadata),
    ])
    if (accessToken === null || refreshToken === null || metadata === null) {
      await clear()
      return null
    }
    const session = parseStoredMobileSession(accessToken, refreshToken, metadata, protocols)
    if (session === undefined) {
      await clear()
      return null
    }
    const inactiveSlot: SessionSlot = activeSlot === 'a' ? 'b' : 'a'
    await clearSlotsBestEffort([inactiveSlot])
    return session
  }

  const save = async (input: MobileAuthSession): Promise<void> => {
    const session = parseMobileAuthSession(input, protocols)
    if (session === undefined) throw new Error('Mobile auth session is invalid')
    const currentSlot = parseSlot(await driver.get(ACTIVE_SLOT_KEY))
    const nextSlot: SessionSlot = currentSlot === 'a' ? 'b' : 'a'
    const keys = SLOT_KEYS[nextSlot]
    await Promise.all([
      driver.set(keys.access, session.accessToken),
      driver.set(keys.refresh, session.refreshToken),
      driver.set(keys.metadata, serializeMobileSessionMetadata(session)),
    ])
    await driver.set(ACTIVE_SLOT_KEY, nextSlot)
    const inactiveSlot: SessionSlot = nextSlot === 'a' ? 'b' : 'a'
    await clearSlotsBestEffort([inactiveSlot])
  }

  const clear = async (): Promise<void> => {
    const failures: unknown[] = []
    try {
      await driver.delete(ACTIVE_SLOT_KEY)
    } catch (error) {
      failures.push(error)
    }
    const results = await Promise.allSettled([clearSlot('a'), clearSlot('b')])
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new Error('Unable to clear the complete Mobile auth session', { cause: failures[0] })
  }

  return { clear, load, save }
}

function parseSlot(value: string | null): SessionSlot | undefined {
  return value === 'a' || value === 'b' ? value : undefined
}
