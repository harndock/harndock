import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'
import { randomUUID } from 'expo-crypto'
import { toStoredCommandState, type StoredCommandState } from './command-state'
import type { SessionProjection } from './projection'
import { parseSessionProjection, parseStoredCommandState } from './storage-codec'
import { createSecureMobileSessionStore } from './secure-session-store'
import { parseMobileAuthSession, type MobileAuthSession } from './mobile-session'
import { mobileInstallationId, parseMobileInstallationId } from './mobile-installation'

export type { StoredCommandState } from './command-state'

const LEGACY_ACCESS_TOKEN_KEY = 'gateway.access-token'
const GATEWAY_ORIGIN_KEY = 'gateway.origin.v1'
const MOBILE_INSTALLATION_ID_KEY = 'gateway.mobile-installation.v1'
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}
const mobileSessionStore = createSecureMobileSessionStore({
  get: key => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS),
  delete: key => SecureStore.deleteItemAsync(key),
})

export function openSyncDatabase(): SQLite.SQLiteDatabase {
  const database = SQLite.openDatabaseSync('sync.db')
  database.execSync(`
    create table if not exists session_snapshots (
      session_id text primary key not null,
      runtime_id text not null,
      snapshot_json text not null,
      last_seq integer not null default 0,
      updated_at text not null
    );
    create table if not exists command_states (
      command_id text primary key not null,
      session_id text not null,
      command_json text not null,
      status text not null,
      updated_at text not null
    );
    create index if not exists command_states_session_updated_idx
      on command_states(session_id, updated_at desc);
  `)
  return database
}

export function saveCommandRecord(database: SQLite.SQLiteDatabase, command: StoredCommandState): void {
  const state = toStoredCommandState(command)
  database.runSync(
    `insert into command_states
      (command_id, session_id, command_json, status, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(command_id) do update set
        session_id = excluded.session_id,
        command_json = excluded.command_json,
        status = excluded.status,
        updated_at = excluded.updated_at`,
    command.commandId,
    command.sessionId,
    JSON.stringify(state),
    command.status,
    new Date().toISOString(),
  )
}

export function loadSessionCommands(database: SQLite.SQLiteDatabase, sessionId: string): StoredCommandState[] {
  const rows = database.getAllSync<{ command_json: string }>(
    'select command_json from command_states where session_id = ? order by updated_at desc limit 100',
    sessionId,
  )
  return rows.flatMap(row => {
    const command = parseStoredCommandState(row.command_json)
    return command === undefined ? [] : [command]
  })
}

export function saveSessionProjection(database: SQLite.SQLiteDatabase, projection: SessionProjection): void {
  database.runSync(
    `insert into session_snapshots
      (session_id, runtime_id, snapshot_json, last_seq, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(session_id) do update set
        runtime_id = excluded.runtime_id,
        snapshot_json = excluded.snapshot_json,
        last_seq = excluded.last_seq,
        updated_at = excluded.updated_at`,
    projection.sessionId,
    projection.runtimeId,
    JSON.stringify(projection),
    projection.lastSeq,
    new Date(projection.lastActivityAt).toISOString(),
  )
}

export function loadSessionProjections(database: SQLite.SQLiteDatabase): SessionProjection[] {
  const rows = database.getAllSync<{ snapshot_json: string }>(
    'select snapshot_json from session_snapshots order by updated_at desc',
  )
  return rows.flatMap(row => {
    const projection = parseSessionProjection(row.snapshot_json)
    return projection === undefined ? [] : [projection]
  })
}

export async function saveAccessToken(token: string): Promise<void> {
  await mobileSessionStore.clear()
  await SecureStore.setItemAsync(LEGACY_ACCESS_TOKEN_KEY, token, SECURE_STORE_OPTIONS)
}

export async function loadAccessToken(): Promise<string | null> {
  const session = await mobileSessionStore.load()
  return session?.accessToken ?? SecureStore.getItemAsync(LEGACY_ACCESS_TOKEN_KEY)
}

export function loadLegacyAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(LEGACY_ACCESS_TOKEN_KEY)
}

export async function clearAccessToken(): Promise<void> {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(LEGACY_ACCESS_TOKEN_KEY),
    mobileSessionStore.clear(),
  ])
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}

export async function saveMobileSession(session: MobileAuthSession): Promise<void> {
  const validatedSession = parseMobileAuthSession(session)
  if (validatedSession === undefined) throw new Error('Mobile auth session is invalid')
  await SecureStore.deleteItemAsync(LEGACY_ACCESS_TOKEN_KEY)
  await SecureStore.setItemAsync(GATEWAY_ORIGIN_KEY, validatedSession.gatewayOrigin, SECURE_STORE_OPTIONS)
  await mobileSessionStore.save(validatedSession)
}

export function loadMobileSession(): Promise<MobileAuthSession | null> {
  return mobileSessionStore.load()
}

export async function clearMobileSession(): Promise<void> {
  await clearAccessToken()
}

export async function saveGatewayOrigin(origin: string): Promise<void> {
  await SecureStore.setItemAsync(GATEWAY_ORIGIN_KEY, origin, SECURE_STORE_OPTIONS)
}

export async function loadGatewayOrigin(): Promise<string | null> {
  const session = await mobileSessionStore.load()
  return session?.gatewayOrigin ?? SecureStore.getItemAsync(GATEWAY_ORIGIN_KEY)
}

export async function clearGatewayOrigin(): Promise<void> {
  await SecureStore.deleteItemAsync(GATEWAY_ORIGIN_KEY)
}

export async function loadOrCreateMobileInstallationId(): Promise<string> {
  const existing = parseMobileInstallationId(await SecureStore.getItemAsync(MOBILE_INSTALLATION_ID_KEY))
  if (existing !== undefined) return existing
  const installationId = mobileInstallationId(randomUUID())
  await SecureStore.setItemAsync(MOBILE_INSTALLATION_ID_KEY, installationId, SECURE_STORE_OPTIONS)
  return installationId
}

export function clearMobileInstallationId(): Promise<void> {
  return SecureStore.deleteItemAsync(MOBILE_INSTALLATION_ID_KEY)
}
