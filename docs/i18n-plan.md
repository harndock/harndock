# Gateway Web 与 Mobile 国际化任务计划

版本：1.0  
状态：执行中（M0 基础能力已落地）
更新时间：2026-08-29

## 1. 文档目的

本文件把 Gateway Web 管理台和 Mobile 国际化拆成可执行任务，作为两个仓库的共同实施清单：

- 公共仓库：`<harndock-repo>`
- Gateway 服务端与管理台：`<dsh-sync-server-repo>`

本计划不改写 Harness 上游 Web GUI。`vendor/deepseek-harness` 已经有独立的 `@deepseek-ai/dsh-client-locale`，支持 `zh/en` 和 Host-backed preference；它作为现有实现参考，不纳入本计划的重构范围。

本计划覆盖：

- `dsh-sync-server/apps/gateway-console` 独立 Gateway 管理台；
- `dsh-gui/apps/mobile` React Native 移动端；
- 两端共用的 locale ID、翻译器契约、错误码/状态语义和格式化规则。

本计划暂不覆盖：

- 后端日志、数据库字段、协议 payload 的翻译；
- 用户输入、设备名、Session 名称、模型输出、Scope、Runtime profile 和 ID；
- 文档站、应用商店描述和营销页面；
- Desktop Bootstrap 壳的全面迁移。它可以在后续复用同一个核心包。

## 2. 当前基线

| 表面 | 当前情况 | 主要问题 |
| --- | --- | --- |
| Harness Web 工作台 | 已有 locale 插件和语言设置 | 不能直接复用于 React Native 或独立 Gateway Console |
| Gateway Console | 文案集中写在 `apps/gateway-console/src/App.tsx` | 登录、导航、五个管理页面、弹窗、状态和错误均为内联中文；时间固定为 `zh-CN` |
| Mobile | 没有 locale provider 或词典 | Screen、Component、presentation/model 分散返回中文；中英文混杂；无语言持久化 |
| Gateway API | 已有稳定 `error.code` | 前端部分场景直接展示服务端 message，存在语言穿透 |

关键代码入口：

- Gateway 路由和导航：`<dsh-sync-server-repo>/apps/gateway-console/src/App.tsx:51`
- Gateway 状态和时间格式：`<dsh-sync-server-repo>/apps/gateway-console/src/App.tsx:840`
- Mobile 设置入口：[apps/mobile/src/screens/SettingsScreen.tsx](../apps/mobile/src/screens/SettingsScreen.tsx)
- Mobile 审批状态模型：[apps/mobile/src/features/conversation/approval-model.ts](../apps/mobile/src/features/conversation/approval-model.ts)
- Mobile 状态标签：[apps/mobile/src/sync/status-labels.ts](../apps/mobile/src/sync/status-labels.ts)

## 3. 已确定的产品与技术决策

1. 首发语言为简体中文和英文。
2. 内部 locale ID 使用 `zh`、`en`，格式化 locale 使用 `zh-CN`、`en-US`。
3. 默认语言按浏览器/系统语言的 primary subtag 探测；无法匹配时回退 `zh`。
4. 用户手动选择后持久化；两端首版不增加账号同步字段。
   - Gateway Console：`localStorage`，key 为 `dsh.gateway-console.locale.v1`。
   - Mobile：复用现有设置存储边界，建议使用 SecureStore 的非敏感版本化 key `ui.locale.v1`。
5. 翻译查找顺序为：当前 locale → 中文 fallback → key；开发环境对缺失 key 告警。
6. API 保持语言无关。前端按稳定 `error.code` 映射文案，未知错误才显示经过处理的服务端 message。
7. 业务 Model 返回语义状态、translation key 和参数，不返回已经翻译的句子；翻译发生在渲染边界。
8. 所有词典使用类型约束，`zh` 和 `en` 必须拥有相同 key 集合。
9. 不采用 `@deepseek-ai/dsh-client-locale` 作为 Mobile 运行时依赖，因为它依赖 Cordis、Web slot 和 Host settings；只复用其 `zh/en`、fallback 和 namespace 思路。

## 4. 词典命名空间

