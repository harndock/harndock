import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceRoot = new URL('../src/', import.meta.url)
const planUrl = new URL('../../../docs/mobile-sync/interaction-upgrade-plan.md', import.meta.url)

async function source(file) {
  return readFile(new URL(file, sourceRoot), 'utf8')
}

test('UXI shared buttons expose stable busy and disabled semantics', async () => {
  const button = await source('components/AppButton.tsx')
  const iconButton = await source('components/IconButton.tsx')
  assert.match(button, /readonly loading\?: boolean/)
  assert.match(button, /accessibilityState=\{\{ busy: loading, disabled: disabled \|\| loading \}\}/)
  assert.match(button, /<ActivityIndicator/)
  assert.match(iconButton, /readonly busy\?: boolean/)
  assert.match(iconButton, /accessibilityState=\{\{ busy, disabled: disabled \|\| busy \}\}/)
  assert.match(iconButton, /busy \? <ActivityIndicator/)
})

test('UXI message copy feedback locks the action and remains accessible', async () => {
  const markdown = await source('components/MarkdownText.tsx')
  const timeline = await source('components/EventTimeline.tsx')
  assert.match(markdown, /const \[copying, setCopying\]/)
  assert.match(markdown, /disabled=\{copying\}/)
  assert.match(markdown, /accessibilityState=\{\{ busy: copying \}\}/)
  assert.match(markdown, /copySuccess/)
  assert.match(timeline, /!item\.message\.streaming && <CopyButton text=\{item\.message\.text\} \/>/)
})

test('UXI Composer and Approval promote async actions without changing flow semantics', async () => {
  const composer = await source('components/ConversationComposer.tsx')
  const approval = await source('components/ApprovalPanel.tsx')
  assert.match(composer, /loading=\{pending\}/)
  assert.match(composer, /taskActive \? \(/)
  assert.match(approval, /loading=\{state\.pending\}/)
  assert.match(approval, /props\.onRespond\('rejected'\)/)
  assert.match(approval, /props\.onRespond\('allowed-once'\)/)
})

test('UXI plan records the default button and copy decisions', async () => {
  const plan = await readFile(planUrl, 'utf8')
  assert.match(plan, /UXI-04 \| P0 \| 实现共享 Button\/IconButton 状态/)
  assert.match(plan, /默认显示图标 \+ “复制”/)
  assert.match(plan, /发送按钮是 Composer 唯一 Primary/)
  assert.match(plan, /复制入口不泄漏工具参数、结果、命令 payload 或未知事件 payload/)
})

test('UXI Session surfaces prioritize attention and preserve active selection', async () => {
  const directory = await source('screens/SessionsScreen.tsx')
  const drawer = await source('components/SessionDrawer.tsx')
  const row = await source('components/SessionRow.tsx')
  assert.match(directory, /t\('sessions\.attention'\)/)
  assert.match(directory, /t\('sessions\.recent'\)/)
  assert.match(drawer, /sections\.attention\.map/)
  assert.match(drawer, /sections\.recent\.map/)
  assert.match(drawer, /accessibilityRole="header"/)
  assert.match(row, /accessibilityState=\{\{ selected: active \}\}/)
})

test('UXI offline and recovery notices provide one consistent sync retry action', async () => {
  const directory = await source('screens/SessionsScreen.tsx')
  const banner = await source('components/Banner.tsx')
  assert.match(directory, /<Banner action=\{syncRetryAction\} tone="warning">/)
  assert.match(directory, /syncRetryAvailable/)
  assert.match(directory, /syncMessageKey === 'sessions\.sync\.recovered'/)
  assert.match(directory, /loading=\{directory\.syncRetrying\}/)
  assert.match(directory, /loading=\{directory\.inventoryRetrying\}/)
  assert.match(banner, /accessibilityLiveRegion="polite"/)
  assert.match(banner, /style=\{styles\.action\}/)
})

test('UXI accessibility flow keeps high-frequency actions discoverable and stateful', async () => {
  const login = await source('screens/LoginScreen.tsx')
  const settings = await source('screens/SettingsScreen.tsx')
  const session = await source('screens/SessionScreen.tsx')
  const composer = await source('components/ConversationComposer.tsx')
  const approval = await source('components/ApprovalPanel.tsx')
  const markdown = await source('components/MarkdownText.tsx')
  const drawer = await source('components/SessionDrawer.tsx')
  assert.match(login, /accessibilityLabel=\{t\('login\.account'\)\}/)
  assert.match(login, /loading=\{login\.busy \|\| login\.restoring\}/)
  assert.match(settings, /loading=\{retrying\}/)
  assert.match(session, /accessibilityLabel=\{t\('conversation\.openSessions'\)\}/)
  assert.match(session, /accessibilityLabel=\{t\('conversation\.openSettings'\)\}/)
  assert.match(composer, /accessibilityLabel=\{t\('composer\.inputA11y'\)\}/)
  assert.match(composer, /accessibilityLabel=\{t\('composer\.send'\)\}/)
  assert.match(composer, /accessibilityLabel=\{state\.mode === 'stopping' \? t\('composer\.stopping'\) : t\('composer\.stop'\)\}/)
  assert.match(approval, /label=\{t\('approval\.reject'\)\}/)
  assert.match(approval, /label=\{t\('approval\.allowOnce'\)\}/)
  assert.match(markdown, /accessibilityRole="button"/)
  assert.match(markdown, /accessibilityLiveRegion="polite"/)
  assert.match(drawer, /accessibilityViewIsModal/)
  assert.match(drawer, /onRequestClose=\{onDismiss\}/)
})

test('UXI responsive regression keeps the approved narrow-screen constraints explicit', async () => {
  const taskPlan = await readFile(new URL('../../../docs/mobile-sync/task-plan.md', import.meta.url), 'utf8')
  const styles = await source('theme/screen-styles.ts')
  const composer = await source('components/ConversationComposer.tsx')
  const approval = await source('components/ApprovalPanel.tsx')
  assert.match(taskPlan, /320\/390\/768/)
  assert.match(taskPlan, /触控目标≥44/)
  assert.match(styles, /sessionList:[\s\S]*paddingHorizontal: spacing\.lg/)
  assert.match(styles, /bannerAction:[\s\S]*minHeight: 40/)
  assert.match(composer, /KeyboardAvoidingView|useSafeAreaInsets|paddingBottom: Math\.max\(insets\.bottom, spacing\.sm\)/)
  assert.match(approval, /marginBottom: Math\.max\(insets\.bottom, spacing\.sm\)/)
})

test('UXI localized descriptors resolve nested Gateway state labels before interpolation', async () => {
  const i18n = await readFile(new URL('../src/i18n/index.tsx', import.meta.url), 'utf8')
  assert.match(i18n, /Object\.entries\(value\.params\)/)
  assert.match(i18n, /resolveMessageParam\(translator, param\)/)
  assert.match(i18n, /translator\(value\.key as MobileMessageKey/)
  assert.doesNotMatch(i18n, /String\(param\)/)
})
