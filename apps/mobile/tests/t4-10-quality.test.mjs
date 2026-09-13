import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { mobileTheme } from '../src/theme/tokens.ts'

const sourceRoot = new URL('../src/', import.meta.url)

async function source(file) {
  return readFile(new URL(file, sourceRoot), 'utf8')
}

test('T4-10 keeps the frozen touch target and compact layouts above 44dp', async () => {
  const componentSources = await Promise.all([
    source('components/AppButton.tsx'),
    source('components/IconButton.tsx'),
    source('components/SessionRow.tsx'),
    source('components/SessionDrawer.tsx'),
    source('components/ConversationComposer.tsx'),
  ])

  assert.ok(mobileTheme.touchTarget >= 44)
  assert.match(componentSources[0], /minHeight: touchTarget/)
  assert.match(componentSources[1], /minHeight: mobileTheme\.touchTarget/)
  assert.match(componentSources[2], /minHeight: 92/)
  assert.match(componentSources[2], /compact: \{ minHeight: 78/)
  assert.match(componentSources[3], /width: '86%'/)
  assert.match(componentSources[3], /maxWidth: 360/)
  assert.match(componentSources[4], /minHeight: 44/)
  assert.match(await source('theme/screen-styles.ts'), /settingsRow:[\s\S]*minHeight: 72/)
})

test('T4-10 labels every login credential field and protected command input', async () => {
  const login = await source('screens/LoginScreen.tsx')
  const composer = await source('components/ConversationComposer.tsx')

  assert.match(login, /accessibilityLabel=\{t\('login\.account'\)\}/)
  assert.match(login, /accessibilityLabel=\{t\('login\.adminPassword'\)\}/)
  assert.match(login, /accessibilityLabel=\{`\$\{t\('login\.gatewayOrigin'\)\} \(development\)`\}/)
  assert.match(login, /accessibilityLabel="Development access token"/)
  assert.match(composer, /accessibilityLabel="向 PC Harness 发送消息"/)
})

test('T4-10 preserves safe area, keyboard behavior, and system back priority', async () => {
  const app = await source('app/MobileApp.tsx')
  const login = await source('screens/LoginScreen.tsx')
  const session = await source('screens/SessionScreen.tsx')
  const composer = await source('components/ConversationComposer.tsx')
  const approval = await source('components/ApprovalPanel.tsx')
  const drawer = await source('components/SessionDrawer.tsx')
  const settings = await source('screens/SettingsScreen.tsx')

  assert.match(app, /<SafeAreaProvider>/)
  assert.match(login, /<SafeAreaView[^>]*style=\{styles\.safeArea\}/)
  assert.match(login, /keyboardShouldPersistTaps="handled"/)
  assert.match(session, /<SafeAreaView[^>]*style=\{styles\.safeArea\}/)
  assert.match(session, /<KeyboardAvoidingView/)
  assert.match(session, /edges=\{\['top', 'left', 'right'\]\}/)
  assert.match(composer, /useSafeAreaInsets\(\)/)
  assert.match(composer, /paddingBottom: Math\.max\(insets\.bottom, spacing\.sm\)/)
  assert.match(approval, /marginBottom: Math\.max\(insets\.bottom, spacing\.sm\)/)
  assert.match(drawer, /onRequestClose=\{onDismiss\}/)
  assert.match(drawer, /keyboardShouldPersistTaps="handled"/)
  assert.match(settings, /<SafeAreaView[^>]*style=\{styles\.safeArea\}/)
  assert.match(settings, /keyboardShouldPersistTaps="handled"/)
  assert.match(settings, /onPress=\{navigation\.goBack\}/)
})

test('T4-10 virtualizes long conversations and keeps copy actions touch accessible', async () => {
  const timeline = await source('components/EventTimeline.tsx')
  const markdown = await source('components/MarkdownText.tsx')

  assert.match(timeline, /<FlatList/)
  assert.match(timeline, /windowSize=\{7\}/)
  assert.match(timeline, /keyboardShouldPersistTaps="handled"/)
  assert.doesNotMatch(timeline, /<ScrollView/)
  assert.match(timeline, /expandedActivityKeys\.has\(item\.key\)/)
  assert.match(timeline, /extraData=\{expandedActivityKeys\}/)
  assert.match(timeline, /scrollToEnd\(\{ animated: false \}\)/)
  assert.doesNotMatch(timeline, /const \[expanded, setExpanded\]/)
  assert.match(timeline, /item\.message\.role === 'assistant'[\s\S]*<MarkdownText/)
  assert.match(timeline, /<Text style=\{styles\.messageText\}>\{item\.message\.text\}<\/Text>/)
  assert.match(timeline, /<View style=\{styles\.messageFooter\}>/)
  assert.match(markdown, /minHeight: mobileTheme\.touchTarget/)
  assert.match(markdown, /minWidth: mobileTheme\.touchTarget/)
  assert.match(markdown, /accessibilityRole="link"/)
  assert.match(markdown, /horizontal[\s\S]*nestedScrollEnabled/)
  assert.match(markdown, /copyState.*'error'/)
})

test('T4-10 keeps settings rows readable without leaking nested accessibility noise', async () => {
  const settings = await source('screens/SettingsScreen.tsx')
  assert.match(settings, /<View[\s\S]*accessible[\s\S]*accessibilityLabel=\{`\$\{row\.label\}/)
  assert.match(settings, /accessibilityRole="text"/)
  assert.match(settings, /route\.params\?\.currentSessionId/)
  assert.match(settings, /t\('settings\.gatewayDetail'\)/)
})

test('T4-10 keeps the mobile quality gate explicit about visual verification', async () => {
  const taskPlan = await readFile(new URL('../../../docs/mobile-sync/task-plan.md', import.meta.url), 'utf8')
  assert.match(taskPlan, /T4-10[\s\S]*320\/390\/768/)
  assert.match(taskPlan, /触控目标≥44/)
  assert.match(taskPlan, /可访问性验收/) 
})

test('Mobile release declares Metro build-time packages under strict pnpm linking', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.dependencies['expo-asset'], '~11.0.5')
  assert.equal(packageJson.devDependencies['babel-preset-expo'], '12.0.12')
})

test('Mobile release limits local cleartext Gateway access to emulator host aliases', async () => {
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
  const networkSecurity = await readFile(new URL('../android/app/src/main/res/xml/network_security_config.xml', import.meta.url), 'utf8')

  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/)
  assert.match(networkSecurity, /<base-config cleartextTrafficPermitted="false"/)
  assert.match(networkSecurity, /<domain includeSubdomains="false">10\.0\.2\.2<\/domain>/)
  assert.match(networkSecurity, /<domain includeSubdomains="false">10\.0\.3\.2<\/domain>/)
  assert.doesNotMatch(networkSecurity, /<base-config cleartextTrafficPermitted="true"/)
})
