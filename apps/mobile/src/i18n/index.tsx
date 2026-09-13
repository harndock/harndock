import {
  DEFAULT_LOCALES,
  assertDictionaryParity,
  createTranslator,
  resolveLocale,
  type MessageParams,
} from '@harndock/i18n-core'
import * as SecureStore from 'expo-secure-store'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { mobileTheme } from '../theme'
import { message, type MobileMessage } from './messages'

const LOCALE_STORAGE_KEY = 'dsh.mobile.locale.v1'

const zh = {
  'common.language': '语言',
  'common.cancel': '取消',
  'common.retry': '重试',
  'common.refresh': '刷新',
  'common.logout': '退出登录',
  'common.loading': '读取中...',
  'nav.settings': '设置与诊断',
  'auth.restoreSession': '正在恢复安全会话…',
  'auth.refreshSession': '正在刷新 Gateway 会话…',
  'auth.signingOut': '正在安全退出…',
  'auth.recoveryTitle': '无法恢复 Gateway 会话',
  'auth.recoverySubtitle': '受保护页面尚未开放',
  'auth.retryRecovery': '重试恢复',
  'auth.recoveryVerify': '无法验证 Gateway 会话，请检查网络后重试。',
  'auth.localSession': '无法读取本机安全会话，请重试。',
  'auth.devCredential': '无法验证开发凭据，请检查网络后重试。',
  'auth.refreshFailed': 'Gateway 会话刷新失败，请检查网络后重试。',
  'auth.clearSession': '无法清除本机安全会话，请重试。',
  'auth.clearRevoked': '无法清除已撤销设备的本机身份，请重试。',
  'login.title': '从手机继续你的 Session',
  'login.copy': '安全连接到 PC 上的 Harness Runtime。模型、工具和文件仍只在你的电脑上执行。',
  'login.account': '管理员账号',
  'login.password': '密码',
  'login.passwordPlaceholder': '输入管理员密码',
  'login.signingIn': '正在登录…',
  'login.restoring': '正在恢复配置…',
  'login.submit': '登录并连接',
  'login.noRegistration': 'Gateway 不提供注册。密码仅用于本次登录，access / refresh token 保存到系统安全存储。',
  'login.gatewayOrigin': 'Gateway origin',
  'login.adminPassword': '管理员密码',
  'login.devTokenTitle': 'Debug token 兼容入口',
  'login.devTokenCopy': '仅显式开发构建可见，不属于正式登录和验收路径。',
  'login.useDevToken': '使用开发 token 连接',
  'login.devTokenPlaceholder': '短期 access token',
  'sessions.subtitle': '从手机继续 PC 上的 Harness 工作',
  'sessions.openSettings': '打开设置与诊断',
  'sessions.retrying': '正在重试…',
  'sessions.retryPcStatus': '重试 PC 状态',
  'sessions.loading': '正在读取 Session…',
  'sessions.attention': '需要处理',
  'sessions.recent': '最近 Session',
  'sessions.emptyTitle': '暂无 Session',
  'sessions.emptyCopy': 'PC 上授权的 Session 会自动出现在这里。',
  'sessions.refreshing': '正在刷新…',
  'sessions.refreshSync': '刷新同步',
  'sessions.footer': '完整设备与 Runtime 信息将在设置与诊断中提供。',
  'sessions.sync.replaying': '正在补发历史：Session {session}，从 seq {seq} 开始',
  'sessions.sync.recovered': '历史补发完成，已恢复实时同步。',
  'sessions.sync.failed': '同步失败：{code}',
  'sessions.sync.failedGeneric': '同步失败，请检查网络和凭据',
  'sessions.inventory.devicesFailed': '设备读取失败：{code}',
  'sessions.inventory.runtimesFailed': 'Runtime 读取失败：{code}',
  'sessions.inventory.multipleFailed': '设备读取失败：{devices}；Runtime 读取失败：{runtimes}',
  'settings.subtitle': '账号、连接与本机数据',
  'settings.account': '账号',
  'settings.diagnostics': '连接诊断',
  'settings.privacy': '隐私与管理',
  'settings.retrying': '正在刷新…',
  'settings.refresh': '刷新诊断',
  'settings.issue': '最近一次同步未完全成功；本页未展示服务端错误正文，可重试诊断。',
  'settings.localDataLabel': '本机数据',
  'settings.localDataValue': '仅保存继续工作所需数据',
  'settings.localDataDetail': '安全会话由系统安全存储保管；已确认的 Session 投影保存在本机。',
  'settings.gatewayLabel': 'Gateway 管理',
  'settings.gatewayValue': '管理端职责保持独立',
  'settings.gatewayDetail': '设备撤销、Token 与 PC 配对仍由 Gateway Web 管理。',
  'status.connection.idle': '未连接',
  'status.connection.connecting': '连接中',
  'status.connection.connected': '已连接',
  'status.connection.reconnecting': '正在重连',
  'status.connection.closed': '离线',
  'status.connection.error': '连接错误',
  'status.connection.unknown': '未知连接状态',
  'status.session.idle': '空闲',
  'status.session.running': '运行中',
  'status.session.waiting': '等待中',
  'status.session.completed': '已完成',
  'status.session.failed': '失败',
  'status.session.cancelled': '已取消',
  'status.session.offline': 'PC 离线',
  'status.session.unknown': '未知 Session 状态',
  'command.status.received': '已接收',
  'command.status.authorized': '已授权',
  'command.status.queued': '已排队',
  'command.status.executing': '执行中',
  'command.status.completed': '已完成',
  'command.status.rejected': '已拒绝',
  'command.status.expired': '已过期',
  'command.status.unknown': '状态未知',
  'session.activity.unknown': '活动时间未知',
  'session.activity.justNow': '刚刚',
  'session.activity.minutesAgo': '{count} 分钟前',
  'session.activity.hoursAgo': '{count} 小时前',
  'session.activity.daysAgo': '{count} 天前',
  'session.summary.awaitingApproval': '等待审批：{tool}',
  'session.summary.syncingHistory': '正在同步对话历史',
  'session.summary.empty': '暂无对话摘要',
  'session.badge.attention': '待处理',
  'session.accessibility.openConversation': '打开此 Session 的 Conversation',
  'connection.notice.connecting': '正在连接 Gateway，当前显示本地缓存。',
  'connection.notice.reconnecting': 'Gateway 连接中断，正在重连；当前显示本地缓存。',
  'connection.notice.offline': 'Gateway 离线，当前显示本地缓存。',
  'pc.title.online': '{device} · 在线',
  'pc.detail.online': '{profile} · 心跳 {heartbeat} · Gateway {gateway}',
  'pc.title.offline': '{device} · 离线',
  'pc.detail.offline': '{platform} · Runtime {runtimeCount} · Gateway {gateway}',
  'pc.title.unpaired': '尚未连接 PC',
  'pc.detail.gatewayReady': 'Gateway 已连接，尚无已配对 PC Runtime',
  'pc.detail.gatewayState': 'Gateway {gateway}',
  'pc.heartbeat.unknown': '未知',
  'pc.heartbeat.justNow': '刚刚',
  'pc.heartbeat.minutesAgo': '{count} 分钟前',
  'pc.heartbeat.hoursAgo': '{count} 小时前',
  'pc.gateway.connected': '已连接',
  'pc.gateway.connecting': '连接中',
  'pc.gateway.reconnecting': '重连中',
  'pc.gateway.offline': '离线',
  'settings.row.account': '当前账号',
  'settings.row.device': '当前设备',
  'settings.row.scopes': '授权范围',
  'settings.row.scopesEmpty': '未提供 scope 摘要',
  'settings.row.gateway': 'Gateway',
  'settings.row.runtime': 'PC Runtime',
  'settings.row.stream': '同步流',
  'settings.row.streamDetailNoReplay': '{count} 个 Session · 无历史补发',
  'settings.row.streamDetailReplaying': '{sessions} 个 Session · {count} 个正在补发',
  'settings.row.cursorRecent': '最近 Session 游标',
  'settings.row.cursorCurrent': '当前 Session 游标',
  'settings.row.cursorEmpty': '暂无同步游标',
  'settings.row.cursorSeq': 'seq {seq}',
  'settings.row.cursorWaiting': '等待 PC 发布 Session',
  'settings.row.cursorSynced': '已跟上确认历史',
  'settings.row.cursorReplaying': '正在补发确认历史',
  'settings.row.development': '开发凭据',
  'settings.row.unavailable': '信息不可用',
  'conversation.header': 'Conversation',
  'conversation.session': 'Session',
  'conversation.openSessions': '打开 Session 列表',
  'conversation.openSettings': '打开设置与诊断',
  'conversation.historySynced': '历史已同步',
  'conversation.historyReplaying': '正在补发历史',
  'conversation.offlineBanner': 'PC 离线，当前仅可查看已确认历史，控制操作将在 Runtime 恢复在线后开放。',
  'conversation.replayingBanner': '正在从 Gateway 补发已确认历史，实时事件会在补发完成后继续。',
  'conversation.emptyRestoringTitle': '正在读取 Conversation',
  'conversation.emptyRestoringCopy': '正在恢复本地快照。',
  'conversation.emptyTitle': '暂无 Conversation 内容',
  'conversation.emptyCopy': 'PC 上的新消息和事件会显示在这里。',
  'conversation.emptyHistoryTitle': '正在同步历史',
  'conversation.emptyHistoryCopy': '正在从 Gateway 补发已确认历史。',
  'conversation.jumpBottom': '↓ 回到底部',
  'conversation.jumpBottomA11y': '回到 Conversation 底部',
  'conversation.activityHint': '查看本轮工具和状态摘要',
  'conversation.activityCollapse': '收起',
  'conversation.activityExpand': '展开',
  'conversation.activitySafe': '仅展示安全摘要',
  'conversation.activityDetails': '点击查看执行详情',
  'conversation.streaming': '生成中',
  'conversation.generated': '正在生成',
  'composer.dismiss': '关闭命令状态并继续编辑',
  'composer.inputA11y': '向 PC Harness 发送消息',
  'composer.inputPlaceholder': '向 PC 上的 Harness 发送消息…',
  'composer.stopping': '正在停止任务',
  'composer.stop': '停止当前任务',
  'composer.send': '发送消息',
  'composer.state.loading': '正在准备控制',
  'composer.state.replaying': '正在补发历史',
  'composer.state.offline': 'PC Runtime 离线',
  'composer.state.ready': '由 PC Harness 执行',
  'composer.state.submitting': '正在提交到 PC Harness',
  'composer.state.queued': '已排队',
  'composer.state.executing': '执行中',
  'composer.state.stopping': '停止中',
  'composer.state.unknown': '命令状态未知',
  'composer.state.error': '命令状态异常',
  'approval.state.pending': '需要你的审批',
  'approval.state.submitting': '正在提交审批决定',
  'approval.state.queued': '已提交审批决定',
  'approval.state.executing': '正在处理审批决定',
  'approval.state.confirming': '已提交审批决定',
  'approval.state.stale': '审批页面状态已过期',
  'approval.state.unknown': '审批命令状态未知',
  'approval.state.offline': 'PC Runtime 离线',
  'approval.state.already-decided': '已由其他设备处理',
  'approval.state.error': '审批状态异常',
  'conversation.notice.snapshotMissing': '本地尚未收到该 Session 的快照，请稍后重试。',
  'conversation.notice.historyWaiting': '历史仍在补发，请等待 Session 状态追平后再发送。',
  'conversation.notice.runtimeOffline': 'PC Runtime 离线，命令没有提交。',
  'conversation.notice.commandAcceptedQueryFailed': '命令已被 Gateway 接受，但状态查询失败；刷新只会查询原命令。',
  'conversation.notice.approvalDecided': '该审批已由其他设备处理。',
  'conversation.notice.deliveryUnknown': '无法确认 Gateway 是否收到命令；重试将复用同一命令 ID。',
  'conversation.notice.recoveryFailed': '无法恢复命令状态；刷新只会查询原命令，不会重新执行。',
  'conversation.notice.approvalGone': '该审批已不再待处理，请查看最新 Session 事件。',
  'conversation.notice.controlsPreparing': '等待本地 Session 快照。',
  'conversation.notice.historyCatchup': '历史追平前暂停发送，避免基于过期状态执行。',
  'conversation.notice.confirmedHistoryOnly': '已确认历史仍可查看，连接恢复后可继续。',
  'conversation.notice.historySyncedCanResubmit': '历史已追平，可以重新提交。',
  'conversation.notice.checkConnection': '请检查连接后重试。',
  'conversation.notice.noAutoExecute': '不会自动重新执行命令。',
  'conversation.notice.queryOnly': '只查询原命令，不会重新执行。',
  'conversation.notice.waitGateway': '等待 Gateway 接受命令。',
  'conversation.notice.waitConnector': '等待 PC Connector 执行。',
  'conversation.notice.eventSource': '实际结果以时间线事件为准。',
  'conversation.notice.sessionEventSource': 'Session 状态只会由真实事件更新。',
  'conversation.notice.waitHarnessEnd': '等待 PC Harness 返回真实结束事件。',
  'conversation.notice.commandNotSubmitted': '命令未提交',
  'conversation.notice.commandSubmitFailed': '命令提交失败',
  'conversation.notice.commandStatusUnknown': '命令状态未确认',
  'conversation.notice.commandFinished': '命令结束：{status}{reason}',
  'conversation.notice.commandRejected': 'Gateway 拒绝命令：{code}',
  'conversation.notice.commandRecoveryFailed': '无法恢复命令状态：{code}',
  'conversation.notice.commandStillActive': '命令仍未进入终态；刷新只查询原命令，不会重新执行。',
  'conversation.notice.unknownRetryGeneric': '请先检查时间线，再决定是否重新提交；系统不会自动重放。',
  'conversation.notice.resubmitAfterSession': '可以在确认 Session 状态后重新提交。',
  'conversation.notice.historyBeforeApproval': '历史追平前不能作出决定。',
  'conversation.notice.approvalReconnect': '审批仍待处理，连接恢复后才能提交决定。',
  'conversation.notice.approvalEventSync': '正在等待真实审批事件同步到时间线。',
  'conversation.notice.waitGatewayApproval': '等待 Gateway 接受审批决定。',
  'conversation.notice.noDuplicateApproval': '只查询原命令，不会重复决定。',
  'conversation.notice.noAutoApproval': '不会自动重复提交审批决定。',
  'conversation.notice.waitHarnessApproval': '等待 PC Harness 处理审批命令。',
  'conversation.notice.approvalEventResult': '审批结果以真实 Session 事件为准。',
  'conversation.notice.waitHarnessApprovalEvent': '等待 PC Harness 返回真实审批事件。',
  'conversation.notice.approvalScope': '只允许本次请求，完整参数请在 PC Harness 中核对。',
  'composer.detail.gatewayExecution': '发送内容不会在 Gateway 执行。',
  'conversation.reason.runtimeOffline': '（PC 离线）',
  'conversation.reason.deviceRevoked': '（设备已撤销）',
  'conversation.reason.approvalDecided': '（已由其他设备处理）',
  'conversation.reason.generic': '（{reason}）',
  'approval.outcome.allowOnce': '允许一次',
  'approval.outcome.reject': '拒绝',
  'approval.outcome.decision': '审批决定',
  'approval.notice.unknownRetry': '请先检查时间线，再决定是否重试“{outcome}”；系统不会自动重放。',
  'approval.notice.pendingResubmit': '当前审批仍待处理，可以重新提交“{outcome}”。',
  'approval.notice.staleResubmit': '状态已追平，可以重新提交。',
  'approval.notice.staleWaiting': '正在等待同步到 seq {seq}。',
  'approval.eyebrow': 'PC HARNESS 请求使用工具',
  'approval.safety': '移动端仅显示安全摘要。批准前请在 PC 上核对完整操作范围。',
  'approval.reject': '拒绝',
  'approval.allowOnce': '允许一次',
  'copy.idle': '复制',
  'copy.copied': '已复制',
  'copy.failed': '复制失败',
  'copy.reply': '回复',
  'copy.code': '代码',
  'drawer.title': 'Sessions',
  'drawer.subtitle': '按需要处理和最近活动排序',
  'drawer.close': '关闭 Session 抽屉',
  'drawer.empty': '暂无已同步 Session',
  'drawer.openDirectory': '返回 Session 首页',
  'nav.back': '返回',
  'nav.settingsLabel': '设置',
  'nav.placeholder': '主导航占位',
  'splash.subtitle': 'Gateway 安全会话',
  'markdown.codeFallback': '代码',
  'markdown.openLink': '打开 {href}',
  'timeline.activity.summary': '运行过程 · 工具 {tools} · 审批 {approvals} · 状态 {statuses}',
  'timeline.command.remoteMessage': '已提交远程消息',
  'timeline.command.stopRequest': '已提交停止请求',
  'timeline.command.approvalResponse': '已提交审批响应',
  'timeline.command.status': '命令状态：{status}',
  'timeline.command.detail': '命令内容和凭据不会写入此时间线摘要。',
  'timeline.event.toolCall': '工具调用',
  'timeline.event.toolResult': '工具结果',
  'timeline.event.approvalPending': '等待审批',
  'timeline.event.approvalUpdated': '审批已更新',
  'timeline.event.harnessStart': 'Harness 开始处理',
  'timeline.event.harnessEnd': 'Harness 本轮结束',
  'timeline.event.stepStart': '步骤开始',
  'timeline.event.stepEnd': '步骤完成',
  'timeline.event.commandStatus': '远程命令状态',
  'timeline.event.sessionStatus': 'Session 状态更新',
  'timeline.detail.toolCall': '工具参数、路径和环境信息已隐藏。',
  'timeline.detail.toolResult': '工具输出和结果内容已隐藏。',
  'timeline.detail.unknown': '当前客户端保留此事件的位置与类型，但不会展开未知 payload。',
  'timeline.detail.generic': '详细 payload 不在移动端展示。',
  'timeline.summary.messageUnavailable': '消息内容不可用',
  'timeline.summary.toolCall': '工具调用：{tool}（参数已隐藏）',
  'timeline.summary.toolCallUnknown': '工具调用已发出（参数已隐藏）',
  'timeline.summary.toolResult': '工具结果已收到（结果内容已隐藏）',
  'timeline.summary.approvalNeeded': '需要审批：{tool}',
  'timeline.summary.approvalNeededUnknown': '需要工具审批',
  'timeline.summary.approvalConfirmed': '审批结果已由 PC Harness 确认',
  'timeline.summary.turnStarted': 'PC Harness 已开始处理本轮请求',
  'timeline.summary.turnCompleted': '本轮请求已完成',
  'timeline.summary.turnAborted': '本轮请求已停止',
  'timeline.summary.turnEnded': '本轮请求已结束',
  'timeline.summary.statusUpdated': '状态已更新',
  'timeline.summary.status': '状态：{status}',
  'timeline.summary.unknownEvent': '未知事件已保留，当前客户端不展开其 payload。',
  'timeline.time.unknown': '时间未知',
  'timeline.meta.timeSeq': '{time} · seq {seq}',
  'timeline.meta.baseSeq': '基于 seq {seq}',
} as const

