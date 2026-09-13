import { AppNavigator } from './navigation/AppNavigator'
import { AuthGateBoundary } from '../features/auth/AuthGateBoundary'
import { AuthGateProvider } from '../features/auth/AuthGateProvider'
import { SafeAreaProvider as NativeSafeAreaProvider } from 'react-native-safe-area-context'
import { I18nProvider } from '../i18n'

// Expo SDK 52 stays on React 18 while this dependency exposes React 19 declarations.
const SafeAreaProvider = NativeSafeAreaProvider as unknown as React.ComponentType<any>

export function MobileApp(): React.JSX.Element {
  return (
    <I18nProvider>
      <SafeAreaProvider>
        <AuthGateProvider>
          <AuthGateBoundary>
            <AppNavigator />
          </AuthGateBoundary>
        </AuthGateProvider>
      </SafeAreaProvider>
    </I18nProvider>
  )
}
