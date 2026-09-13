import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { routeNames } from '../src/app/navigation/routes.ts'
import { mobileTheme } from '../src/theme/tokens.ts'

const sourceRoot = new URL('../src/', import.meta.url)

test('Mobile theme keeps the frozen Harness palette and accessible touch target', () => {
  assert.equal(mobileTheme.color.brand, '#3f4fb5')
  assert.equal(mobileTheme.color.text, '#151a2f')
  assert.ok(mobileTheme.touchTarget >= 44)
  assert.ok(mobileTheme.spacing.xs < mobileTheme.spacing.sm)
  assert.ok(mobileTheme.spacing.sm < mobileTheme.spacing.md)
})

test('Mobile navigation exposes the connection, directory, and conversation routes', () => {
  assert.deepEqual(routeNames, {
    login: 'Login',
    sessions: 'Sessions',
    session: 'Session',
    settings: 'Settings',
  })
})

test('Mobile screens stay behind feature controllers and shared components', async () => {
  const screenFiles = ['screens/LoginScreen.tsx', 'screens/SessionsScreen.tsx', 'screens/SessionScreen.tsx', 'screens/SettingsScreen.tsx']
  for (const file of screenFiles) {
    const source = await readFile(new URL(file, sourceRoot), 'utf8')
    assert.doesNotMatch(source, /from ['"]\.\.\/services/)
    assert.doesNotMatch(source, /from ['"]\.\.\/sync/)
    assert.doesNotMatch(source, /import\s*\{[^}]*\bButton\b[^}]*\}\s*from ['"]react-native['"]/s)
  }
})

test('Mobile architecture keeps the entry point small and required boundaries present', async () => {
  const requiredFiles = [
    'app/MobileApp.tsx',
    'app/navigation/AppNavigator.tsx',
    'components/AppHeader.tsx',
    'components/AppButton.tsx',
    'components/ApprovalPanel.tsx',
    'components/IconButton.tsx',
    'components/Banner.tsx',
    'components/Card.tsx',
    'components/ConversationComposer.tsx',
    'components/StatusDot.tsx',
    'components/EmptyState.tsx',
    'components/EventTimeline.tsx',
    'components/NavigationPlaceholder.tsx',
    'components/PcConnectionStrip.tsx',
    'components/SessionDrawer.tsx',
    'components/SessionRow.tsx',
    'components/contracts.ts',
    'features/connection/useConnectionSetup.ts',
    'features/connection/gatewayOriginState.ts',
    'features/auth/AuthGateProvider.tsx',
    'features/auth/AuthGateBoundary.tsx',
    'features/auth/auth-gate-state.ts',
    'features/auth/administrator-login.ts',
    'features/auth/useAdministratorLogin.ts',
    'features/auth/debug-token.ts',
    'features/sessions/useSessionDirectory.ts',
    'features/sessions/SessionDirectoryProvider.tsx',
    'features/sessions/useSessionDrawer.ts',
    'features/sessions/directory-model.ts',
    'features/conversation/useConversationSession.ts',
    'features/conversation/approval-model.ts',
    'features/conversation/timeline-model.ts',
    'features/conversation/composer-model.ts',
    'features/settings/settings-model.ts',
    'services/storage.ts',
    'services/transport.ts',
    'sync/gateway-url.ts',
    'sync/gateway-auth-api.ts',
    'sync/mobile-installation.ts',
    'sync/mobile-session.ts',
    'sync/secure-session-store.ts',
    'theme/tokens.ts',
  ]
  await Promise.all(requiredFiles.map(file => readFile(new URL(file, sourceRoot), 'utf8')))

  const entryPoint = await readFile(new URL('App.tsx', sourceRoot), 'utf8')
  assert.ok(entryPoint.trim().split('\n').length <= 4)
  assert.doesNotMatch(entryPoint, /GatewayApi|ViewerSync|openSyncDatabase/)

  const navigator = await readFile(new URL('app/navigation/AppNavigator.tsx', sourceRoot), 'utf8')
  assert.match(navigator, /if \(authenticated\)/)
  assert.match(navigator, /<SessionDirectoryProvider gatewayUrl=\{auth\.state\.gatewayOrigin\}>/)
  const connection = await readFile(new URL('features/connection/useConnectionSetup.ts', sourceRoot), 'utf8')
  assert.match(connection, /loadLegacyAccessToken/)
  assert.doesNotMatch(connection, /\bloadAccessToken\b/)

  const login = await readFile(new URL('screens/LoginScreen.tsx', sourceRoot), 'utf8')
  assert.match(login, /manualTokenEntryEnabled && <DevelopmentTokenForm/)
  assert.doesNotMatch(login, /PairingScreen|注册并|创建账号/)
})

test('Mobile internationalization is restored before navigation and exposed in Settings', async () => {
  const app = await readFile(new URL('app/MobileApp.tsx', sourceRoot), 'utf8')
  const provider = await readFile(new URL('i18n/index.tsx', sourceRoot), 'utf8')
  const settings = await readFile(new URL('screens/SettingsScreen.tsx', sourceRoot), 'utf8')

  assert.match(app, /<I18nProvider>/)
  assert.match(provider, /dsh\.mobile\.locale\.v1/)
  assert.match(provider, /SecureStore\.getItemAsync/)
  assert.match(provider, /if \(!ready\)/)
  assert.match(provider, /createTranslator/)
  assert.match(settings, /<LanguageSelect\s*\/>/)
})

test('Mobile conversation metadata follows the active locale', async () => {
  const timeline = await readFile(new URL('components/EventTimeline.tsx', sourceRoot), 'utf8')
  const model = await readFile(new URL('features/conversation/timeline-model.ts', sourceRoot), 'utf8')
  assert.match(timeline, /formatNumber[\s\S]*formatTime/)
  assert.match(timeline, /timeline\.meta\.timeSeq/)
  assert.match(model, /summaryMessage: describeEventMessage/)
  assert.match(model, /commandStatus: command\.status/)
})

test('Mobile command and approval notices translate legacy dynamic details', async () => {
  const provider = await readFile(new URL('i18n/index.tsx', sourceRoot), 'utf8')
  const composer = await readFile(new URL('components/ConversationComposer.tsx', sourceRoot), 'utf8')
  const approval = await readFile(new URL('components/ApprovalPanel.tsx', sourceRoot), 'utf8')

  assert.match(provider, /conversation\.notice\.commandFinished/)
  assert.match(provider, /conversation\.notice\.commandRejected/)
  assert.match(provider, /approval\.notice\.unknownRetry/)
  assert.match(provider, /approval\.notice\.pendingResubmit/)
  assert.match(provider, /translateLegacyNotice[\s\S]*commandFinished/)
  assert.match(composer, /translateLegacyNotice\(t, state\.detail\)/)
  assert.match(approval, /translateLegacyNotice\(t, state\.detail\)/)
})

test('MP-04 approval panel takes over the Composer without exposing event payloads', async () => {
  const conversation = await readFile(new URL('screens/SessionScreen.tsx', sourceRoot), 'utf8')
  assert.match(conversation, /approval != null && projection != null/)
  assert.match(conversation, /<ApprovalPanel/)
  assert.match(conversation, /:\s*\(\s*<ConversationComposer/s)
  assert.doesNotMatch(conversation, /待处理审批：|<Card[^>]*tone="warning"/)

  const panel = await readFile(new URL('components/ApprovalPanel.tsx', sourceRoot), 'utf8')
  assert.match(panel, /extends ApprovalPanelContract/)
  assert.match(panel, /props\.toolName/)
  assert.doesNotMatch(panel, /recentEvents|event\.data|arguments|commandLine|payload/)

  const controller = await readFile(new URL('features/conversation/useConversationSession.ts', sourceRoot), 'utf8')
  assert.match(controller, /approvalLockRef\.current\.claim\(approvalId\)/)
  assert.match(controller, /error\.code === 'approval_already_decided'/)
  assert.match(controller, /projection\.unresolvedApproval\?\.approvalId === approvalAttempt\.approvalId/)
})

test('MP-02 keeps inventory compact and makes Session rows the navigation target', async () => {
  const directory = await readFile(new URL('screens/SessionsScreen.tsx', sourceRoot), 'utf8')
  const controller = await readFile(new URL('features/sessions/useSessionDirectory.ts', sourceRoot), 'utf8')
  assert.match(directory, /<PcConnectionStrip summary=\{pcSummary\}/)
  assert.match(directory, /<SessionRow/)
  assert.match(directory, /t\('sessions\.attention'\)/)
  assert.match(directory, /t\('sessions\.recent'\)/)
  assert.doesNotMatch(directory, /directory\.devices\.map|directory\.runtimes\.filter|查看 Session/)

  const conversation = await readFile(new URL('screens/SessionScreen.tsx', sourceRoot), 'utf8')
  assert.match(conversation, /<SessionDrawer/)
  assert.match(conversation, /<EventTimeline/)
  assert.match(conversation, /<ConversationComposer/)
  assert.match(conversation, /<KeyboardAvoidingView/)
  assert.match(conversation, /navigation\.replace\('Session'/)
  assert.doesNotMatch(conversation, /最近事件|recentEvents\.slice|describeEvent/)
  assert.doesNotMatch(conversation, /<TextInput|label="发送消息"|label="停止任务"/)
})

test('MP-05 exposes Settings from both mobile work surfaces without a second ViewerSync', async () => {
  const navigator = await readFile(new URL('app/navigation/AppNavigator.tsx', sourceRoot), 'utf8')
  const directory = await readFile(new URL('screens/SessionsScreen.tsx', sourceRoot), 'utf8')
  const conversation = await readFile(new URL('screens/SessionScreen.tsx', sourceRoot), 'utf8')
  const settings = await readFile(new URL('screens/SettingsScreen.tsx', sourceRoot), 'utf8')
  const controller = await readFile(new URL('features/sessions/useSessionDirectory.ts', sourceRoot), 'utf8')

  assert.match(navigator, /component=\{SettingsScreen\}/)
  assert.match(directory, /navigation\.navigate\('Settings', \{\}\)/)
  assert.match(directory, /resolveMessage\(t, directory\.syncMessageDescriptor\)/)
  assert.match(directory, /resolveMessage\(t, directory\.inventoryMessageDescriptor\)/)
  assert.match(controller, /sessions\.sync\.replaying/)
  assert.match(controller, /sessions\.inventory\.multipleFailed/)
  assert.match(conversation, /navigation\.navigate\('Settings', \{ currentSessionId:/)
  assert.match(settings, /useSharedSessionDirectory\(\)/)
  assert.match(settings, /t\('settings\.refresh'\)/)
  assert.match(settings, /t\('common\.logout'\)/)
  assert.doesNotMatch(settings, /ViewerSync|GatewayApi|loadAccessToken|accessToken|refreshToken/)
})
