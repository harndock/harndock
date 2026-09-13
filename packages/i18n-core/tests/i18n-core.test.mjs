import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_LOCALES,
  assertDictionaryParity,
  createLocalePreference,
  createTranslator,
  detectLocale,
  formatDate,
  formatNumber,
  intlLocale,
  pluralCategory,
  resolveLocale,
} from '../dist/src/index.js'

test('resolves explicit locale, browser locale and fallback in order', () => {
  assert.equal(detectLocale(['fr-FR', 'en-GB']), 'en')
  assert.equal(resolveLocale({ explicit: 'zh', candidates: ['en-US'] }), 'zh')
  assert.equal(resolveLocale({ candidates: ['fr-FR'] }), 'zh')
  assert.equal(intlLocale('en'), 'en-US')
})

test('locale preference validates, persists and notifies subscribers', () => {
  const writes = []
  const preference = createLocalePreference({
    locales: DEFAULT_LOCALES,
    fallbackLocale: 'zh',
    initialLocale: 'en',
    store: { read: () => 'zh', write: locale => writes.push(locale) },
  })
  let changes = 0
  const dispose = preference.subscribe(() => { changes += 1 })
  assert.equal(preference.getLocale(), 'zh')
  preference.setLocale('en')
  assert.equal(preference.getLocale(), 'en')
  assert.deepEqual(writes, ['en'])
  assert.equal(changes, 1)
  preference.hydrate('zh')
  assert.equal(preference.getLocale(), 'zh')
  assert.equal(changes, 2)
  dispose()
  assert.throws(() => preference.setLocale('fr'), /not registered/)
})

test('translator uses live locale, fallback and interpolation', () => {
  let locale = 'en'
  const missing = []
  const t = createTranslator({
    locale: () => locale,
    fallbackLocale: 'zh',
    dictionaries: {
      en: { hello: 'Hello, {name}', onlyZh: 'English placeholder' },
      zh: { hello: '你好，{name}', onlyZh: '仅中文' },
    },
    onMissingKey: key => missing.push(key),
  })
  assert.equal(t('hello', { name: 'Ada' }), 'Hello, Ada')
  locale = 'zh'
  assert.equal(t('hello', { name: 'Ada' }), '你好，Ada')
  locale = 'fr'
  assert.equal(t('onlyZh'), '仅中文')
  assert.equal(t('missing'), 'missing')
  assert.deepEqual(missing, ['missing'])
})

test('dictionary parity rejects missing and extra keys', () => {
  assert.doesNotThrow(() => assertDictionaryParity({ a: 'A' }, { a: 'A' }, 'zh', 'en'))
  assert.throws(
    () => assertDictionaryParity({ a: 'A', b: 'B' }, { a: 'A', c: 'C' }, 'zh', 'en'),
    /missing in en: b; extra in en: c/,
  )
})

test('Intl helpers format values using the active locale', () => {
  assert.equal(formatNumber(1234567, 'en'), '1,234,567')
  assert.equal(formatNumber(1234567, 'zh'), '1,234,567')
  assert.equal(pluralCategory(1, 'en'), 'one')
  assert.equal(pluralCategory(2, 'en'), 'other')
  assert.match(formatDate('2026-08-28T10:30:00Z', 'en', { timeZone: 'UTC', dateStyle: 'medium' }), /2026/)
})