const en: Record<keyof typeof zh, string> = {
  'common.language': 'Language',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.refresh': 'Refresh',
  'common.logout': 'Log out',
  'common.loading': 'Loading...',
  'nav.settings': 'Settings & diagnostics',
  'auth.restoreSession': 'Restoring secure session…',
  'auth.refreshSession': 'Refreshing Gateway session…',
  'auth.signingOut': 'Signing out securely…',
  'auth.recoveryTitle': 'Unable to restore Gateway session',
  'auth.recoverySubtitle': 'Protected pages are not available yet',
  'auth.retryRecovery': 'Retry recovery',
  'auth.recoveryVerify': 'Unable to verify the Gateway session. Check the network and try again.',
  'auth.localSession': 'Unable to read the secure local session. Try again.',
  'auth.devCredential': 'Unable to verify development credentials. Check the network and try again.',
  'auth.refreshFailed': 'Gateway session refresh failed. Check the network and try again.',
  'auth.clearSession': 'Unable to clear the secure local session. Try again.',
  'auth.clearRevoked': 'Unable to clear the revoked device identity. Try again.',
  'login.title': 'Continue your Session from your phone',
  'login.copy': 'Connect securely to the Harness Runtime on your PC. Models, tools, and files still run only on your computer.',
  'login.account': 'Administrator account',
  'login.password': 'Password',
  'login.passwordPlaceholder': 'Enter administrator password',
  'login.signingIn': 'Signing in…',
  'login.restoring': 'Restoring configuration…',
  'login.submit': 'Log in and connect',
  'login.noRegistration': 'Gateway does not provide registration. The password is used only for this login; access and refresh tokens are stored in system secure storage.',
  'login.gatewayOrigin': 'Gateway origin',
  'login.adminPassword': 'Administrator password',
  'login.devTokenTitle': 'Debug token compatibility entry',
  'login.devTokenCopy': 'Visible only in explicit development builds; not part of the formal login or acceptance path.',
  'login.useDevToken': 'Connect with development token',
  'login.devTokenPlaceholder': 'Short-lived access token',
  'sessions.subtitle': 'Continue Harness work from your phone',
  'sessions.openSettings': 'Open settings and diagnostics',
  'sessions.retrying': 'Retrying…',
  'sessions.retryPcStatus': 'Retry PC status',
  'sessions.loading': 'Reading Sessions…',
  'sessions.attention': 'Needs attention',
  'sessions.recent': 'Recent Sessions',
  'sessions.emptyTitle': 'No Sessions yet',
  'sessions.emptyCopy': 'Sessions authorized on your PC will appear here automatically.',
  'sessions.refreshing': 'Refreshing…',
  'sessions.refreshSync': 'Refresh sync',
  'sessions.footer': 'Full device and Runtime details are available in settings and diagnostics.',
  'sessions.sync.replaying': 'Replaying history: Session {session}, starting at seq {seq}',
  'sessions.sync.recovered': 'History replay completed; live sync is restored.',
  'sessions.sync.failed': 'Sync failed: {code}',
  'sessions.sync.failedGeneric': 'Sync failed; check the network and credentials.',
  'sessions.inventory.devicesFailed': 'Unable to read devices: {code}',
  'sessions.inventory.runtimesFailed': 'Unable to read runtimes: {code}',
  'sessions.inventory.multipleFailed': 'Unable to read devices: {devices}; unable to read runtimes: {runtimes}',
  'settings.subtitle': 'Account, connection, and local data',
  'settings.account': 'Account',
  'settings.diagnostics': 'Connection diagnostics',
  'settings.privacy': 'Privacy & management',
  'settings.retrying': 'Refreshing…',
  'settings.refresh': 'Refresh diagnostics',
  'settings.issue': 'The last sync did not complete successfully. Server error details are hidden; retry diagnostics.',
  'settings.localDataLabel': 'Local data',
  'settings.localDataValue': 'Only data needed to continue work is saved',
  'settings.localDataDetail': 'Secure sessions are held in system secure storage; confirmed Session projections stay on this device.',
  'settings.gatewayLabel': 'Gateway management',
  'settings.gatewayValue': 'Management responsibilities stay separate',
  'settings.gatewayDetail': 'Device revocation, Tokens, and PC pairing remain managed by Gateway Web.',
  'status.connection.idle': 'Not connected',
  'status.connection.connecting': 'Connecting',
  'status.connection.connected': 'Connected',
  'status.connection.reconnecting': 'Reconnecting',
  'status.connection.closed': 'Offline',
  'status.connection.error': 'Connection error',
  'status.connection.unknown': 'Unknown connection state',
  'status.session.idle': 'Idle',
  'status.session.running': 'Running',
  'status.session.waiting': 'Waiting',
  'status.session.completed': 'Completed',
  'status.session.failed': 'Failed',
  'status.session.cancelled': 'Cancelled',
  'status.session.offline': 'PC offline',
  'status.session.unknown': 'Unknown Session state',
  'command.status.received': 'Received',
  'command.status.authorized': 'Authorized',
  'command.status.queued': 'Queued',
  'command.status.executing': 'Executing',
  'command.status.completed': 'Completed',
  'command.status.rejected': 'Rejected',
  'command.status.expired': 'Expired',
  'command.status.unknown': 'Unknown status',
  'session.activity.unknown': 'Activity time unknown',
  'session.activity.justNow': 'Just now',
  'session.activity.minutesAgo': '{count} minutes ago',
  'session.activity.hoursAgo': '{count} hours ago',
  'session.activity.daysAgo': '{count} days ago',
  'session.summary.awaitingApproval': 'Approval needed: {tool}',
  'session.summary.syncingHistory': 'Syncing conversation history',
  'session.summary.empty': 'No conversation summary',
  'session.badge.attention': 'Needs attention',
  'session.accessibility.openConversation': 'Open this Session conversation',
  'connection.notice.connecting': 'Connecting to Gateway; showing local cache.',
  'connection.notice.reconnecting': 'Gateway connection interrupted; reconnecting and showing local cache.',
  'connection.notice.offline': 'Gateway is offline; showing local cache.',
  'pc.title.online': '{device} · Online',
  'pc.detail.online': '{profile} · Heartbeat {heartbeat} · Gateway {gateway}',
  'pc.title.offline': '{device} · Offline',
  'pc.detail.offline': '{platform} · Runtime {runtimeCount} · Gateway {gateway}',
  'pc.title.unpaired': 'No PC connected',
  'pc.detail.gatewayReady': 'Gateway connected, but no paired PC Runtime',
  'pc.detail.gatewayState': 'Gateway {gateway}',
  'pc.heartbeat.unknown': 'Unknown',
  'pc.heartbeat.justNow': 'Just now',
  'pc.heartbeat.minutesAgo': '{count} minutes ago',
  'pc.heartbeat.hoursAgo': '{count} hours ago',
  'pc.gateway.connected': 'Connected',
  'pc.gateway.connecting': 'Connecting',
  'pc.gateway.reconnecting': 'Reconnecting',
  'pc.gateway.offline': 'Offline',
  'settings.row.account': 'Current account',
  'settings.row.device': 'Current device',
  'settings.row.scopes': 'Granted scopes',
  'settings.row.scopesEmpty': 'No scope summary provided',
  'settings.row.gateway': 'Gateway',
  'settings.row.runtime': 'PC Runtime',
  'settings.row.stream': 'Sync stream',
  'settings.row.streamDetailNoReplay': '{count} Sessions · No history replay',
  'settings.row.streamDetailReplaying': '{sessions} Sessions · {count} replaying',
  'settings.row.cursorRecent': 'Most recent Session cursor',
  'settings.row.cursorCurrent': 'Current Session cursor',
  'settings.row.cursorEmpty': 'No sync cursor',
  'settings.row.cursorSeq': 'seq {seq}',
  'settings.row.cursorWaiting': 'Waiting for PC to publish Session',
  'settings.row.cursorSynced': 'Confirmed history is up to date',
  'settings.row.cursorReplaying': 'Replaying confirmed history',
  'settings.row.development': 'Development credentials',
  'settings.row.unavailable': 'Unavailable',
  'conversation.header': 'Conversation',
  'conversation.session': 'Session',
  'conversation.openSessions': 'Open Session list',
  'conversation.openSettings': 'Open settings and diagnostics',
  'conversation.historySynced': 'History synced',
  'conversation.historyReplaying': 'Replaying history',
  'conversation.offlineBanner': 'PC is offline. Confirmed history is view-only until the Runtime reconnects.',
  'conversation.replayingBanner': 'Replaying confirmed history from Gateway; live events resume when replay completes.',
  'conversation.emptyRestoringTitle': 'Reading Conversation',
  'conversation.emptyRestoringCopy': 'Restoring the local snapshot.',
  'conversation.emptyTitle': 'No Conversation content',
  'conversation.emptyCopy': 'New messages and events from your PC will appear here.',
  'conversation.emptyHistoryTitle': 'Syncing history',
  'conversation.emptyHistoryCopy': 'Replaying confirmed history from Gateway.',
  'conversation.jumpBottom': '↓ Back to bottom',
  'conversation.jumpBottomA11y': 'Back to the bottom of Conversation',
  'conversation.activityHint': 'View this turn’s tool and status summary',
  'conversation.activityCollapse': 'Collapse',
  'conversation.activityExpand': 'Expand',
  'conversation.activitySafe': 'Safe summary only',
  'conversation.activityDetails': 'Tap to view execution details',
  'conversation.streaming': 'Generating',
  'conversation.generated': 'Generating',
  'composer.dismiss': 'Close command status and continue editing',
  'composer.inputA11y': 'Send a message to PC Harness',
  'composer.inputPlaceholder': 'Send a message to Harness on your PC…',
  'composer.stopping': 'Stopping task',
  'composer.stop': 'Stop current task',
  'composer.send': 'Send message',
  'composer.state.loading': 'Preparing controls',
  'composer.state.replaying': 'Replaying history',
  'composer.state.offline': 'PC Runtime offline',
  'composer.state.ready': 'Executed by PC Harness',
  'composer.state.submitting': 'Sending to PC Harness',
  'composer.state.queued': 'Queued',
  'composer.state.executing': 'Executing',
  'composer.state.stopping': 'Stopping',
  'composer.state.unknown': 'Unknown command state',
  'composer.state.error': 'Command state error',
  'approval.state.pending': 'Approval required',
  'approval.state.submitting': 'Submitting approval decision',
  'approval.state.queued': 'Approval decision submitted',
  'approval.state.executing': 'Processing approval decision',
  'approval.state.confirming': 'Approval decision submitted',
  'approval.state.stale': 'Approval page is stale',
  'approval.state.unknown': 'Unknown approval command state',
  'approval.state.offline': 'PC Runtime offline',
  'approval.state.already-decided': 'Handled by another device',
  'approval.state.error': 'Approval state error',
  'conversation.notice.snapshotMissing': 'This Session snapshot has not arrived locally yet. Try again shortly.',
  'conversation.notice.historyWaiting': 'History is still replaying. Wait until the Session catches up before sending.',
  'conversation.notice.runtimeOffline': 'PC Runtime is offline; the command was not submitted.',
  'conversation.notice.commandAcceptedQueryFailed': 'Gateway accepted the command, but status lookup failed; refresh only queries the original command.',
  'conversation.notice.approvalDecided': 'This approval was handled by another device.',
  'conversation.notice.deliveryUnknown': 'Unable to confirm whether Gateway received the command; retry reuses the same command ID.',
  'conversation.notice.recoveryFailed': 'Unable to recover command status; refresh only queries the original command and does not execute it again.',
  'conversation.notice.approvalGone': 'This approval is no longer pending. Check the latest Session events.',
  'conversation.notice.controlsPreparing': 'Waiting for the local Session snapshot.',
  'conversation.notice.historyCatchup': 'Sending is paused until history catches up, avoiding execution from stale state.',
  'conversation.notice.confirmedHistoryOnly': 'Confirmed history remains viewable; continue when the connection recovers.',
  'conversation.notice.historySyncedCanResubmit': 'History is caught up; you can submit again.',
  'conversation.notice.checkConnection': 'Check the connection and try again.',
  'conversation.notice.noAutoExecute': 'The command will not execute automatically again.',
  'conversation.notice.queryOnly': 'Only the original command is queried; it is not executed again.',
  'conversation.notice.waitGateway': 'Waiting for Gateway to accept the command.',
  'conversation.notice.waitConnector': 'Waiting for PC Connector to execute.',
  'conversation.notice.eventSource': 'The actual result comes from timeline events.',
  'conversation.notice.sessionEventSource': 'Session status changes only from real events.',
  'conversation.notice.waitHarnessEnd': 'Waiting for PC Harness to return the real completion event.',
  'conversation.notice.commandNotSubmitted': 'Command not submitted',
  'conversation.notice.commandSubmitFailed': 'Command submission failed',
  'conversation.notice.commandStatusUnknown': 'Command status not confirmed',
  'conversation.notice.commandFinished': 'Command finished: {status}{reason}',
  'conversation.notice.commandRejected': 'Gateway rejected the command: {code}',
  'conversation.notice.commandRecoveryFailed': 'Unable to recover command state: {code}',
  'conversation.notice.commandStillActive': 'The command has not reached a terminal state; refresh only checks the original command and will not execute it again.',
  'conversation.notice.unknownRetryGeneric': 'Check the timeline before deciding whether to resubmit; the system will not replay it automatically.',
  'conversation.notice.resubmitAfterSession': 'Confirm the Session state before resubmitting.',
  'conversation.notice.historyBeforeApproval': 'Decisions are unavailable until history catches up.',
  'conversation.notice.approvalReconnect': 'This approval is still pending; reconnect before submitting a decision.',
  'conversation.notice.approvalEventSync': 'Waiting for the real approval event to sync to the timeline.',
  'conversation.notice.waitGatewayApproval': 'Waiting for Gateway to accept the approval decision.',
  'conversation.notice.noDuplicateApproval': 'Only the original command will be queried; the decision will not be repeated.',
  'conversation.notice.noAutoApproval': 'The approval decision will not be submitted automatically again.',
  'conversation.notice.waitHarnessApproval': 'Waiting for PC Harness to process the approval command.',
  'conversation.notice.approvalEventResult': 'The approval result is determined by the real Session event.',
  'conversation.notice.waitHarnessApprovalEvent': 'Waiting for PC Harness to return the real approval event.',
  'conversation.notice.approvalScope': 'Only this request is allowed; verify the full parameters in PC Harness.',
  'composer.detail.gatewayExecution': 'Message content is executed by PC Harness, not Gateway.',
  'conversation.reason.runtimeOffline': ' (PC offline)',
  'conversation.reason.deviceRevoked': ' (Device revoked)',
  'conversation.reason.approvalDecided': ' (Handled by another device)',
  'conversation.reason.generic': ' ({reason})',
  'approval.outcome.allowOnce': 'Allow once',
  'approval.outcome.reject': 'Reject',
  'approval.outcome.decision': 'Approval decision',
  'approval.notice.unknownRetry': 'Check the timeline before deciding whether to retry “{outcome}”; the system will not replay it automatically.',
  'approval.notice.pendingResubmit': 'This approval is still pending; you can submit “{outcome}” again.',
  'approval.notice.staleResubmit': 'State is caught up; you can submit again.',
  'approval.notice.staleWaiting': 'Waiting to sync through seq {seq}.',
  'approval.eyebrow': 'PC HARNESS requested a tool',
  'approval.safety': 'Only a safe summary is shown on mobile. Review the full scope on your PC before approving.',
  'approval.reject': 'Reject',
  'approval.allowOnce': 'Allow once',
  'copy.idle': 'Copy',
  'copy.copied': 'Copied',
  'copy.failed': 'Copy failed',
  'copy.reply': 'Reply',
  'copy.code': 'Code',
  'drawer.title': 'Sessions',
  'drawer.subtitle': 'Sorted by attention and recent activity',
  'drawer.close': 'Close Session drawer',
  'drawer.empty': 'No synced Sessions',
  'drawer.openDirectory': 'Back to Session home',
  'nav.back': 'Back',
  'nav.settingsLabel': 'Settings',
  'nav.placeholder': 'Main navigation placeholder',
  'splash.subtitle': 'Secure Gateway session',
  'markdown.codeFallback': 'Code',
  'markdown.openLink': 'Open {href}',
  'timeline.activity.summary': 'Activity · tools {tools} · approvals {approvals} · statuses {statuses}',
  'timeline.command.remoteMessage': 'Remote message submitted',
  'timeline.command.stopRequest': 'Stop request submitted',
  'timeline.command.approvalResponse': 'Approval response submitted',
  'timeline.command.status': 'Command status: {status}',
  'timeline.command.detail': 'Command content and credentials are not written to this timeline summary.',
  'timeline.event.toolCall': 'Tool call',
  'timeline.event.toolResult': 'Tool result',
  'timeline.event.approvalPending': 'Approval pending',
  'timeline.event.approvalUpdated': 'Approval updated',
  'timeline.event.harnessStart': 'Harness started processing',
  'timeline.event.harnessEnd': 'Harness turn ended',
  'timeline.event.stepStart': 'Step started',
  'timeline.event.stepEnd': 'Step completed',
  'timeline.event.commandStatus': 'Remote command status',
  'timeline.event.sessionStatus': 'Session status update',
  'timeline.detail.toolCall': 'Tool arguments, paths, and environment details are hidden.',
  'timeline.detail.toolResult': 'Tool output and result content are hidden.',
  'timeline.detail.unknown': 'This client preserves the event position and type but does not expand unknown payloads.',
  'timeline.detail.generic': 'Detailed payloads are not shown on mobile.',
  'timeline.summary.messageUnavailable': 'Message content unavailable',
  'timeline.summary.toolCall': 'Tool call: {tool} (arguments hidden)',
  'timeline.summary.toolCallUnknown': 'Tool call sent (arguments hidden)',
  'timeline.summary.toolResult': 'Tool result received (content hidden)',
  'timeline.summary.approvalNeeded': 'Approval needed: {tool}',
  'timeline.summary.approvalNeededUnknown': 'Tool approval needed',
  'timeline.summary.approvalConfirmed': 'Approval result confirmed by PC Harness',
  'timeline.summary.turnStarted': 'PC Harness started processing this request',
  'timeline.summary.turnCompleted': 'Request completed',
  'timeline.summary.turnAborted': 'Request stopped',
  'timeline.summary.turnEnded': 'Request ended',
  'timeline.summary.statusUpdated': 'Status updated',
  'timeline.summary.status': 'Status: {status}',
  'timeline.summary.unknownEvent': 'Unknown event retained; its payload is not expanded on this client.',
  'timeline.time.unknown': 'Time unknown',
  'timeline.meta.timeSeq': '{time} · seq {seq}',
  'timeline.meta.baseSeq': 'Based on seq {seq}',
}

