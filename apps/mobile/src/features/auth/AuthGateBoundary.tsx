import { AuthRecoveryScreen } from '../../screens/AuthRecoveryScreen'
import { SplashScreen } from '../../screens/SplashScreen'
import { useAuthGate } from './AuthGateProvider'
import { useI18n } from '../../i18n'

export function AuthGateBoundary({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const auth = useAuthGate()
  const { t } = useI18n()
  if (auth.state.status === 'loading') {
    const message = auth.state.phase === 'refreshing'
      ? t('auth.refreshSession')
      : auth.state.phase === 'signing_out'
        ? t('auth.signingOut')
        : t('auth.restoreSession')
    return <SplashScreen message={message} />
  }
  if (auth.state.status === 'recovery_error') {
    return <AuthRecoveryScreen message={recoveryMessage(auth.state.message, t)} onRetry={auth.retry} />
  }
  return <>{children}</>
}

function recoveryMessage(message: string, t: ReturnType<typeof useI18n>['t']): string {
  const known: Record<string, Parameters<typeof t>[0]> = {
    '无法验证 Gateway 会话，请检查网络后重试。': 'auth.recoveryVerify',
    '无法读取本机安全会话，请重试。': 'auth.localSession',
    '无法验证开发凭据，请检查网络后重试。': 'auth.devCredential',
    'Gateway 会话刷新失败，请检查网络后重试。': 'auth.refreshFailed',
    '无法清除本机安全会话，请重试。': 'auth.clearSession',
    '无法清除已撤销设备的本机身份，请重试。': 'auth.clearRevoked',
  }
  const key = known[message]
  return key === undefined ? message : t(key)
}
