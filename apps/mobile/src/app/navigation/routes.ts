export const routeNames = {
  login: 'Login',
  sessions: 'Sessions',
  session: 'Session',
  settings: 'Settings',
} as const

export type RootStackParamList = {
  Login: undefined
  Sessions: { gatewayUrl: string }
  Session: { sessionId: string; gatewayUrl: string }
  Settings: { currentSessionId?: string }
}
