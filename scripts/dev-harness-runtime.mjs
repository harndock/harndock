import { spawn } from 'node:child_process'
import { prepareDesktopProfile } from './prepare-desktop-profile.mjs'

const required = (name) => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

const parentPid = Number(required('HARNDOCK_PARENT_PID'))
if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
  throw new Error(`HARNDOCK_PARENT_PID must be a positive integer, got ${String(parentPid)}`)
}

prepareDesktopProfile()

const child = spawn(
  process.execPath,
  [
    '--import',
    required('HARNDOCK_TSX_LOADER_URL'),
    required('HARNDOCK_HARNESS_ENTRY'),
    '--profile',
    'desktop',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--no-open',
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  },
)

let stopping = false
let escalation

const parentIsAlive = () => {
  try {
    process.kill(parentPid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const stop = () => {
  if (stopping) return
  stopping = true
  clearInterval(parentWatch)
  child.kill('SIGTERM')
  escalation = setTimeout(() => child.kill('SIGKILL'), 5_000)
  escalation.unref()
}

const parentWatch = setInterval(() => {
  if (!parentIsAlive()) stop()
}, 500)
parentWatch.unref()

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

child.once('error', (error) => {
  clearInterval(parentWatch)
  clearTimeout(escalation)
  console.error(`harndock runtime adapter: ${error.message}`)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  clearInterval(parentWatch)
  clearTimeout(escalation)
  if (signal !== null) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