assertDictionaryParity(zh, en, 'zh', 'en')

export type MobileLocale = 'zh' | 'en'
export type MobileMessageKey = keyof typeof zh
export { message }
export type { MobileMessage }

export function resolveMessage(
  translator: (key: MobileMessageKey, params?: MessageParams) => string,
  value: MobileMessage | string,
): string {
  if (typeof value === 'string') return value
  if (value.params === undefined) return translator(value.key as MobileMessageKey)
  const params = Object.fromEntries(
    Object.entries(value.params).map(([key, param]) => [key, resolveMessageParam(translator, param)]),
  )
  return translator(value.key as MobileMessageKey, params)
}

function resolveMessageParam(
  translator: (key: MobileMessageKey, params?: MessageParams) => string,
  value: unknown,
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  if (!('key' in value) || typeof value.key !== 'string') return value
  return translator(value.key as MobileMessageKey, 'params' in value && typeof value.params === 'object' && value.params !== null
    ? value.params as MessageParams
    : undefined)
}

const LEGACY_NOTICE_KEYS: Readonly<Record<string, MobileMessageKey>> = {
  '本地尚未收到该 Session 的快照，请稍后重试。': 'conversation.notice.snapshotMissing',
  '历史仍在补发，请等待 Session 状态追平后再发送。': 'conversation.notice.historyWaiting',
  'PC Runtime 离线，命令没有提交。': 'conversation.notice.runtimeOffline',
  '命令已被 Gateway 接受，但状态查询失败；刷新只会查询原命令。': 'conversation.notice.commandAcceptedQueryFailed',
  '该审批已由其他设备处理。': 'conversation.notice.approvalDecided',
  '无法确认 Gateway 是否收到命令；重试将复用同一命令 ID。': 'conversation.notice.deliveryUnknown',
  '无法恢复命令状态；刷新只会查询原命令，不会重新执行。': 'conversation.notice.recoveryFailed',
  '该审批已不再待处理，请查看最新 Session 事件。': 'conversation.notice.approvalGone',
  '等待本地 Session 快照。': 'conversation.notice.controlsPreparing',
  '历史追平前暂停发送，避免基于过期状态执行。': 'conversation.notice.historyCatchup',
  '已确认历史仍可查看，连接恢复后可继续。': 'conversation.notice.confirmedHistoryOnly',
  '历史已追平，可以重新提交。': 'conversation.notice.historySyncedCanResubmit',
  '请检查连接后重试。': 'conversation.notice.checkConnection',
  '不会自动重新执行命令。': 'conversation.notice.noAutoExecute',
  '只查询原命令，不会重新执行。': 'conversation.notice.queryOnly',
  '等待 Gateway 接受命令。': 'conversation.notice.waitGateway',
  '等待 PC Connector 执行。': 'conversation.notice.waitConnector',
  '实际结果以时间线事件为准。': 'conversation.notice.eventSource',
  'Session 状态只会由真实事件更新。': 'conversation.notice.sessionEventSource',
  '等待 PC Harness 返回真实结束事件。': 'conversation.notice.waitHarnessEnd',
  '命令仍未进入终态；刷新只查询原命令，不会重新执行。': 'conversation.notice.commandStillActive',
  '请先检查时间线，再决定是否重新提交；系统不会自动重放。': 'conversation.notice.unknownRetryGeneric',
  '可以在确认 Session 状态后重新提交。': 'conversation.notice.resubmitAfterSession',
  '历史追平前不能作出决定。': 'conversation.notice.historyBeforeApproval',
  '审批仍待处理，连接恢复后才能提交决定。': 'conversation.notice.approvalReconnect',
  '正在等待真实审批事件同步到时间线。': 'conversation.notice.approvalEventSync',
  '等待 Gateway 接受审批决定。': 'conversation.notice.waitGatewayApproval',
  '只查询原命令，不会重复决定。': 'conversation.notice.noDuplicateApproval',
  '不会自动重复提交审批决定。': 'conversation.notice.noAutoApproval',
  '等待 PC Harness 处理审批命令。': 'conversation.notice.waitHarnessApproval',
  '审批结果以真实 Session 事件为准。': 'conversation.notice.approvalEventResult',
  '等待 PC Harness 返回真实审批事件。': 'conversation.notice.waitHarnessApprovalEvent',
  '只允许本次请求，完整参数请在 PC Harness 中核对。': 'conversation.notice.approvalScope',
  '发送内容不会在 Gateway 执行。': 'composer.detail.gatewayExecution',
}