共享核心词典只放跨产品通用词，不放具体页面长文案。业务词典由各应用拥有。

| 应用 | 命名空间 | 内容 |
| --- | --- | --- |
| shared | `common` | 确定、取消、关闭、保存、重试、加载、复制、未知 |
| Gateway Console | `gateway.auth`、`gateway.nav`、`gateway.overview` | 登录、导航、概览和会话状态 |
| Gateway Console | `gateway.devices`、`gateway.pairings`、`gateway.tokens` | 设备、Runtime、配对码、Token |
| Gateway Console | `gateway.diagnostics`、`gateway.account`、`gateway.modal` | 诊断、账号隐私和确认弹窗 |
| Gateway Console | `status`、`error`、`format` | 跨页面状态、错误码、日期/数量格式 |
| Mobile | `mobile.auth`、`mobile.sessions`、`mobile.settings` | 登录、Session 首页、设置诊断 |
| Mobile | `mobile.conversation`、`mobile.composer`、`mobile.approval` | 时间线、Composer、审批接管 |
| Mobile | `mobile.status`、`mobile.error`、`mobile.accessibility` | 状态、错误、读屏和操作提示 |

示例：

```ts
t('mobile.approval.status.runtimeOffline')
t('mobile.session.count', { count })
t('gateway.error.authenticationDenied')
t('format.lastHeartbeat', { value })
```

## 5. 任务清单

状态取值：`待执行`、`进行中`、`已完成`、`阻塞`、`不适用`。

