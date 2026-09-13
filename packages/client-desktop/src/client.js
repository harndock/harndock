import { createElement } from 'react'

export const name = 'harndock-client-desktop'
export const inject = ['slots']

const ATTRIBUTE = 'data-harndock-client'
const READY_EVENT = 'harndock:client-ready'
const SETTINGS_PATH = '/harndock/desktop/settings'
const STYLE_ID = 'harndock-desktop-styles'
const BASE_NAME = process.env.HARNDOCK_BASE_NAME ?? 'DeepSeek Harness'

const styles = `
.harndock-brand-name {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-family: inherit;
  line-height: 24px;
  overflow: hidden;
  white-space: nowrap;
}
.harndock-brand-product {
  flex: none;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0;
}
.harndock-brand-base {
  flex: none;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 12px;
  white-space: nowrap;
}
.harndock-brand-mark {
  color: #5267c8;
  --harndock-connector: #e5e9ff;
}
:root[data-theme="dark"] .harndock-brand-mark {
  color: #9aa7ff;
  --harndock-connector: #fffdf5;
}
.harndock-remote-sync-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 8px);
  height: 34px;
  margin: 4px -4px 0;
  padding: 6px 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: 12px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  cursor: pointer;
  overflow: hidden;
}
.harndock-remote-sync-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.harndock-remote-sync-action:disabled {
  cursor: wait;
  opacity: .62;
}
.harndock-remote-sync-action[data-rail] {
  justify-content: center;
  gap: 0;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border-radius: 50%;
}
.harndock-remote-sync-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
}
.harndock-remote-sync-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

function BrandMark({ size = 32, className }) {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 1254 1254', className: className ?? 'harndock-brand-mark', 'aria-hidden': true,
  },
  createElement('rect', { fill: 'currentColor', x: 76, y: 106, width: 317, height: 1052, rx: 64 }),
  createElement('path', { fill: 'currentColor', d: 'M1014 93h115c36 0 65 29 65 65v935c0 36-29 65-65 65H941c-36 0-65-29-65-65V807H766V640h61c27 0 49-22 49-49V444c0-19-15-34-34-34h-99c-24 0-43-19-43-43 0-12 5-23 14-32L978 104c10-7 22-11 36-11Z' }),
  createElement('path', { fill: 'var(--harndock-connector)', d: 'M393 640h132v-92c0-26 21-47 47-47h127c26 0 47 21 47 47v92h130v167H746v92c0 26-21 47-47 47H572c-26 0-47-21-47-47v-92H393V640Z' }))
}


function BrandName() {
  return createElement(
    'span',
    { className: 'harndock-brand-name' },
    createElement('span', { className: 'harndock-brand-product' }, 'Harndock'),
    createElement('span', { className: 'harndock-brand-base' }, BASE_NAME),
  )
}

async function openSettings(event) {
  const button = event.currentTarget
  const label = button.querySelector('.harndock-remote-sync-label')
  button.disabled = true
  if (label !== null) label.textContent = 'Opening settings…'
  try {
    const response = await fetch(SETTINGS_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Harndock-Desktop-Action': 'show-settings' },
    })
    if (!response.ok) throw new Error(`Desktop bridge returned HTTP ${String(response.status)}`)
  } catch (error) {
    button.disabled = false
    button.title = error instanceof Error ? error.message : String(error)
    if (label !== null) label.textContent = 'Gateway settings unavailable'
    window.setTimeout(() => {
      if (label !== null) label.textContent = 'Gateway & Remote Sync'
    }, 3_000)
  }
}

function GatewaySettingsAction({ wide }) {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'harndock-remote-sync-action',
      'data-rail': wide ? undefined : '',
      'aria-label': 'Open Gateway and Remote Sync settings',
      title: wide ? undefined : 'Gateway & Remote Sync',
      onClick: openSettings,
    },
    createElement('span', { className: 'harndock-remote-sync-glyph', 'aria-hidden': true }, 'G'),
    wide
      ? createElement('span', { className: 'harndock-remote-sync-label' }, 'Gateway & Remote Sync')
      : null,
  )
}

export function apply(ctx) {
  const root = document.documentElement
  const previous = root.getAttribute(ATTRIBUTE)
  root.setAttribute(ATTRIBUTE, 'active')

  const existingStyle = document.getElementById(STYLE_ID)
  const style = existingStyle ?? document.createElement('style')
  if (existingStyle === null) {
    style.id = STYLE_ID
    style.textContent = styles
    document.head.append(style)
  }

  for (const [slot, component] of [
    ['sidebar.brand.mark', BrandMark],
    ['sidebar.brand.name', BrandName],
    ['conversation.hero.brand.mark', BrandMark],
  ]) {
    ctx.slots.inject(slot, () => ctx.slots.register({ name: slot }, component))
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'harndock-remote-sync',
    order: 100,
    label: 'Gateway & Remote Sync',
  }, GatewaySettingsAction))

  window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { version: '0.1.0' } }))

  ctx.effect(() => () => {
    if (existingStyle === null) style.remove()
    if (previous === null) root.removeAttribute(ATTRIBUTE)
    else root.setAttribute(ATTRIBUTE, previous)
  }, 'harndock: desktop client marker')
}