export function translateLegacyNotice(
  translator: (key: MobileMessageKey, params?: MessageParams) => string,
  value: string,
): string {
  const commandFinished = value.match(/^命令结束：(.+?)(（(.+)）)?$/)
  if (commandFinished !== null) {
    const status = commandFinished[1] ?? ''
    const reason = commandFinished[3]
    const statusKey = status === '已接收' ? 'command.status.received'
      : status === '已授权' ? 'command.status.authorized'
        : status === '已排队' ? 'command.status.queued'
          : status === '执行中' ? 'command.status.executing'
            : status === '已完成' ? 'command.status.completed'
              : status === '已拒绝' ? 'command.status.rejected'
                : status === '已过期' ? 'command.status.expired'
                  : 'command.status.unknown'
    const reasonText = reason === undefined ? ''
      : reason === 'PC 离线' ? translator('conversation.reason.runtimeOffline')
        : reason === '设备已撤销' ? translator('conversation.reason.deviceRevoked')
          : reason === '已由其他设备处理' ? translator('conversation.reason.approvalDecided')
            : translator('conversation.reason.generic', { reason })
    return translator('conversation.notice.commandFinished', { reason: reasonText, status: translator(statusKey) })
  }
  const unknownRetry = value.match(/^请先检查时间线，再决定是否重试“(.+)”；系统不会自动重放。$/)
  if (unknownRetry !== null) return translator('approval.notice.unknownRetry', { outcome: translateApprovalOutcome(translator, unknownRetry[1] ?? '') })
  const pendingResubmit = value.match(/^当前审批仍待处理，可以重新提交“(.+)”。$/)
  if (pendingResubmit !== null) return translator('approval.notice.pendingResubmit', { outcome: translateApprovalOutcome(translator, pendingResubmit[1] ?? '') })
  if (value === '状态已追平，可以重新提交。') return translator('approval.notice.staleResubmit')
  const staleWaiting = value.match(/^正在等待同步到 seq (.+)。$/)
  if (staleWaiting !== null) return translator('approval.notice.staleWaiting', { seq: staleWaiting[1] })
  const rejected = value.match(/^Gateway 拒绝命令：(.+)$/)
  if (rejected !== null) return translator('conversation.notice.commandRejected', { code: rejected[1] })
  const recoveryFailed = value.match(/^无法恢复命令状态：(.+)$/)
  if (recoveryFailed !== null) return translator('conversation.notice.commandRecoveryFailed', { code: recoveryFailed[1] })
  const key = LEGACY_NOTICE_KEYS[value]
  return key === undefined ? value : translator(key)
}

