# Gateway Web 与 Mobile 国际化审计

版本：1.0  
更新时间：2026-08-28  
对应任务：I18N-00

## 1. 审计范围

本次审计覆盖两个应用源码，不扫描构建产物、`node_modules`、测试 fixture 中的预期 UI 文案或 Harness 上游实现：

- `<dsh-sync-server-repo>/apps/gateway-console`
- `<harndock-repo>/apps/mobile`

Harness Web 工作台单独已有 `@deepseek-ai/dsh-client-locale`，因此只记录为可复用参考，不把它和 Gateway Console 混为同一个前端。

## 2. 结论摘要

| 应用 | 审计结果 | 迁移判断 |
| --- | --- | --- |
| Gateway Console | `App.tsx` 同时承载路由、页面和弹窗；固定中文文案约 151 行；`formatTimestamp` 固定使用 `zh-CN` | 先拆分页面边界，再接入 provider，按登录 → 页面 → 弹窗迁移 |
| Mobile | UI 和业务 presentation/model 分散内联文案；中文文案约 305 行，另有约 228 行英文/品牌/协议相关文本 | 先接入 provider，再把业务 Model 改为语义状态 + translation key，最后迁移 Conversation/审批 |
| API/协议 | 已有稳定英文 `error.code` 和状态枚举；payload 不应随语言变化 | 保持协议语言无关，前端按 code 本地化 |

计数是 2026-08-28 使用 `rg` 对源码进行的基线扫描，用于估算迁移量，不作为运行时文案总数。动态拼接、服务端错误 message、用户数据和 Markdown 内容需要在迁移时重新分类。

## 3. Gateway Console 文案清单

### 3.1 入口和公共壳

文件：[apps/gateway-console/src/App.tsx](../../dsh-sync-server/apps/gateway-console/src/App.tsx)

- `routeLabels`：概览、设备与 Runtime、Desktop 配对、Access Token、连接诊断、账号与隐私。
- boot/auth：恢复会话、无法恢复、登录、管理员账号、密码、当前设备名称、Admin origin。
- Console shell：侧栏、管理页面无障碍标签、版本说明、账号菜单、退出。
- 公共状态：会话有效、刷新、刷新中、读取中、重试、暂无记录、时间未知。

迁移要求：这些文案进入 `gateway.nav`、`gateway.auth`、`common`、`status` 和 `format`，不可继续保留在 `routeLabels` 或 JSX 常量中。

### 3.2 业务页面

- 概览：当前账号、当前设备、活动设备、Runtime 在线数量、查看设备、查看状态、打开诊断。
- 设备/Runtime：设备列表、平台、连接状态、在线数量、撤销权限提示、当前设备撤销后的会话语义。
- Desktop 配对：创建配对码、一次性消费、过期、绑定设备、配对记录和安全边界。
- Access Token：Token 元数据、scope、TTL、一次性展示、复制、撤销和当前会话标记。
- 连接诊断：live/ready、延迟、最近心跳、恢复策略和隐私边界。
- 账号与隐私：账号信息、会话范围、Token 生命周期和本地存储说明。

建议 namespace：`gateway.overview`、`gateway.devices`、`gateway.pairings`、`gateway.tokens`、`gateway.diagnostics`、`gateway.account`。

### 3.3 弹窗和错误

- 创建/撤销设备、配对码和 Token 的确认弹窗。
- 一次性配对码/Token 展示、复制成功/失败和关闭提示。
- 错误码至少覆盖：`authentication_denied`、`rate_limited`、`service_unavailable`、`authorization_denied`、`not_found`、`invalid_request`、`stale_state`、`command_expired`、`approval_already_decided`。

未知错误只允许显示经过清理的服务端 message；不得把 token、cookie、请求体或内部堆栈写入 UI 或翻译诊断。

## 4. Mobile 文案清单

### 4.1 Screen 和基础组件

主要入口：

