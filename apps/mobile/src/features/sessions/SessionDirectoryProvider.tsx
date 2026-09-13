import { createContext, useContext, type ReactNode } from 'react'
import { useAuthGate } from '../auth/AuthGateProvider'
import { useSessionDirectory, type SessionDirectoryController } from './useSessionDirectory'

const SessionDirectoryContext = createContext<SessionDirectoryController | undefined>(undefined)

export interface SessionDirectoryProviderProps {
  readonly children: ReactNode
  readonly gatewayUrl: string
}

export function SessionDirectoryProvider({
  children,
  gatewayUrl,
}: SessionDirectoryProviderProps): React.JSX.Element {
  const auth = useAuthGate()
  const directory = useSessionDirectory(gatewayUrl, auth.handleAuthenticationFailure)

  return (
    <SessionDirectoryContext.Provider value={directory}>
      {children}
    </SessionDirectoryContext.Provider>
  )
}

export function useSharedSessionDirectory(): SessionDirectoryController {
  const directory = useContext(SessionDirectoryContext)
  if (directory === undefined) {
    throw new Error('useSharedSessionDirectory must be used within SessionDirectoryProvider')
  }
  return directory
}
