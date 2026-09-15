# Gateway Web 与 Mobile 国际化术语表

版本：1.0  
状态：首发术语冻结（`zh` / `en`）  
更新时间：2026-08-29

## 使用规则

- UI 固定文案必须使用词典 key；不得在组件、屏幕或 Model 中新增已翻译句子。
- 用户输入、设备名、Session 名称、Runtime profile、Scope、ID、版本号和模型输出保持原值。
- 品牌名、协议名和产品边界词按下表处理，不因语言切换改写为近义词。
- 英文默认使用美式拼写和 `en-US` 日期/数字格式；中文使用 `zh-CN`。

## 固定术语

| 概念 | 中文 UI | English UI | 备注 |
| --- | --- | --- | --- |
| 产品名 | harndock | harndock | 保留品牌大小写 |
| 管理台 | Gateway 管理台 | Gateway Console | 页面标题可使用 Gateway |
| 网关 | Gateway | Gateway | 不翻译为 Gateway Server |
| 运行时 | Runtime | Runtime | `PC Runtime` 保持 |
| 会话 | Session | Session | 不使用 Chat/Task 替代 |
| 对话 | Conversation | Conversation | Session 内的对话视图 |
| Harness | Harness | Harness | 上游执行产品名 |
| PC 连接器 | PC Connector | PC Connector | 不翻译 Connector |
| 设备配对 | Desktop 配对 | Desktop pairing | pairing code 使用“配对码” |
| 访问凭据 | Access Token | Access Token | 原始 token 不进入日志或翻译参数 |
| 刷新凭据 | refresh token | refresh token | 只在安全说明中出现 |
| 授权范围 | 授权范围 | Granted scopes | scope 值保持原文 |
| 审批 | 审批 | Approval | `allow once` 对应“允许一次” |
| 允许一次 | 允许一次 | Allow once | 一次性审批结果 |
| 拒绝 | 拒绝 | Reject | 命令和审批操作统一使用 |
| 历史补发 | 正在补发历史 | Replaying history | 不使用 replaying backlog |
| 本地快照 | 本地快照 | Local snapshot | 仅表示本机投影 |
| 连接诊断 | 连接诊断 | Connection diagnostics | Settings 与 Gateway 页面统一 |
| 配对码 | 配对码 | Pairing code | 一次性值，只显示一次 |
| 游标 | 同步游标 | Sync cursor | `seq` 保持协议字段 |

## 状态术语

| 状态 key | 中文 | English |
| --- | --- | --- |
| `status.connection.connected` | 已连接 | Connected |
| `status.connection.connecting` | 连接中 | Connecting |
| `status.connection.reconnecting` | 正在重连 | Reconnecting |
| `status.connection.closed` | 离线 | Offline |
| `status.session.running` | 运行中 | Running |
| `status.session.waiting` | 等待中 | Waiting |
| `status.session.completed` | 已完成 | Completed |
| `status.session.failed` | 失败 | Failed |
| `status.session.cancelled` | 已取消 | Cancelled |
| `command.status.queued` | 已排队 | Queued |
| `command.status.executing` | 执行中 | Executing |
| `command.status.rejected` | 已拒绝 | Rejected |

## 审校要求

- 英文不得出现中文残留，中文不得出现未经批准的英文同义词混用。
- 不把服务端错误 message 当作固定 UI 文案；按稳定 error code 选择词条。
- 翻译调整必须同时更新 `zh`、`en`、回归测试和本表；删除 key 前先确认两个应用无引用。
