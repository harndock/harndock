import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearMobileInstallationId,
  clearMobileSession,
  loadGatewayOrigin,
  loadLegacyAccessToken,
  loadMobileSession,
  saveMobileSession,
} from '../../services/storage'
import { GatewayAuthApi } from '../../sync/gateway-auth-api'
import type { MobileAuthSession } from '../../sync/mobile-session'
import {
  developmentAuthState,
  logoutAuthGate,
  restoreAuthGate,
  revokeAuthGate,
  sessionAuthState,
  type AuthGateServices,
  type AuthGateState,
} from './auth-gate-state'
import { manualTokenEntryEnabled } from './debug-token'

interface AuthGateContextValue {
  readonly state: AuthGateState
  readonly navigationRevision: number
  readonly activateDevelopmentSession: (gatewayOrigin: string) => void
  readonly activateSession: (session: MobileAuthSession) => void
  readonly handleAuthenticationFailure: (error?: unknown) => void
  readonly logout: () => Promise<void>
  readonly retry: () => void
}

const authGateServices: AuthGateServices = {
  allowLegacyDevelopmentSession: manualTokenEntryEnabled,
  authApi: gatewayOrigin => new GatewayAuthApi({ baseUrl: gatewayOrigin }),
  clearInstallationId: clearMobileInstallationId,
  clearSession: clearMobileSession,
  loadGatewayOrigin,
  loadLegacyAccessToken,
  loadSession: loadMobileSession,
  saveSession: saveMobileSession,
}

const AuthGateContext = createContext<AuthGateContextValue | undefined>(undefined)

export function AuthGateProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthGateState>({ phase: 'restoring', status: 'loading' })
  const [navigationRevision, setNavigationRevision] = useState(0)
  const generationRef = useRef(0)
  const operationRef = useRef<Promise<void> | undefined>(undefined)

  const run = useCallback((
    phase: 'restoring' | 'refreshing' | 'signing_out',
    operation: () => Promise<AuthGateState>,
  ): Promise<void> => {
    if (operationRef.current !== undefined) return operationRef.current
    const generation = ++generationRef.current
    setState({ phase, status: 'loading' })
    const operationPromise = operation()
      .then(nextState => {
        if (generation !== generationRef.current) return
        setNavigationRevision(current => current + 1)
        setState(nextState)
      })
      .finally(() => {
        if (operationRef.current === operationPromise) operationRef.current = undefined
      })
    operationRef.current = operationPromise
    return operationPromise
  }, [])

  const retry = useCallback((): void => {
    void run('restoring', () => restoreAuthGate(authGateServices))
  }, [run])

  useEffect(() => {
    retry()
    return () => { generationRef.current += 1 }
  }, [retry])

  const activateDevelopmentSession = useCallback((gatewayOrigin: string): void => {
    generationRef.current += 1
    operationRef.current = undefined
    setNavigationRevision(current => current + 1)
    setState(developmentAuthState(gatewayOrigin))
  }, [])

  const activateSession = useCallback((session: MobileAuthSession): void => {
    generationRef.current += 1
    operationRef.current = undefined
    setNavigationRevision(current => current + 1)
    setState(sessionAuthState(session))
  }, [])

  const handleAuthenticationFailure = useCallback((error?: unknown): void => {
    if (state.status !== 'authenticated') return
    const operation = state.mode === 'session'
      ? () => revokeAuthGate(authGateServices, error)
      : () => logoutAuthGate(authGateServices)
    void run('refreshing', operation)
  }, [run, state])

  const logout = useCallback(async (): Promise<void> => {
    await run('signing_out', () => logoutAuthGate(authGateServices))
  }, [run])

  const value = useMemo<AuthGateContextValue>(() => ({
    activateDevelopmentSession,
    activateSession,
    handleAuthenticationFailure,
    logout,
    navigationRevision,
    retry,
    state,
  }), [activateDevelopmentSession, activateSession, handleAuthenticationFailure, logout, navigationRevision, retry, state])

  return <AuthGateContext.Provider value={value}>{children}</AuthGateContext.Provider>
}

export function useAuthGate(): AuthGateContextValue {
  const context = useContext(AuthGateContext)
  if (context === undefined) throw new Error('useAuthGate must be rendered inside AuthGateProvider')
  return context
}
