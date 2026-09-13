import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundleDir = join(root, 'packages', 'desktop-bundle')
const clientDir = join(root, 'packages', 'client-desktop')
const bridgeDir = join(root, 'packages', 'runtime-bridge')
const remoteSyncDir = join(root, 'packages', 'remote-sync')
const bundle = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
const client = JSON.parse(readFileSync(join(clientDir, 'package.json'), 'utf8'))
const bridge = JSON.parse(readFileSync(join(bridgeDir, 'package.json'), 'utf8'))
const remoteSync = JSON.parse(readFileSync(join(remoteSyncDir, 'package.json'), 'utf8'))

assert.equal(bundle.name, '@harndock/desktop-bundle')
assert.equal(bundle.dsh?.bundle?.patch, './cordis.patch.yml')
assert.match(readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8'), /name: '@harndock\/client-desktop'/)
assert.match(readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8'), /name: '@harndock\/runtime-bridge'/)
assert.match(readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8'), /name: '@harndock\/remote-sync'/)
assert.match(readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8'), /id: mcp-playwright/)
assert.match(readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8'), /name: '@deepseek-ai\/dsh-mcp-client'/)
assert.equal(client.name, '@harndock/client-desktop')
assert.equal(client.dsh?.client?.platform, 'web')
assert.deepEqual(client.dsh?.client?.inject, ['slots'])
assert.equal(bridge.name, '@harndock/runtime-bridge')
assert.equal(remoteSync.name, '@harndock/remote-sync')

if (!process.argv.includes('--source-only')) {
  const bundlePath = join(clientDir, 'lib', 'client.js')
  assert.equal(existsSync(bundlePath), true, 'desktop Client plugin must be built')
  let registration
  const attributes = new Map()
  let disposed
  let readyEvent
  let styleElement
  let slotKey
  let slotOptions
  let slotComponent
  const brandSlots = new Map()
  const context = {
    window: {
      __ModuleLoader__: { load(value) { registration = value } },
      dispatchEvent(event) { readyEvent = event },
    },
    document: {
      getElementById() { return null },
      createElement(tag) {
        assert.equal(tag, 'style')
        styleElement = {
          remove() { this.removed = true },
        }
        return styleElement
      },
      head: {
        append(element) { element.appended = true },
      },
      documentElement: {
        getAttribute(name) { return attributes.get(name) ?? null },
        setAttribute(name, value) { attributes.set(name, value) },
        removeAttribute(name) { attributes.delete(name) },
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type
        this.detail = init?.detail
      }
    },
  }
  vm.runInNewContext(readFileSync(bundlePath, 'utf8'), context, { filename: bundlePath })
  assert.equal(registration?.id, '@harndock/client-desktop')
  const plugin = registration.factory((specifier) => {
    assert.equal(specifier, 'react')
    return {
      createElement(type, props, ...children) {
        return { type, props: { ...props, children } }
      },
    }
  })
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  plugin.apply({
    effect(effect) { disposed = effect() },
    slots: {
      inject(key, register) {
        slotKey = key
        register()
      },
      register(options, component) {
        if (options.name.includes('.brand.')) brandSlots.set(options.name, component)
        slotOptions = options
        slotComponent = component
        return () => {}
      },
    },
  })
  assert.equal(attributes.get('data-harndock-client'), 'active')
  assert.equal(readyEvent?.type, 'harndock:client-ready')
  assert.equal(styleElement?.id, 'harndock-desktop-styles')
  assert.equal(styleElement?.appended, true)
  assert.equal(slotKey, 'sidebar.footer.action')
  assert.equal(slotOptions?.id, 'harndock-remote-sync')
  assert.equal(slotOptions?.label, 'Gateway & Remote Sync')
  const brandName = brandSlots.get('sidebar.brand.name')()
  assert.equal(brandName.props.className, 'harndock-brand-name')
  assert.equal(brandName.props.children[0].props.children[0], 'Harndock')
  assert.equal(brandName.props.children[1].props.children[0], 'DeepSeek Harness')
  for (const slot of ['sidebar.brand.mark', 'conversation.hero.brand.mark']) {
    const mark = brandSlots.get(slot)({ size: 40, className: 'brand' })
    assert.equal(mark.type, 'svg')
    assert.equal(mark.props.width, 40)
    assert.equal(mark.props.className, 'brand')
  }
  const wideAction = slotComponent({ wide: true })
  assert.equal(wideAction.type, 'button')
  assert.equal(wideAction.props.className, 'harndock-remote-sync-action')
  assert.equal(wideAction.props.children[1].props.children[0], 'Gateway & Remote Sync')
  const railAction = slotComponent({ wide: false })
  assert.equal(railAction.props['data-rail'], '')
  assert.equal(railAction.props.children[1], null)
  disposed()
  assert.equal(attributes.has('data-harndock-client'), false)
  assert.equal(styleElement?.removed, true)
  assert.equal(existsSync(join(bridgeDir, 'lib', 'index.js')), true, 'Runtime bridge must be built')
  assert.equal(existsSync(join(remoteSyncDir, 'lib', 'index.js')), true, 'Remote sync connector must be built')
}

console.log('Desktop bundle and Client plugin verified')