function translateApprovalOutcome(translator: (key: MobileMessageKey, params?: MessageParams) => string, value: string): string {
  if (value === '允许一次') return translator('approval.outcome.allowOnce')
  if (value === '拒绝') return translator('approval.outcome.reject')
  return translator('approval.outcome.decision')
}

interface I18nContextValue {
  readonly locale: MobileLocale
  readonly setLocale: (locale: MobileLocale) => void
  readonly t: (key: MobileMessageKey, params?: MessageParams) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

function detectedLocale(): MobileLocale {
  const systemLocale = typeof Intl === 'undefined' ? undefined : Intl.DateTimeFormat().resolvedOptions().locale
  return resolveLocale({ explicit: undefined, candidates: systemLocale === undefined ? [] : [systemLocale], fallbackLocale: 'zh', locales: DEFAULT_LOCALES }) as MobileLocale
}

export function I18nProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<MobileLocale>(detectedLocale)
  const [ready, setReady] = useState(false)
  const translator = useMemo(() => createTranslator({ locale: () => locale, fallbackLocale: 'zh', dictionaries: { zh, en } }), [locale])

  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(LOCALE_STORAGE_KEY).then(stored => {
      if (!active) return
      if (stored === 'zh' || stored === 'en') setLocaleState(stored)
      setReady(true)
    }).catch(() => {
      if (active) setReady(true)
    })
    return () => { active = false }
  }, [])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: next => {
      setLocaleState(next)
      void SecureStore.setItemAsync(LOCALE_STORAGE_KEY, next)
    },
    t: (key, params) => translator(key, params),
  }), [locale, translator])

  if (!ready) return <View style={styles.loading}><Text style={styles.loadingText}>{zh['auth.restoreSession']}</Text></View>
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (context === undefined) throw new Error('useI18n must be rendered inside I18nProvider')
  return context
}

