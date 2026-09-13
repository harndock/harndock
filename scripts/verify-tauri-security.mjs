import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = join(root, 'apps', 'desktop', 'src-tauri')
const capability = JSON.parse(readFileSync(join(tauriDir, 'capabilities', 'default.json'), 'utf8'))
const config = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))

const expectedPermissions = ['core:default', 'core:event:default', 'deep-link:default']
if (JSON.stringify(capability.permissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error('The main window capability must expose only core events and read-only deep-link access')
}
if ('remote' in capability) {
  throw new Error('The main window capability must not grant IPC access to remote origins')
}
if (config.app?.security?.dangerousRemoteDomainIpcAccess !== undefined) {
  throw new Error('dangerousRemoteDomainIpcAccess must remain disabled')
}
if (JSON.stringify(config.plugins?.['deep-link']?.desktop?.schemes) !== JSON.stringify(['harndock'])) {
  throw new Error('The desktop deep-link boundary must contain only the harndock scheme')
}

console.log('Tauri security boundary verified: local IPC and read-only harndock deep links only')
