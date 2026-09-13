import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { LoginScreen } from '../../screens/LoginScreen'
import { SessionScreen } from '../../screens/SessionScreen'
import { SessionsScreen } from '../../screens/SessionsScreen'
import { SettingsScreen } from '../../screens/SettingsScreen'
import { useAuthGate } from '../../features/auth/AuthGateProvider'
import { SessionDirectoryProvider } from '../../features/sessions/SessionDirectoryProvider'
import { routeNames, type RootStackParamList } from './routes'

const Stack = createNativeStackNavigator<RootStackParamList>()
// React Navigation 7 exposes React 19-compatible declarations while Expo SDK 52
// remains on React 18. Keep the compatibility cast isolated at the app boundary.
const NavigationContainerCompat = NavigationContainer as unknown as React.ComponentType<any>
const StackNavigatorCompat = Stack.Navigator as unknown as React.ComponentType<any>

export function AppNavigator(): React.JSX.Element {
  const auth = useAuthGate()
  const authenticated = auth.state.status === 'authenticated'
  if (authenticated) {
    return (
      <NavigationContainerCompat>
        <SessionDirectoryProvider gatewayUrl={auth.state.gatewayOrigin}>
          <StackNavigatorCompat
            key={`protected:${auth.navigationRevision}`}
            initialRouteName={routeNames.sessions}
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen
              component={SessionsScreen}
              initialParams={{ gatewayUrl: auth.state.gatewayOrigin }}
              name={routeNames.sessions}
            />
            <Stack.Screen component={SessionScreen} name={routeNames.session} />
            <Stack.Screen component={SettingsScreen} name={routeNames.settings} />
          </StackNavigatorCompat>
        </SessionDirectoryProvider>
      </NavigationContainerCompat>
    )
  }
  return (
    <NavigationContainerCompat>
      <StackNavigatorCompat
        key={`public:${auth.navigationRevision}`}
        initialRouteName={routeNames.login}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen component={LoginScreen} name={routeNames.login} />
      </StackNavigatorCompat>
    </NavigationContainerCompat>
  )
}
