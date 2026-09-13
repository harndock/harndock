import type { MessageParams } from '@harndock/i18n-core'

/** A locale-neutral UI message descriptor safe to use in feature models. */
export interface MobileMessage {
  readonly key: string
  readonly params?: MessageParams
}

export function message(key: string, params?: MessageParams): MobileMessage {
  return params === undefined ? { key } : { key, params }
}