| ID | 优先级 | 任务 | 依赖 | 主要产物与完成判定 | 状态 |
| --- | --- | --- | --- | --- | --- |
| I18N-00 | P0 | 双仓库文案与格式化审计 | 无 | [审计报告](i18n-audit.md) 已记录 UI 文案、状态函数、错误码、日期/数量格式和允许保留裸字符串的清单；确认 Gateway Console 与 Harness Web 的范围不混淆 | 已完成 |
| I18N-01 | P0 | 建立共享 `i18n-core` | I18N-00 | 新增纯 TS `packages/i18n-core`；提供 locale 探测、fallback、动态翻译器、插值、`Intl` 格式化和存储适配器；无 React/Expo/Cordis 依赖 | 已完成 |
| I18N-02 | P0 | 固定词典类型和翻译检查 | I18N-01 | 核心包提供 `assertDictionaryParity`；Gateway/Mobile 中英文 key parity 已接入 `check:i18n`，缺失 key 会在检查阶段失败 | 已完成 |
| I18N-03 | P0 | Gateway Console locale provider 与持久化 | I18N-01 | 已在 `apps/gateway-console/src/i18n` 建立 provider/hook；同步 `html.lang`；首次按浏览器语言，手动选择写入 `localStorage`；已补 provider 单测和浏览器验收 | 已完成 |
| I18N-04 | P0 | Gateway Console 登录、导航和公共文案迁移 | I18N-02、I18N-03 | 登录页、侧栏、页头、概览、设备、配对、Token、诊断和账号页面公共标题、操作按钮、加载/空态、重试、权限提示及状态徽标已接入 key；语言切换无需刷新页面 | 已完成 |
| I18N-05 | P0 | Gateway Console 业务页面与弹窗迁移 | I18N-04 | 创建/撤销/一次性展示弹窗的表单、确认、复制反馈和安全提示，以及页面 onboarding、隐私策略、诊断说明等业务长文案已接入 key；不翻译用户数据和协议标识 | 已完成 |
| I18N-06 | P0 | Gateway API 错误码展示策略 | I18N-05 | `errorMessage()` 按 `error.code` 本地化；未知错误安全显示；服务端 API 不增加语言分支 | 已完成 |
| I18N-07 | P1 | Gateway 日期、数量和状态格式化 | I18N-05 | `formatTimestamp` 已使用当前 locale，移除固定 `zh-CN`；概览/诊断数量和创建弹窗 TTL 已使用 `Intl.NumberFormat` | 已完成 |
| I18N-08 | P1 | Gateway Console 测试矩阵 | I18N-03 至 I18N-07 | Vitest 覆盖 zh/en、持久化、fallback、错误码、路由、弹窗和一次性凭据；关键 E2E 在两种语言下运行 | 待执行 |
| I18N-09 | P0 | Mobile provider、启动恢复和语言设置 | I18N-01、I18N-02 | `MobileApp` 根部挂载 provider；Splash 等待 SecureStore 语言恢复；Settings 增加语言选择；重启后保持选择；已补架构回归测试 | 已完成 |
| I18N-10 | P0 | Mobile Auth、Session 首页和设置迁移 | I18N-09 | 登录、恢复页、退出、Session 列表、Settings 语言入口、空/加载/重试态已接入中英文；保留品牌名和协议名 | 已完成 |
| I18N-11 | P0 | Mobile 业务 Model 语义化重构 | I18N-10 | 连接/Session 状态、目录摘要与相对时间、PC 连接条、Settings 诊断行、时间线事件摘要以及 Session 首页同步/库存诊断均提供 key/参数并由 UI 按 locale 渲染；Conversation 控制链的动态命令/审批详情已在渲染边界统一翻译；连接配置和兼容字段仍待纯 descriptor 收口 | 进行中 |
| I18N-12 | P0 | Mobile Conversation、审批和无障碍文案迁移 | I18N-11 | Conversation 空态、历史/离线提示、Composer、审批按钮、复制反馈、Session 抽屉、展开/收起、关键 accessibility label，以及时间线事件标题/摘要/安全详情和动态错误提示已接入当前 locale；模型层仍保留兼容中文字段，真实设备上的读屏与长文案验收留到 I18N-15 | 进行中 |
| I18N-13 | P1 | Mobile 日期、数量和长文案适配 | I18N-10 至 I18N-12 | Conversation 时间线通过 `formatTime`/`formatNumber` 按当前 locale 生成时间与 seq；Session 数量和状态已有 translator 路径；320/375/390px 英文无溢出验收留到 I18N-15 | 已完成 |
| I18N-14 | P1 | 双端静态检查和残留文案门禁 | I18N-04、I18N-12 | 新增 `scripts/verify-i18n.mjs` 并接入根 `check`：校验 Mobile/Gateway zh/en key parity，扫描 UI 目录中文裸文案；跳过词典、注释、测试 fixture 和兼容时间 helper；Gateway 仓库可用时自动纳入检查 | 已完成 |
| I18N-15 | P1 | 双端 E2E、视觉和无障碍验收 | I18N-08、I18N-13、I18N-14 | Gateway Console typecheck、Vitest（20/20）和 production build 已通过；Mobile typecheck、120 项回归和 locale 静态门禁已通过；Android 真机/模拟器矩阵、屏幕阅读器焦点与视觉截图仍需具备设备环境后执行 | 进行中 |
| I18N-16 | P1 | 发布与翻译审校 | I18N-15 | 已新增 [双端术语表](i18n-glossary.md) 与 [国际化发布清单](i18n-release-checklist.md)，包含首发术语、审校责任、缺失 key 监控、设备证据和回滚要求；人工签核与正式发布记录仍待完成 | 进行中 |

## 6. 任务实施细节

### 6.1 共享核心包

当前目录（后续可按模块增长拆分）：

```text
packages/i18n-core/
  src/index.ts
  tests/i18n-core.test.mjs
  package.json
  tsconfig.json
```

核心包只提供机制，不携带 Gateway 或 Mobile 页面词典。`harndock-sync-server` 先通过 `file:../dsh-gui/packages/i18n-core` 使用，后续若两个仓库需要独立发布，再抽成独立 npm 包。

数量文案统一使用参数，不在组件中拼接：

```ts
t('gateway.overview.activeDevices', { count })
```

底层使用 `Intl.PluralRules`，避免为未来增加语言重新修改组件逻辑。

### 6.2 Gateway Console

建议先将当前大文件按职责拆为 `AuthScreen`、`ConsoleShell`、`Overview`、`DeviceRuntimePage`、`PairingPage`、`TokenPage`、`DiagnosticsPage`、`AccountPage` 和各 Modal，再逐页替换文案。这样可以降低一次性迁移风险，也便于页面级语言测试。