export function connectionStatusKey(state: string): MobileMessageKey {
  return state === 'idle' || state === 'connecting' || state === 'connected' || state === 'reconnecting' || state === 'closed' || state === 'error'
    ? `status.connection.${state}` as MobileMessageKey
    : 'status.connection.unknown'
}

export function sessionStatusKey(status: string): MobileMessageKey {
  return status === 'idle' || status === 'running' || status === 'waiting' || status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'offline'
    ? `status.session.${status}` as MobileMessageKey
    : 'status.session.unknown'
}

export function commandStatusKey(status: string): MobileMessageKey {
  return status === 'received' || status === 'authorized' || status === 'queued' || status === 'executing'
    || status === 'completed' || status === 'rejected' || status === 'expired' || status === 'unknown'
    ? `command.status.${status}` as MobileMessageKey
    : 'command.status.unknown'
}

export function LanguageSelect(): React.JSX.Element {
  const { locale, setLocale, t } = useI18n()
  return (
    <View style={styles.languageRow}>
      <Text style={styles.languageLabel}>{t('common.language')}</Text>
      <View style={styles.languageOptions}>
        {(['zh', 'en'] as const).map(option => (
          <Pressable
            accessibilityLabel={option === 'zh' ? '中文' : 'English'}
            accessibilityRole="button"
            accessibilityState={{ selected: locale === option }}
            key={option}
            onPress={() => setLocale(option)}
            style={[styles.languageOption, locale === option && styles.languageOptionActive]}
          >
            <Text style={[styles.languageOptionText, locale === option && styles.languageOptionTextActive]}>{option === 'zh' ? '中文' : 'English'}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

export { LOCALE_STORAGE_KEY }

const styles = StyleSheet.create({
  loading: { alignItems: 'center', backgroundColor: mobileTheme.color.canvas, flex: 1, justifyContent: 'center', padding: mobileTheme.spacing.lg },
  loadingText: { color: mobileTheme.color.textSecondary, fontSize: mobileTheme.typography.body },
  languageRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: mobileTheme.spacing.xs },
  languageLabel: { color: mobileTheme.color.textSecondary, fontSize: mobileTheme.typography.caption, fontWeight: '700' },
  languageOptions: { backgroundColor: mobileTheme.color.surfaceMuted, borderRadius: mobileTheme.radius.md, flexDirection: 'row', gap: 2, padding: 3 },
  languageOption: { borderRadius: mobileTheme.radius.sm, justifyContent: 'center', minHeight: 38, paddingHorizontal: mobileTheme.spacing.sm },
  languageOptionActive: { backgroundColor: mobileTheme.color.brand, borderColor: mobileTheme.color.brand },
  languageOptionText: { color: mobileTheme.color.text, fontSize: mobileTheme.typography.caption, fontWeight: '600' },
  languageOptionTextActive: { color: mobileTheme.color.surface },
})