- [apps/mobile/src/screens/LoginScreen.tsx](../apps/mobile/src/screens/LoginScreen.tsx)
- [apps/mobile/src/screens/SessionsScreen.tsx](../apps/mobile/src/screens/SessionsScreen.tsx)
- [apps/mobile/src/screens/SessionScreen.tsx](../apps/mobile/src/screens/SessionScreen.tsx)
- [apps/mobile/src/screens/SettingsScreen.tsx](../apps/mobile/src/screens/SettingsScreen.tsx)
- [apps/mobile/src/screens/SplashScreen.tsx](../apps/mobile/src/screens/SplashScreen.tsx)
- [apps/mobile/src/components/EventTimeline.tsx](../apps/mobile/src/components/EventTimeline.tsx)
- [apps/mobile/src/components/ConversationComposer.tsx](../apps/mobile/src/components/ConversationComposer.tsx)
- [apps/mobile/src/components/ApprovalPanel.tsx](../apps/mobile/src/components/ApprovalPanel.tsx)
- [apps/mobile/src/components/MarkdownText.tsx](../apps/mobile/src/components/MarkdownText.tsx)

需要迁移的类别：登录/恢复、Session 导航、连接提示、加载/空态、设置诊断、Composer placeholder、发送/停止、复制反馈、工具摘要、展开/收起和 accessibility label/hint。

允许保留的文本：`Harndock Mobile`、`Gateway`、`PC Runtime`、`Session`、`Scope`、模型输出、用户输入和服务端返回的用户数据。

### 4.2 业务 Model 和格式化

- [apps/mobile/src/features/conversation/approval-model.ts](../apps/mobile/src/features/conversation/approval-model.ts)：审批 pending、offline、stale、unknown、already-decided、queued、executing 等状态的 title/detail/retry 文案。
- [apps/mobile/src/features/conversation/composer-model.ts](../apps/mobile/src/features/conversation/composer-model.ts)：loading、replaying、offline、stale、submission-error、unknown、queued、executing 等状态。
- [apps/mobile/src/sync/status-labels.ts](../apps/mobile/src/sync/status-labels.ts)：Gateway、Session、Command 状态标签。
- [apps/mobile/src/sync/event-summary.ts](../apps/mobile/src/sync/event-summary.ts)：工具调用、结果、审批、turn 和未知事件摘要。
- [apps/mobile/src/features/settings/settings-model.ts](../apps/mobile/src/features/settings/settings-model.ts)：账号、设备、scope、Gateway、Runtime、同步流和游标摘要。
- [apps/mobile/src/features/connection/presentation.ts](../apps/mobile/src/features/connection/presentation.ts)：心跳、库存错误和命令错误。

这些函数当前直接返回中文，必须改成结构化语义：`{ key, params }` 或稳定枚举；渲染层负责调用 `t()`。这样切换语言时，已存在的 projection 和 command state 也会即时更新。

## 5. 格式化和非文案边界

### 需要本地化

- Gateway `formatTimestamp` 当前固定 `zh-CN`。
- Mobile `toLocaleDateString()`、`toLocaleTimeString()` 当前使用运行环境默认语言，未绑定用户选择。
- 在线数量、Session 数量、TTL、seq 和相对状态描述。
- HTML `lang`、React Native accessibility label/hint/live region。

### 不需要翻译

- REST/WS 路径、错误码、命令类型、scope、platform、profile、runtime/device/session ID。
- Token、配对码、私钥、cookie、用户输入、Session 标题和模型/工具输出。
- 后端日志和数据库审计字段。它们保持机器可检索的英文 code/enum。

## 6. 迁移顺序

1. I18N-01：共享核心包和 locale 存储适配器。
2. I18N-02：中英文 key parity 检查和缺失 key 门禁。
3. I18N-03/I18N-04：Gateway provider、持久化、登录、导航和公共文案。
4. I18N-05/I18N-07：Gateway 业务页面、弹窗、错误码和格式化。
5. I18N-09/I18N-10：Mobile provider、启动恢复、登录、Session、设置。
6. I18N-11/I18N-12/I18N-13：Mobile Model、Conversation、审批、无障碍和格式化。
7. I18N-14/I18N-15：裸字符串门禁、双端 E2E、视觉和无障碍验收。

## 7. 完成判定

- 所有固定 UI 文案都有语义 key；允许保留项有明确注释或静态检查白名单。
- `zh`/`en` 字典通过 parity 检查，没有缺失或多余 key。
- 语言切换不改变认证、Session、游标、命令、审批或安全存储状态。
- Web 刷新、Mobile 重启后偏好保持；未知 locale 回退中文。
- 日期、数量、状态和无障碍文本跟随当前 locale。
- Gateway Console 与 Mobile 的中英文测试、响应式/键盘/安全区和屏幕阅读器证据齐全。