服务端保持当前错误码契约。需要重点覆盖 `authentication_denied`、`rate_limited`、`service_unavailable`、`authorization_denied`、`not_found`、`invalid_request`、`stale_state`、`command_expired` 和 `approval_already_decided`。

### 6.3 Mobile

语言 provider 必须位于 AuthGate 和 Navigation 之上，保证登录页、Splash、恢复失败页和受保护页面使用同一套语言状态。语言切换后，所有基于 projection 的派生状态应重新渲染，但不应修改 projection、命令状态或服务端数据。

`approvalPanelState()` 和 `composerViewState()` 应保留稳定的 `mode`，将 `title`、`detail`、`retryLabel` 改为 key/参数；`describeEvent()` 也应返回结构化事件摘要，避免在数据层固化语言。

## 7. 验收标准

### 功能

- 新安装在中文系统默认显示中文，在英文系统默认显示英文。
- 用户手动切换语言后，刷新 Web 页面或重启 Mobile 仍保持选择。
- 切换语言不需要重新登录，不改变当前路由、Session、游标、命令或审批状态。
- 两端不出现同一页面中中英文混杂的 UI 固定文案。
- 缺失翻译不会渲染为空；开发环境可定位缺失 key。

### 数据与安全

- Token、配对码、refresh cookie、私钥和用户输入不进入翻译日志。
- 原始 API payload、数据库、Gateway 日志和同步协议不因语言切换改变。
- 未知后端错误不会泄漏未经处理的敏感字段。

### 版式与可访问性

- Gateway Console 在桌面和 620px 以下布局均无截断或溢出。
- Mobile 在 320、375、390、768 宽度下英文长文案不破坏布局。
- `html lang`、React Native accessibility label、hint、button label、placeholder 和状态播报均随语言变化。
- 日期、时间、数量和相对状态符合当前 locale。

## 8. 建议验证命令

在 `harndock`：

```bash
pnpm --filter @harndock/mobile typecheck
pnpm --filter @harndock/mobile test
pnpm check:docs
pnpm check:i18n
```

在 `harndock-sync-server`：

```bash
pnpm --filter @harndock/gateway-console typecheck
pnpm --filter @harndock/gateway-console test
pnpm build:gateway-console
pnpm test:gateway-console
```

完成 I18N-15 后，还需要补充真实 Gateway/Admin、Android Emulator 和屏幕阅读器证据；仅通过单元测试不能关闭国际化任务。

## 9. 里程碑

| 里程碑 | 包含任务 | 交付结果 |
| --- | --- | --- |
| M0 | I18N-00 至 I18N-02 | 词典规范、核心包和检查机制可用 |
| M1 | I18N-03 至 I18N-08 | Gateway Console zh/en 全量可用 |
| M2 | I18N-09 至 I18N-13 | Mobile 主流程和 Conversation zh/en 可用 |
| M3 | I18N-14 至 I18N-15 | 静态门禁、E2E、视觉和无障碍验收通过 |
| M4 | I18N-16 | 翻译审校完成并可灰度发布 |

建议每个里程碑独立合并和验证，不把两端所有文案迁移堆在一个提交中。

## 10. 待决事项

| 事项 | 最晚决策时间 | 当前建议 |
| --- | --- | --- |
| 是否未来支持日文等第三语言 | M0 | 核心包按可扩展 locale 设计，但首发只交付 zh/en |
| locale 偏好是否账号同步 | M1 | 首版本地持久化；等 Gateway 账号设置 API 稳定后再评估 |
| SecureStore 是否长期保存非敏感 UI 偏好 | M0 | Mobile 首版复用现有边界，后续可迁移到专用本地设置存储 |
| 翻译 key 的中文源语言还是英文源语言 | M0 | 延续 Harness 现有约定，以中文 key 集合作为完整性基准，key 本身使用英文语义命名 |
| 是否把 Desktop Bootstrap 纳入首发 | M2 | 当前不阻塞 Gateway/Mobile；后续复用 `i18n-core` |
