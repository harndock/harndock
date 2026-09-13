/** Framework-neutral locale resolution, translation and Intl helpers. */

export interface LocaleDefinition {
  /** Stable locale identifier used by application preferences and dictionaries. */
  readonly id: string
  /** BCP 47 tag used by the Intl APIs. */
  readonly intl: string
  /** Display name in the locale's own language. */
  readonly label: string
}

export interface LocalePreferenceStore {
  read: () => string | null
  write: (locale: string) => void
}

export interface LocalePreferenceOptions {
  readonly locales: readonly LocaleDefinition[]
  readonly fallbackLocale: string
  readonly initialLocale?: string
  readonly candidates?: readonly string[]
  readonly store?: LocalePreferenceStore
}

export interface LocalePreference {
  getLocale: () => string
  getDefinition: () => LocaleDefinition
  setLocale: (locale: string) => void
  subscribe: (listener: () => void) => () => void
  /** Adopt a persisted value after an asynchronous store read. */
  hydrate: (persistedLocale: string | null | undefined) => void
}

export type MessageParams = Readonly<Record<string, unknown>>
export type LocaleDictionary = Readonly<Record<string, string>>
export type LocaleDictionaries = Readonly<Record<string, LocaleDictionary>>

/** Validate that two locale dictionaries expose exactly the same message keys. */
export function assertDictionaryParity(
  source: LocaleDictionary,
  translation: LocaleDictionary,
  sourceLocale = 'source',
  translationLocale = 'translation',
): void {
  const sourceKeys = new Set(Object.keys(source))
  const translationKeys = new Set(Object.keys(translation))
  const missing = [...sourceKeys].filter(key => !translationKeys.has(key)).sort()
  const extra = [...translationKeys].filter(key => !sourceKeys.has(key)).sort()
  if (missing.length === 0 && extra.length === 0) return
  const details = [
    missing.length > 0 ? `missing in ${translationLocale}: ${missing.join(', ')}` : '',
    extra.length > 0 ? `extra in ${translationLocale}: ${extra.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  throw new Error(`dictionary parity failed (${sourceLocale} -> ${translationLocale}): ${details}`)
}

export interface TranslatorOptions {
  readonly locale: string | (() => string)
  readonly dictionaries: LocaleDictionaries
  readonly fallbackLocale: string
  readonly onMissingKey?: (key: string, locale: string) => void
}

export interface Translator {
  (key: string, params?: MessageParams): string
  locale: () => string
}

export const DEFAULT_LOCALES: readonly LocaleDefinition[] = Object.freeze([
  { id: 'zh', intl: 'zh-CN', label: '中文' },
  { id: 'en', intl: 'en-US', label: 'English' },
])

/** Match a browser or OS language tag to one of the supported locale IDs. */
export function detectLocale(
  candidates: readonly string[],
  locales: readonly LocaleDefinition[] = DEFAULT_LOCALES,
): string | undefined {
  for (const candidate of candidates) {
    const primary = candidate.trim().toLowerCase().split('-')[0]
    if (primary === undefined || primary === '') continue
    const match = locales.find(locale => locale.id.toLowerCase() === primary)
    if (match !== undefined) return match.id
  }
  return undefined
}

/** Resolve explicit preference, then browser/OS candidates, then fallback. */
export function resolveLocale(options: {
  readonly explicit?: string | null
  readonly candidates?: readonly string[]
  readonly locales?: readonly LocaleDefinition[]
  readonly fallbackLocale?: string
}): string {
  const locales = options.locales ?? DEFAULT_LOCALES
  const fallback = options.fallbackLocale ?? locales[0]?.id ?? 'en'
  const explicit = options.explicit === undefined || options.explicit === null
    ? undefined
    : locales.find(locale => locale.id === options.explicit)?.id
  return explicit
    ?? detectLocale(options.candidates ?? [], locales)
    ?? locales.find(locale => locale.id === fallback)?.id
    ?? locales[0]?.id
    ?? fallback
}

/** Create a locale state object that can be used by React, React Native or vanilla UI. */
export function createLocalePreference(options: LocalePreferenceOptions): LocalePreference {
  const locales = options.locales.length > 0 ? options.locales : DEFAULT_LOCALES
  const fallback = resolveLocale({ locales, explicit: options.fallbackLocale })
  let persistedLocale: string | null | undefined
  try {
    persistedLocale = options.store?.read()
  } catch {
    // Storage can be unavailable in private browsing or restricted runtimes.
  }
  const initial = resolveLocale({
    locales,
    explicit: persistedLocale ?? options.initialLocale,
    candidates: options.candidates,
    fallbackLocale: fallback,
  })
  let active = initial
  const listeners = new Set<() => void>()
  const definition = (): LocaleDefinition => {
    const current = locales.find(locale => locale.id === active)
    return current ?? locales[0] ?? { id: active, intl: active, label: active }
  }
  const publish = (next: string): void => {
    if (active === next) return
    active = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getLocale: () => active,
    getDefinition: definition,
    setLocale: (locale: string) => {
      const next = locales.find(item => item.id === locale)?.id
      if (next === undefined) throw new Error(`locale "${locale}" is not registered`)
      publish(next)
      options.store?.write(next)
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    hydrate: (persistedLocale: string | null | undefined) => {
      const next = resolveLocale({
        locales,
        explicit: persistedLocale,
        fallbackLocale: fallback,
      })
      publish(next)
    },
  }
}

/** Create a translator whose locale can be a live getter from a preference provider. */
export function createTranslator(options: TranslatorOptions): Translator {
  const source = options.locale
  const readLocale: () => string = typeof source === 'function' ? source : () => source
  const translate = ((key: string, params?: MessageParams): string => {
    const active = readLocale()
    const template = options.dictionaries[active]?.[key]
      ?? options.dictionaries[options.fallbackLocale]?.[key]
    if (template === undefined) {
      options.onMissingKey?.(key, active)
      return key
    }
    return interpolate(template, params)
  }) as Translator
  translate.locale = readLocale
  return translate
}

/** Format a message template using named `{placeholder}` values. */
export function interpolate(template: string, params?: MessageParams): string {
  if (params === undefined) return template
  return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** Return the Intl tag for a stable application locale ID. */
export function intlLocale(
  locale: string,
  locales: readonly LocaleDefinition[] = DEFAULT_LOCALES,
): string {
  return locales.find(item => item.id === locale)?.intl ?? locale
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
  locales: readonly LocaleDefinition[] = DEFAULT_LOCALES,
): string {
  return new Intl.NumberFormat(intlLocale(locale, locales), options).format(value)
}

export function formatDate(
  value: Date | number | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
  locales: readonly LocaleDefinition[] = DEFAULT_LOCALES,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale, locales), options).format(toDate(value))
}

export function formatTime(
  value: Date | number | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
  locales: readonly LocaleDefinition[] = DEFAULT_LOCALES,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale, locales), {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  }).format(toDate(value))
}

export function pluralCategory(
  value: number,
  locale: string,
  locales: readonly LocaleDefinition[] = DEFAULT_LOCALES,
): Intl.LDMLPluralRule {
  return new Intl.PluralRules(intlLocale(locale, locales)).select(value)
}

function toDate(value: Date | number | string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError('invalid date value')
  return date
}
