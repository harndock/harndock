# 移动端多端同步任务执行记录

更新时间：2026-08-24

## 第一轮：T0 基线核验与测试环境

执行时间：2026-08-21 11:06–11:12（Asia/Shanghai）
执行范围：`T0-01` 至 `T0-05`
结论：4 项完成，1 项阻塞；下一批必须先核验并补齐 DSH Auth。

### T0-01 两仓库基线

状态：已完成

| 仓库 | 分支 | 基线 commit | 工作区基线状态 |
| --- | --- | --- | --- |
| `<harndock-repo>` | `feat-msyc-1.0.1` | `4593bd2` | 执行开始时干净；随后仅产生本轮文档变更 |
| `<dsh-sync-server-repo>` | `feat-msyc-1.0.1` | `1222ec1` | 干净 |

### T0-02 DSH Auth、迁移与 Docker 核验

状态：已完成，发现 P0 实现缺口

核验结论：

- 当前服务端没有 `/v1/auth/register`、`/v1/auth/login`、`/v1/auth/refresh`、`/v1/auth/logout` 和 `/v1/me` 路由。
- 运行实例访问 `/v1/me` 和 `/v1/auth/login` 均返回 HTTP 404。
- `src/server.ts` 当前只接入 `PostgresAccessTokenRepository.authorizer()`，账号和 token 由 bootstrap 数据驱动。
- 数据库只有 `accounts`、`devices`、`runtimes`、`access_tokens` 等同步域表，没有密码凭据或 refresh session 表。
- 服务端 README 仍声明账号登录和 refresh token 由外部身份服务负责，与 0.4 文档中的 DSH Auth 完成基线不一致。
- 现有 Gateway 运行于 `http://127.0.0.1:8081`，`health/live` 和 `health/ready` 均返回 `{"status":"ok"}`。
- Compose 项目为 `deploy`，Gateway 镜像为 `deploy-gateway`；PostgreSQL、Redis、Gateway 和 Worker 正常运行。

已应用数据库迁移：

```text
001_initial.sql
002_pairing_codes.sql
003_session_read.sql
004_access_tokens.sql
005_command_queue.sql
```

### T0-03 本地环境矩阵

状态：已完成

| 组件 | 版本/状态 |
| --- | --- |
| macOS | 26.5.2，arm64 |
| Node.js | 22.22.3 |
| pnpm | 11.9.0 |
| Docker | 29.5.3 |
| Docker Compose | 5.1.4 |
| adb | 1.0.41 / 37.0.1 |
| Java | 17.0.12 |
| Android SDK | `$ANDROID_HOME`；项目 `local.properties` 已配置 |
| BlueStacks | 5.21.780.7504 |
| Android | 13 / API 33 / SM-G998B |
| 固定 adb target | `127.0.0.1:5555` |
| Mobile package | `ai.deepseek.dshgui.mobile`，版本 0.1.0，versionCode 1 |
| adb reverse | `tcp:8081 -> tcp:8081`、`tcp:8082 -> tcp:8082` |

ADB 同时显示 `127.0.0.1:5555` 和 `emulator-5554`，二者指向同一个 BlueStacks 实例。自动化命令统一指定 `adb -s 127.0.0.1:5555`，避免重复安装或重复执行测试。

### T0-04 端到端测试账号与数据

状态：阻塞

阻塞原因：DSH Auth 正式注册和登录接口不存在，数据库当前 `accounts/devices/runtimes/access_tokens/pairing_codes` 计数均为 0。直接手工插入账号只能验证旧 bootstrap 流程，不能证明需求定义的注册、登录、refresh 和 logout 生命周期。

解除条件：完成 `T1-01` 至 `T1-08` 后，通过公开 Auth API 创建独立 E2E 账号，再生成 PC pairing code、Desktop Device、Mobile Device 和短期 token。测试凭据不得写入仓库或本文件。

### T0-05 证据与脱敏规范

状态：已完成

- 证据目录和命名规则见 [test-evidence/README.md](test-evidence/README.md)。
- 单次执行记录使用 [test-record-template.md](test-record-template.md)。
- 原始 token、密码、refresh token、pairing code、PC 私钥、完整 prompt 和工具 payload 禁止进入 Git。

### 第一轮测试结果

| 测试 | 结果 |
| --- | --- |
| 服务端单元测试 | 18 通过，0 失败；本机命令因未配置 `TEST_DATABASE_URL` 跳过 3 项 PostgreSQL 集成测试 |
| Docker PostgreSQL 集成测试 | 21 通过，0 失败，0 跳过 |
| sync-protocol | 1 组通过；5 个合法向量和 3 个非法向量验证通过 |
| PC Remote Sync Connector | 10 通过，0 失败 |
| React Native Mobile | 24 通过，0 失败 |
| Gateway health | live/ready 均通过 |
| DSH Auth 路由 smoke | `/v1/me` 和 `/v1/auth/login` 均为 404，失败符合当前缺口判断 |

### 第一轮退出结论

环境、Docker、协议、Connector、Mobile 基础测试均可继续使用。DSH Auth 是当前唯一阻断正式账号和 BlueStacks 登录 E2E 的 P0 问题。下一轮执行 `T1-01` 至 `T1-08`，先完成服务端 Auth 数据模型、API 和契约测试，再回到 `T0-04` 创建真实测试账号。

## 第二轮：T1 DSH Auth 与账号生命周期

执行时间：2026-08-21 11:13–11:36（Asia/Shanghai）
执行范围：`T1-01` 至 `T1-08`，并推进 `T0-04`
结论：T1 全部完成；T0-04 已解除账号阻塞，等待 T3 建立 PC Device 和 pairing。

### 实现结果

- 新增 `006_dsh_auth.sql`：Account Auth subject、显示名称/状态、账号凭据、Mobile installation、refresh session 和 access token 会话关联。
- 密码使用 Node.js `scrypt` 加随机盐摘要；数据库不保存明文密码。
- access token 和 refresh token 均只保存 SHA-256 摘要。
- 新增注册、登录、refresh 单次轮换、logout 和 `/v1/me`。
- refresh 轮换会撤销旧 refresh token 和旧会话 access token；旧 refresh 重放返回 401。
- logout 幂等撤销 refresh session 和对应 access token。
- Auth 登录错误不区分账号不存在与密码错误；注册/登录/refresh 有进程内 IP 限流基线。
- 开发 bootstrap 在 `NODE_ENV=production` 下直接拒绝并有自动测试。
- 没有可信邮箱或管理员恢复通道时不开放匿名密码 reset API；账号恢复不会仅凭邮箱或 Device ID 执行。
- Compose Gateway 默认绑定调整为 `127.0.0.1:8081`，避免与现有 `sub2api-dev` 的 `8080` 冲突，同时符合本地 loopback HTTP 边界。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| TypeScript 类型检查 | 通过 |
| 服务端本地契约测试 | 23 通过；4 个 PostgreSQL 测试在无 `TEST_DATABASE_URL` 时按设计跳过 |
| Docker PostgreSQL 集成测试 | 27 通过，0 失败，0 跳过 |
| 数据库迁移 | `006_dsh_auth.sql` 已应用 |
| Gateway/Worker 重建 | 成功；Gateway `127.0.0.1:8081` healthy |
| 运行实例注册 | HTTP 201 |
| 运行实例 `/v1/me` | HTTP 200 |
| refresh 轮换 | HTTP 200；旧 access 和旧 refresh 均返回 401 |
| logout | HTTP 204；logout 后 access 返回 401 |
| 临时 smoke 账号 | 验证后已精确删除 |

### E2E 账号

- 已通过正式注册 API 创建独立 E2E 账号：`acct_…fc01`。
- 已创建 BlueStacks Mobile Device：`dev_…5438`。
- 邮箱、密码和 installation ID 只保存在 macOS Keychain 服务 `dsh-sync-e2e-credentials`。
- 注册会话已经 logout，下一次 BlueStacks 测试必须走真实登录。
- PC Device、Runtime 和 pairing code 在 T3 执行时创建，因此 `T0-04` 当前为进行中。

### 第二轮退出结论

DSH Auth P0 缺口已关闭。下一轮执行 `T2-01` 至 `T2-08`，核验并补齐统一 Auth middleware、Mobile Device、Runtime/token 管理 API、设备撤销级联、Gateway origin 配置和 Docker 集成测试。

## 第三轮：T2 Gateway、设备、Runtime 与 token

执行时间：2026-08-21 11:55–12:08（Asia/Shanghai）
执行范围：`T2-01` 至 `T2-08`，并完成 `T0-04` 的账号侧验收
结论：T2 全部完成；T0-04 的真实 PC Device/pairing 仍留给 T3。

### 实现结果

- 新增 `007_token_metadata.sql`，为 access token 增加 label、token hint 和账号创建时间索引；历史迁移保持不变，重复运行幂等。
- 新增 `GET /v1/devices`、`GET /v1/runtimes`、`GET /v1/tokens`、`POST /v1/tokens` 和 `POST /v1/tokens/:tokenId/revoke`。
- Device/Runtime/token 查询全部从 Bearer principal 的 `accountId` 取数；客户端不能提交账号身份，也不能跨设备签发 token。PC WS 继续使用配对后的 Ed25519 challenge/signature 建立 Runtime identity，不复用 Mobile Bearer token。
- token 列表只返回元数据；原始 token 只在签发成功的 201 响应中返回一次，服务端保存 digest、hint 和元数据。
- `/v1/stream` 补齐 `session.read` scope 校验；设备撤销继续级联撤销 token、Runtime、未完成命令，并主动关闭本实例 PC/Viewer WebSocket。
- Compose 默认仍绑定 `127.0.0.1:8081`；Desktop/Remote Sync 和 Mobile origin 校验只允许 HTTPS，或显式配置的 loopback HTTP。生产部署使用 HTTPS 反向代理。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| 服务端类型检查 | 通过 |
| 服务端本地单测 | 25 通过，4 个 PostgreSQL 测试因未设置 `TEST_DATABASE_URL` 跳过 |
| Docker PostgreSQL/WS/权限集成测试 | 29 通过，0 失败，0 跳过 |
| Compose 配置检查 | 通过 |
| Docker migrate 幂等检查 | `database migrations are up to date` |
| Gateway/Worker 重建 | 成功；Gateway/Worker 启动，Gateway health 保持通过 |
| 真实 Auth/设备/Runtime/token smoke | 登录 200；`/v1/me`、设备、Runtime、token 列表 200；签发 201；token 撤销 204 |
| 真实设备撤销 smoke | 设备撤销 204；被撤销设备 access 调用 `/v1/me` 返回 401；设备列表状态为 `revoked` |
| 敏感信息检查 | smoke 输出未打印密码、refresh token、原始 access token；原始凭据仍只在 macOS Keychain |

### 残留与下一步

- `sub2api-dev` 是已有的 Compose orphan 容器，端口属于独立项目，本轮未删除或重建。
- T0-04 只剩 PC Device、Runtime 和 pairing code；下一轮进入 T3 Desktop Connector 配对和 Runtime online。
- codegraph index sync 在本会话不可用，代码分析使用本地仓库检查替代；不影响本轮测试结果。

### 第三轮退出结论

Gateway 的统一 principal、设备/Runtime/token 管理、撤销级联、loopback HTTP 默认边界和 Docker 集成质量门已通过。下一轮执行 `T7-01` 至 `T7-04`，在 BlueStacks 上完成 Mobile 安装、origin、注册/登录/refresh/logout 和设备/token 生命周期冒烟；随后进入 T3 PC pairing。

## 第四轮：T7-01 至 T7-04 BlueStacks Mobile 认证与凭据

执行时间：2026-08-21 15:43–16:10（Asia/Shanghai）
执行范围：`T7-01` 至 `T7-04`
结论：T7-01 至 T7-04 全部完成；BlueStacks Development Build、Gateway origin、Auth 生命周期、Mobile Device 和 token 生命周期均通过。

### T7-01 BlueStacks、APK 和日志

- BlueStacks ADB 同时暴露 `127.0.0.1:5555` 与 `emulator-5554`，两者指向同一 SM-G998B Android 13/API 33 实例；测试统一使用固定 target `127.0.0.1:5555`。
- `app-debug.apk` 安装成功；包名 `ai.deepseek.dshgui.mobile`，版本 0.1.0，versionCode 1。
- APK 是 Expo Development Build，业务 bundle 不嵌入 APK。本轮按本地测试配置启动 Metro 8082，并通过 `adb reverse` 加载业务 bundle；Metro 完成 1000 个模块构建，Pairing 页面正常显示。
- 应用前台 Activity 为 `ai.deepseek.dshgui.mobile/.MainActivity`。按应用 PID 检查未发现 `FATAL EXCEPTION` 或 bundle 加载错误。测试期间一条 `uiautomator` PID 的异常来自并发 dump，不属于应用进程。
- React Native Mobile 24 项测试通过，TypeScript 类型检查通过。

### T7-02 Gateway origin

| 场景 | 结果 |
| --- | --- |
| HTTPS origin `https://sync.example.test` | origin 校验通过并进入 Sessions；测试域不可达时显示“Gateway：重连中”和同步失败 |
| loopback HTTP `http://127.0.0.1:8081` | 通过 `adb reverse` 连接真实 Gateway，2 秒内显示“Gateway：已连接” |
| 非法 origin（带 `/v1` path） | 停留在 Pairing，提示必须使用允许协议和 origin 地址 |
| 不可达地址 `http://127.0.0.1:65535` | origin 校验通过并进入 Sessions，稳定显示重连和同步失败 |

本地 Development Build 显式配置 `EXPO_PUBLIC_GATEWAY_PROTOCOLS=http,https`；生产构建仍应固定 HTTPS。

### T7-03 Auth 生命周期

| 验证 | 结果 |
| --- | --- |
| 临时新账号注册 | HTTP 201；`/v1/me` HTTP 200 |
| 注册会话 logout | HTTP 204；旧 access 调用受保护接口 HTTP 401 |
| E2E 账号登录 | HTTP 200；`/v1/me` HTTP 200 |
| refresh 轮换 | HTTP 200；refresh 已轮换；旧 access 和旧 refresh 重放均 HTTP 401 |
| 新 access 恢复 | `/v1/me` HTTP 200 |
| logout | HTTP 204；logout 后 access 与 refresh 均 HTTP 401 |

移动端当前产品边界仍是由外部身份服务调用 Auth API 并向 Development Build 录入短期 access token；APK 内不包含账号密码登录表单。因此注册、登录、refresh 和 logout 通过真实 Gateway API 验证，最终 access token 再在 BlueStacks UI 中完成连接验收。

### T7-04 Mobile Device 和 token 生命周期

- E2E 账号重新登录成功，并复用稳定 installation 对应的 Mobile Device `dev_…5438`；`GET /v1/devices` 返回该设备为 active。
- 短期 `session.read` token 签发 HTTP 201；使用原始 token 调用 `/v1/me` HTTP 200。
- token 列表只返回 `token_…ed4c`、hint `...iIPU78` 和元数据，不返回原始 token；active 状态正确。
- token 撤销 HTTP 204；撤销后调用 `/v1/me` HTTP 401，列表状态变为 revoked。
- E2E 账号再次登录后签发的 Auth access token 已在 BlueStacks 中连接真实 loopback Gateway，并显示“Gateway：已连接”。

### 清理与证据

- 临时注册账号 `acct_…5ffa` 及其 Device 已通过精确 account ID 删除。
- 专用 token 已撤销；本轮结束时 E2E 账号 active Auth sessions 和 active access tokens 计数均为 0。
- BlueStacks SecureStore 中的 access token 已通过“清除本机凭据”清空；E2E 账号与 Mobile Device 保留给 T3/T7-05。
- Gateway live/ready 均为 HTTP 200；Gateway 镜像 digest 为 `sha256:15c49036cec64ec2ad5c6da2eb443c5cf7a7279e1aac442f3c4b848d07805a22`。
- 脱敏记录位于 `docs/mobile-sync/test-evidence/20260821-1543-T7-01-04-mobile-auth/record.md`。
- codegraph index sync 在本会话不可用，使用本地源码检查、真实 API 调用、ADB UI dump 和应用 PID 日志验证替代。

### 第四轮退出结论

Mobile 认证和凭据闭环已在 BlueStacks 上通过。下一轮执行 `T3-02` 至 `T3-07` 与 `T7-05`，建立 PC Device、pairing code、Desktop Connector 和 Runtime online 链路。

## 第五轮：T3 Desktop Connector 与 T7-05 PC Runtime online

执行时间：2026-08-21 16:33–17:46（Asia/Shanghai）
执行范围：`T3-01` 至 `T3-07`、`T7-05`
结论：Desktop pairing、Keychain、Connector、Runtime 心跳、BlueStacks 设备视图和解除配对清理全部通过。

### 实现与修复

- Desktop 配对配置只保存 Gateway WebSocket origin、账号/Device/Runtime 标识、公钥和平台元数据；配置权限为 `0600`，未发现 token、密码、secret 或私钥字段。
- Ed25519 私钥写入 macOS Keychain，配置文件不保存私钥。解除配对后配置、outbox 和对应 Keychain 项均删除。
- Desktop 原生应用菜单新增 `Remote Sync Settings...`，Runtime 页面与设置页可双向切换。
- 已配对状态禁止直接覆盖身份，必须先解除配对再使用新的单次配对码。
- Tauri WebView 中的 `window.confirm()` 无法形成可操作确认框；本轮改为页面内两步确认，并在正式 `.app` 中完成实际解除配对验证。
- macOS 上 nonblocking Unix control listener 接受的 stream 可能在 ready 帧读取阶段返回 `EAGAIN`；接受连接后现显式恢复 blocking 模式，并保留 5 秒读取超时。
- Mobile Sessions 页面读取 `/v1/devices` 和 `/v1/runtimes`，每 5 秒刷新并显示设备/Runtime 在线状态与最后心跳。
- 正式 Runtime 归档补齐 `@dsh-gui/remote-sync` manifest 合同；`check:bundled-runtime` 对归档内 manifest 与仓库基准执行精确比较。

### 真实链路结果

| 验证 | 结果 |
| --- | --- |
| Desktop pairing exchange | 单次配对码消费成功，创建 PC Device 和 desktop Runtime |
| Desktop Runtime | Gateway 列表状态 `online`，Device 的在线 Runtime 数为 1 |
| 心跳 | 两次 REST 采样间隔 6 秒，`lastHeartbeatAt` 正常前进 |
| BlueStacks | Gateway 已连接；`Mac Desktop T3` 在线；`desktop` Runtime 在线并显示心跳 |
| Desktop 配置 | `0600`；无 token/private/secret/password 字段 |
| macOS Keychain | 配对后存在；解除配对后不存在 |
| outbox/config 清理 | 解除配对后均不存在 |
| 正式应用包 | `.app` 构建成功并运行；Runtime bundle 合同校验通过 |

配对和解除配对后的 Runtime 重启曾稳定复现 macOS `os error 35`。日志证明 Runtime 已输出 URL，失败点位于 control socket ready 帧读取；修复 accepted stream 模式后重建正式包，连续两次启动均完成 ready 握手并进入 Harness。Gateway 心跳在配对状态下持续前进。

### Runtime 产物

- 版本：`2026.08.17.1`，`darwin-aarch64`
- 大小：`64825232` bytes
- SHA-256：`4a0d3354e03cd13613e74cb5598e6380070a1887dac905af6ccb1cbc31dced2b`
- 正式包：`apps/desktop/src-tauri/target/release/bundle/macos/DeepSeek Harness Desktop.app`

### 清理与证据

- BlueStacks SecureStore 临时 access token 已清除。
- Desktop 本地配对配置、outbox 和 Keychain 私钥已清除。
- 本轮 Auth session 已 logout，临时账号按精确 ID 删除，数据库剩余账号行数为 0。
- 原始密码、access/refresh token、配对码、Authorization header 和私钥未写入仓库或执行日志。
- 脱敏记录位于 `docs/mobile-sync/test-evidence/20260821-1633-T3-01-07-T7-05-pc-runtime/`。
- codegraph 工具在本会话不可用，按技能降级为本地源码、测试、正式包、真实 Gateway API、Computer Use 和 ADB 验证。

### 第五轮退出结论

T3 和 T7-05 已关闭。下一轮进入 `T5-01` 至 `T5-06` 与 `T7-06` 至 `T7-08`，验证真实 Session 事件、游标补发、远程命令和设备撤销闭环。

## 第六轮：T5-01 至 T5-03、T7-06 至 T7-07 实时 Session 与远程命令

执行时间：2026-08-22 09:00–10:10（Asia/Shanghai）
执行范围：`T5-01` 至 `T5-03`、`T7-06`、`T7-07`
结论：实时 Session 初始快照、零基游标、REST history、真实 `session.prompt` 和 `session.cancel` 已通过；断网恢复 UI、审批 first-wins 和设备撤销/重新配对留待下一轮。

### 实现与修复

- Connector 为新 Session 发布 `lastSeq=-1` 快照，并通过串行 publication chain 保证首个 `seq=0` 事件不会先于快照；迟到的重复 `session/created` 快照会被忽略。
- Mobile Sessions 遇到 401 或 `authentication_required` 时清理 SecureStore token 并返回 Pairing 页面。
- Gateway 与 sync protocol 以零基 cursor 迁移部署；空 Session 的 `lastSeq=-1`，首个事件为 `seq=0`。

### 真实链路结果

| 验证 | 结果 |
| --- | --- |
| Runtime 创建 Session | Gateway 收到快照及 seq 0、1、2；outbox ACK 后 cursor 为 2 |
| Session history | REST `afterSeq=-1` 可读取零基事件，重启后持久 cursor 可恢复 |
| `session.prompt` | Mobile control token 提交 queued；PC Harness 实际执行并返回 completed，真实事件推进至 seq 280 |
| `session.cancel` | 以最新 baseSeq 提交 queued；PC Harness 实际执行并返回 completed，Session 终态为 completed |
| Runtime/Gateway | Gateway ready 通过；Desktop Runtime online；outbox 无待发帧 |

### 已知边界

- `/help` 在当前开发模型配置下产生过多 `assistant/chunk`，使 Gateway Node 触发 OOM；Gateway 已重启恢复。后续测试应使用短输出或增加受控事件上限。
- BlueStacks 在一次 Metro `8082` 与 Gateway `8081` 的 ADB reverse 切换后保留“Gateway returned an empty response”提示，说明 `ViewerSync` 的 hydrate 失败重试和重连后的目录刷新仍需补强。
- 审批 first-wins、并发命令串行的真实 Harness 场景，以及设备撤销和重新配对未在本轮执行。

脱敏记录位于 `docs/mobile-sync/test-evidence/20260822-T5-01-03-T7-06-07-live-session/`。

## 第五轮：Gateway 后台维护基础与零基游标

执行时间：2026-08-22 10:42–10:51（Asia/Shanghai）
执行范围：新增 `T2-09`，服务端零基 Session 游标和 Worker 命令回收。

### 实现结果

- 事件历史路由允许 `afterSeq=-1`，与零基事件序列和移动端首次补发契约一致；小于 `-1` 仍返回 `invalid_request`。
- `PostgresCommandRepository.expireDue()` 在事务中回收到期命令：`queued` 标记为 `expired/command_expired`，`received/authorized/executing` 标记为 `unknown/command_timeout`。
- 每次回收写入 `command.expired` 审计记录；Worker 使用 `COMMAND_MAINTENANCE_INTERVAL_MS` 周期运行，默认 1000ms。
- Compose Gateway/Worker 均注入维护间隔配置，未增加客户端凭据或事件正文日志。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| 服务端类型检查 | 通过 |
| 服务端本地单测 | 25 通过 |
| Compose PostgreSQL 集成测试 | 29 通过，0 失败，0 跳过 |
| Compose 配置检查 | 通过 |
| `git diff --check` | 通过 |

### 残留风险

- Redis 多实例广播、连接/延迟指标、故障注入和 10,000 长连接压测仍属于 M6，尚未在本轮实现。
- Worker 当前只负责命令状态回收；事件清理、备份恢复和 Redis 重建仍需独立运维任务。

## 第七轮：R0 代码事实基线与计划重排

执行时间：2026-08-24（Asia/Shanghai）

执行范围：两个仓库工作区、提交历史、codegraph、Gateway Console、Mobile、Desktop、服务端路由、任务文档和当前自动化测试。

结论：旧判断“Gateway Web 管理页尚未开发”已失效；真实下一批是 Mobile AuthGate、当前账号自助 pairing code、Web 会话加固和三端真实 E2E。

### 仓库事实

- `dsh-gui` 分支/提交：`feat-msyc-1.0.1` / `c3c133c`；核验开始时工作区干净。
- `dsh-sync-server` 分支/提交：`feat-msyc-1.0.1` / `e0aacee`；工作区干净。
- 两个仓库 codegraph 索引均存在且在核验开始时为最新：`dsh-gui` 68 files / 1,127 nodes，`dsh-sync-server` 22 files / 339 nodes。
- `dsh-sync-server/apps/gateway-console` 已有独立 React/Vite 管理端；最近提交包含控制台创建、交互完善、状态展示和设备撤销权限覆盖。

### 代码结论

- Gateway 已实现 Auth、`/v1/me`、设备、Runtime、Token、Session、命令、pairing exchange、PC WS 和 Viewer stream 路由。
- Gateway Console 已实现登录/注册、启动恢复、refresh/logout、账号、设备/Runtime、设备撤销、Token 一次性签发/撤销和 live/ready 诊断；不能再标记为“待实施”。
- Console 的 Desktop pairing 当前只是说明卡片；pairing code 仍由 `pairing-create.ts`/Docker CLI 签发，缺少当前账号 create/list/revoke HTTP API 和自助页面。
- Console 当前把包含 access/refresh token 的 AuthState 写入 `sessionStorage`，发布前需要冻结并实现更强的 Web 会话边界。
- Mobile 当前 `PairingScreen` 只接受外部短期 access token；没有账号密码登录、注册、refresh、logout 或完整 AuthGate。access token 已进入 SecureStore，Session/命令、设备/Runtime 摘要、离线恢复和历史投影已实现。
- Desktop pairing exchange、Keychain、Ed25519、配置清理和 Runtime 链路已实现；远端 Gateway/Runtime online 与最近心跳尚未在 Desktop 状态模型中完整呈现。
- 历史 API smoke 不能替代 Mobile 内 AuthGate 验收，因此 T7-03/T7-04 从“已完成”修正为“部分完成”。最新 Mobile 历史投影与握手修复发生在既有 BlueStacks 证据之后，T7-06 保持部分完成并要求重跑。

### 当前验证

| 验证 | 结果 |
| --- | --- |
| `dsh-sync-server` `pnpm test` | 26 通过、0 失败、4 跳过；跳过项需要专用 `TEST_DATABASE_URL` |
| Gateway Console `pnpm build:gateway-console` | typecheck 和 Vite production build 通过 |
| Mobile `pnpm --filter @dsh-gui/mobile test` | 31 通过、0 失败 |
| Mobile typecheck | 通过 |
| `dsh-gui` `pnpm check` | 通过；协议、Connector、Desktop profile、runtime bridge、安全、TS/Rust 检查均通过 |
| Rust tests | 17 通过、0 失败、1 ignored；ignored 项要求本地构建 Runtime 产物 |
| 文档检查 | 重排后 19 个 Markdown 文件通过，`git diff --check` 通过 |

### 重排结论

1. 先实现 T2-10 当前账号 pairing 管理 API；它与 T4 Mobile AuthGate 可并行。
2. 再完成 T4W pairing 页面、Web Auth 会话加固、自动化测试和真实 Gateway E2E。
3. 随后对齐 Desktop 远端状态，执行 Mobile 登录、PC pairing、Runtime online、撤销与重新配对 E2E。
4. 最后在最新 Mobile 代码上重跑历史补发、断网恢复、prompt/cancel/approval，再进入安全、故障、备份、容量和发布质量门。

## 计划决策：Gateway Web 管理端优先

决策时间：2026-08-24（Asia/Shanghai）

用户明确要求优先完成 Gateway Web 管理端。自本决策起，当前唯一优先产品批次调整为：

1. T2-10 pairing 管理 API、迁移、账号隔离与测试。
2. T4W-08 Web Auth 会话安全。
3. T4W-02 至 T4W-07 页面功能与真实错误态收口。
4. T4W-09 管理端自动化测试。
5. T4W-10 真实 Gateway + Desktop 全链路验收。

Mobile Auth、Mobile 可访问性和后续 BlueStacks 回归保留在计划中，但在 T4W-10 完成前不作为当前开发批次启动。Gateway Web 的完成标准是功能、自动化测试、会话安全和真实 E2E 同时通过，不以页面存在、原型可操作或 production build 成功代替。

### 入口补充决策

代码核验确认两个入口缺口：

- Gateway Console 目前只有 Vite `http://localhost:4173` 开发入口；正式 Dockerfile 不构建或复制 Console 静态产物，Gateway 根路径也没有页面路由，因此生产用户没有可用入口。
- Desktop 配置页本身已实现，但 Runtime ready 后主窗口导航到 Harness；此后主要依赖原生菜单 `Remote Sync Settings...` 和 `Cmd/Ctrl+,` 调用 `RuntimeManager::show_settings()`，Harness 页面内没有可发现入口。`@dsh-gui/client-desktop` 当前只写入 DOM marker，没有注册设置或侧栏项。

冻结方案：生产环境打开 Gateway origin 根路径直接进入同源 Console；Desktop 未配对首次启动保留配置引导，Harness Settings/侧栏增加常驻“Gateway 与远程同步”入口，原生菜单/快捷键保留为兜底。Harness Runtime origin 不获得通用 Tauri IPC，页面入口通过窄权限、带 nonce 的本地控制消息返回 Tauri 配置页。

## 第八轮：GW0 Gateway 正式入口与 pairing 管理 API

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T2-10`、`T4W-00` 的服务端、迁移、构建链路、测试和文档。

### 实现结果

- 新增迁移 `009_pairing_management.sql`：为 pairing code 增加稳定公开 ID、撤销时间、终态约束和 active 索引；已有数据使用 digest 派生的非敏感 ID 回填，不恢复原始配对码。
- `PostgresPairingRepository` 新增 issue/list/revoke 状态模型；列表只返回元数据，创建结果只返回一次原始 code；创建和撤销写入审计，兑换拒绝已撤销 code。
- 新增 `GET /v1/pairings`、`POST /v1/pairings` 和 `POST /v1/pairings/:pairingId/revoke`。读取要求 `session.read`，创建/撤销要求当前 Device 的 `session.control`，账号 ID 始终来自 Bearer principal。
- Gateway 正式构建会先构建 `apps/gateway-console`，再复制到 `dist/gateway-console`；Gateway 在根路径和既定 SPA 路由提供 HTML，在 `/assets` 提供哈希静态资源，`/v1`、`/health` 和 WS 路径不进入 fallback。
- Dockerfile 已纳入 workspace lockfile、Console 依赖和源文件，runtime 镜像仍以非 root、只读根文件系统方式运行。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| 服务端 typecheck + 完整 build | 通过；Console production build 与复制通过 |
| `pnpm test` | 32 项：28 通过、0 失败、4 项因未配置数据库跳过；新增入口/API 测试通过 |
| 临时隔离 PostgreSQL 集成测试 | 4/4 通过；包含迁移 009、账号隔离、消费、撤销和重放拒绝；临时容器已删除 |
| 既有 Compose 集成镜像 | 29/29 通过，但判定为旧镜像证据，不用于证明本轮构建 |
| `git diff --check` | 通过 |

### 未闭合项与下一步

- 强制重建 Gateway/test 镜像时，Docker 停留在固定 Node 基础镜像的 registry 元数据读取且无错误输出；等待后主动终止。`T4W-00` 因缺少正式镜像重建和根路径容器访问证据保持“进行中”，不把旧镜像通过误记为完成。
- `T2-10` 已完整关闭，pairing 页面可以依赖冻结后的 API 契约开发。
- 下一项产品开发进入 `T4W-08` Web Auth 会话安全；随后执行 `T4W-07` pairing 页面和 `T3-09` Desktop 可发现入口。Docker registry 恢复后并行补齐 `T4W-00` 容器验收。

## 第九轮：GW1 Web Auth 会话安全

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4W-08`，保持 Mobile/Desktop 原生认证兼容的同时收紧 Gateway Console 会话边界。

### 实现结果

- 保留原有 `/v1/auth/register|login|refresh|logout` JSON refresh token 契约供原生客户端使用；新增 `/v1/web/auth/*` 同源 Web 契约，避免以请求头或客户端标志混用安全边界。
- Web 登录/注册把 refresh credential 写入 `HttpOnly`、`SameSite=Strict`、限定 `/v1/web/auth` path 的 cookie，响应不返回 refresh token；refresh 单次轮换 cookie，logout 清除 cookie。无效/重放 refresh 返回 401 但不下发清除 cookie，避免多标签并发响应误删另一个请求刚轮换出的有效 cookie。
- `WEB_AUTH_COOKIE_SECURE` 在 production 默认 `true`；Compose 候选配置默认 `true`。仅 loopback HTTP 开发允许显式设为 `false`。
- Console 不再读取或写入持久 AuthState；启动时只删除旧版 `sessionStorage` 会话，access token 仅存在 React 内存，refresh cookie 不可被 JavaScript 读取。
- 页面启动通过 cookie 恢复；多个并发 401 共享一次 refresh，使用新 access token 重试一次；refresh 失败或重试仍为 401 时统一返回登录，避免半登录状态。
- logout 只有在 Gateway 完成服务端撤销并清除 cookie 后才退出 UI；网络失败时保留当前状态并提示重试，不把仍有效会话误报为已退出。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| 服务端与 Console typecheck/build | 通过 |
| Web cookie 契约测试 | 通过；覆盖登录/注册不泄漏 refresh、HttpOnly/SameSite/Secure/path、轮换、重放拒绝和 logout 清理 |
| 完整测试 + 隔离 PostgreSQL | 34/34 通过，0 失败，0 跳过；临时数据库容器已删除 |
| Compose 配置解析 | 通过 |
| Web Storage 凭据扫描 | 未发现 Auth token 的 set/get；只保留旧 session key 删除逻辑 |
| `git diff --check` | 通过 |

### 下一步

- `T4W-08` 已关闭，不以 production build 代替浏览器真实 E2E；刷新页面、cookie 属性和离线 logout 的浏览器证据纳入 `T4W-09/T4W-10`。
- 下一轮进入 GW2：优先实现 `T4W-07` pairing code 页面，再实现 `T3-09` Desktop Gateway 配置的可发现入口。

## 第十轮：GW2 pairing 页面与 Desktop 可发现入口

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4W-07`、`T3-09`，以及它们依赖的 Console SPA 路由和 Desktop Runtime 固定控制动作。

### 实现结果

- Gateway Console 新增 `/pairings` 独立路由和侧栏入口，接入当前账号 `GET/POST /v1/pairings` 与 revoke API；支持 5/10/30 分钟 TTL、一次性原文结果、复制、active/consumed/expired/revoked 状态、绑定 Device 元数据和撤销确认。
- 配对码原文只保留在创建结果的 React 内存状态；列表只使用 `pairingId` 和状态元数据。页面明确给出 Gateway origin，Desktop 可直接填写 origin 与一次性 code，不再依赖 Docker CLI。
- Gateway 静态 SPA 路由加入 `/pairings`，直接刷新仍返回 Console，同时不改变 `/v1`、health 和 WS 隔离边界。
- Desktop 未配对首次启动不再自动启动并跳转 Harness；配置页保留 Gateway pairing 表单，并提供明确的 “Skip for now and open Harness” 本地模式选择。解除配对后停留在配置页，不再立即跳走。
- `@dsh-gui/client-desktop` 在 Harness 页面提供常驻 “Gateway & Remote Sync” 入口。入口只向同源固定 path 发送 POST，不直接调用 Tauri。
- `@dsh-gui/runtime-bridge` 校验同源 origin 和固定动作头，再通过私有 Unix socket 发送 `showSettings` 帧。Rust 校验 256-bit nonce、Runtime 版本/API、profile 和 Harness commit 后返回本地 Tauri 配置页；listener 在 ready 后继续服务，并随 Runtime 生命周期关闭。
- Tauri capability 保持不变：Harness Runtime origin 没有 remote IPC、Shell 或文件系统权限；原生 `Remote Sync Settings...` 与 `Cmd/Ctrl+,` 继续作为兜底。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| Gateway Console typecheck + production build | 通过；`/pairings` 产物已生成 |
| Gateway 服务端 `pnpm test` | 34 项：30 通过、0 失败、4 项因本轮未配置 `TEST_DATABASE_URL` 跳过；pairing API 的隔离 PostgreSQL 4/4 已在 GW0 通过 |
| Desktop TypeScript 与插件 build | 通过 |
| Runtime bridge 真实 Unix socket 测试 | 通过；覆盖 ready、showSettings、schema、同源允许和跨源拒绝 |
| Rust control 测试 | 3/3 通过；listener 可连续接收 ready 与 showSettings |
| 真实 Harness desktop profile | 通过；Client bundle 包含常驻入口和固定 endpoint |
| Runtime contract | 通过；schema 同时约束 ready 和 showSettings 两种严格帧 |
| Tauri security boundary | 通过；未开放 remote IPC、Shell 或 filesystem capability |

### 下一步

- `T4W-07` 与 `T3-09` 已关闭。真实浏览器创建配对码、Desktop 消费、Runtime online 和 Console consumed 状态证据仍统一归入 `T4W-10`，不以 build 结果代替 E2E。
- 下一轮进入 GW3：实现 `T4W-09` Gateway Console 自动化，覆盖路由保护、cookie 恢复/401、Token/pairing 一次性结果、撤销与错误态；同时关闭 `T4W-02` 至 `T4W-06` 可自动验证的缺口。
- Docker registry 恢复后并行补齐 `T4W-00` 正式镜像重建证据。

## 第十一轮：GW3 Gateway Console 自动化质量门

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4W-09`，并自动化关闭 `T4W-02` 至 `T4W-07` 的关键状态验证缺口。

### 实现结果

- Gateway Console 新增 Vitest 4、jsdom、React Testing Library 和 user-event 测试运行器；测试配置固定 loopback origin，并在每项测试后清理 DOM、Web Storage、history 和全局 mock。
- 新增 API client 契约测试：验证 Web refresh 使用 cookie credentials、账号资源使用 Bearer、pairing TTL body、路径编码、公开错误解析、非 JSON 失败和 Gateway origin 协议边界。
- 新增真实 `App` 组件集成测试：覆盖登录成功且 access token 不进入 Web Storage、私有深链保护、cookie 会话恢复、设备/Runtime inventory 和路由保持。
- 并发设备/Runtime 请求同时收到旧 access token 的 401 时，测试证明只发生一次共享 refresh；新 access token 重试成功，不产生重复 refresh 或半登录状态。
- 当前设备撤销覆盖确认弹窗、DELETE、立即返回登录和重新配对提示；logout 网络失败覆盖保留当前认证 UI 和明确错误，不把未撤销会话误报为退出。
- Token 覆盖签发、一次性原文、关闭后消失、不进入 local/session storage 以及签发失败保留表单；pairing 覆盖一次性原文、关闭、active 元数据、撤销确认和成功反馈。
- 仓库根 `pnpm test` 现固定执行 Console production build、14 项 Console 自动化和既有服务端测试，CI 不再可能只跑 build/typecheck 而漏掉管理端行为。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| Gateway Console typecheck | 通过；测试源码也在严格 TypeScript 范围内 |
| Gateway Console Vitest | 2 个测试文件、14/14 通过 |
| Console production build | 通过；30 个模块完成转换 |
| 仓库根 `pnpm test` | Console 14/14；服务端 30 通过、0 失败、4 个 PostgreSQL 项因未配置 `TEST_DATABASE_URL` 跳过 |
| PostgreSQL pairing/Auth/token/runtime 契约 | 本轮未改服务端持久层；GW0/GW1 隔离数据库 4/4 证据继续有效 |

### 下一步

- `T4W-09` 已关闭。jsdom 自动化用于稳定覆盖组件状态和 HTTP 契约，不替代真实浏览器、cookie 属性、正式 Gateway 和 Desktop 消费配对码的 E2E。
- 下一轮进入 GW4 `T4W-10`：从 Gateway 根路径完成注册/登录/refresh/logout、账号、设备、Runtime、Token、pairing、诊断、当前设备退出和 Desktop 打开设置/消费配对码的脱敏证据。
- `T4W-00` 正式镜像重建证据继续等待 Docker registry 可用；若 registry 仍不可用，GW4 先使用当前本地构建产物验证非容器路径，并明确区分证据等级。

## 第十二轮：Gateway 7019 / Admin Web 7018 端口拆分

执行时间：2026-08-24（Asia/Shanghai）

执行范围：用户指定移除 `8081`，Gateway API/WS 改用 `7019`，Gateway Admin Web 改用 `7018`；同步关闭 `T4W-00` 正式镜像证据。

### 实现结果

- Gateway 不再注册 Console 静态路由；`7019` 仅提供 health、Auth、REST 与 WebSocket，根路径和 `/login` 返回 404。
- 新增独立 Gateway Admin 进程：`7018` 提供 Console SPA 与哈希静态资源，并只将 `/v1/*`、`/health/*` HTTP 请求同源代理到 Gateway。
- Admin 明确拒绝 `/v1/ws` 与 `/v1/stream`，Desktop/Mobile 的 WebSocket 始终直接连接 `7019`。
- Admin 代理透传 Authorization、Cookie、请求体、状态码、公开响应头和多个 Set-Cookie；上游不可用时返回稳定的 `gateway_unavailable` 502，不输出上游细节。
- Compose 新增 `admin` 服务，Gateway 容器内外均监听 `7019`，Admin 容器内外均监听 `7018`；Vite 开发端口与代理目标同步调整。
- Desktop/Mobile 的规范 Gateway origin 和 BlueStacks ADB reverse 示例改为 `7019`；`7018` 只作为浏览器 Admin 入口。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| Gateway Console Vitest | 14/14 通过 |
| 服务端与 Admin 测试 | 32 通过、0 失败；4 个 PostgreSQL 项因未配置 `TEST_DATABASE_URL` 跳过 |
| Mobile 回归 | 31/31 通过，typecheck 通过 |
| 正式镜像 | gateway、admin、worker、migrate 全部重建成功；迁移为最新状态 |
| Admin `7018` | `/`、`/login`、`/pairings`、代理 `/health/ready` 返回 200；`/v1/ws` 返回 404 |
| Gateway `7019` | `/health/ready` 返回 200；根路径返回 404；认证边界返回 401 |
| 旧 `8081` | 无监听，连接失败 |
| 文档与 diff | Markdown 检查和 `git diff --check` 通过 |

### 下一步

- `T4W-00` 已关闭。继续 `T4W-10` 真实 UI 验收时，浏览器打开 `http://127.0.0.1:7018`，Desktop pairing 填写 `http://127.0.0.1:7019`。
- 本机现有 Desktop 配置仍指向旧 `8081`，需要在解锁后解除配对并用新的单次 pairing code 重新连接 `7019`；不直接改写 Keychain 或私有配置文件。

## 第十三轮：唯一 Gateway 管理员与无注册认证

执行时间：2026-08-24（Asia/Shanghai）

执行范围：移除 Gateway 账号注册；首次启动通过环境变量初始化唯一管理员；新增 curl 凭据修改接口；同步 Console、迁移、测试和部署文档。

### 实现结果

- Gateway 原生与 Web 注册 API 已移除，Admin `/register` 入口已移除；三条路径均稳定返回 404。
- 新增 `010_gateway_admin.sql`，为账号凭据标记唯一 Gateway 管理员；历史账号不再具备管理员登录资格。
- Gateway 启动时读取 `GATEWAY_ADMIN_USERNAME`、`GATEWAY_ADMIN_PASSWORD`，仅在数据库尚无管理员时创建账号；默认本地值为 `admin` / `admin123`，后续重启不会覆盖数据库凭据。
- 新增 `PUT /v1/admin/credentials`：当前凭据通过 HTTP Basic Auth 提供，新账号密码放在 JSON body；成功返回 204，更新 scrypt 摘要并撤销全部旧登录 session/access token。
- Gateway Console 只保留管理员登录，账号字段由 email 收敛为 username；注册按钮、注册表单和 `/register` SPA 路由全部移除。
- 删除旧 `auth:bootstrap` 源码、命令和测试；管理员初始化现在属于正式 Gateway 启动生命周期。
- 修复测试镜像未复制 `vitest.config.ts` 的问题，使容器内 Console 测试与本机一致使用 jsdom。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| Gateway Console | typecheck/build 通过；Vitest 14/14 通过 |
| 服务端非数据库测试 | 32/32 通过 |
| PostgreSQL 集成 | 4/4 通过；管理员初始化幂等、登录、refresh、凭据修改、旧会话撤销全部覆盖 |
| 数据库迁移 | `010_gateway_admin.sql` 已应用 |
| 正式容器 | gateway `7019`、admin `7018`、worker、PostgreSQL、Redis 均已重建/运行；gateway/admin healthy |
| 注册边界 | 原生注册 API 404；Web 注册 API 404；Admin `/register` 404 |
| 管理鉴权 | 无 Basic Auth 的凭据修改返回 401；默认管理员经 7018 登录成功并 logout 204 |
| 管理员数据 | PostgreSQL 中唯一 `admin` 管理员标记为 true；响应只返回脱敏账号摘要 |

### 下一步

- 首次非本地部署必须在启动后立即通过文档中的 curl 命令修改默认密码；生产调用必须使用 HTTPS 或受信任的 loopback/内网路径。
- `T4W-02` 已关闭；继续 `T4W-10` 时不再测试注册，改为管理员登录/refresh/logout、设备、Runtime、Token、pairing、诊断和 Desktop 消费配对码全链路。

## 第十四轮：GW4 Gateway Web + Desktop 真实 E2E 主链路

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4W-10` 真实浏览器、Release Desktop、PostgreSQL 与 Gateway 重启恢复；同时修正 Admin/Desktop origin 混用和解除配对残留旧 origin。

### 实现与验收结果

- Admin 增加只读运行时配置 `/admin-config`；`GATEWAY_ORIGIN` 只承担 Admin 容器内部 HTTP 上游，`PUBLIC_GATEWAY_ORIGIN` 提供 Desktop 可访问的 `7019` origin。Overview、配对、设备和诊断页面不再把 `7018` 生成为 PC WebSocket 地址。
- 真实浏览器从 Admin `7018` 恢复管理员会话，账号、设备、Runtime、pairing、Token、诊断和 logout 页面均读取真实 API；页面显示 Admin `7018`、Gateway/WS `7019`。
- 新构建 Desktop 的应用菜单真实出现 Gateway 配置入口，可从 Harness 页面返回配置页；Release Desktop 解除旧 `8081` 本地身份后消费新的单次 pairing code，创建 `Admin Mac Desktop` 和对应 Runtime。
- pairing 列表显示 consumed 并绑定新 PC Device；设备页和诊断页显示 `1/1` Runtime 在线。Gateway 重启后 Desktop 自动重连，PostgreSQL 的 connected/heartbeat 时间继续推进。
- 管理页真实创建 15 分钟、仅 `session.read` 的临时 Token；原文关闭后无法恢复，列表只显示元数据；随后只撤销该临时 Token，当前登录 Token 未被误撤销。
- Web logout 成功返回登录页并撤销 refresh session；Desktop Runtime 与 Web 管理会话保持独立。
- Desktop 解除配对完成后现在清空旧 Gateway URL，不再把历史 `8081` 带入下一次配对表单。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Gateway/Console `pnpm test` | Console 15/15；服务端 32 通过、0 失败；4 个 PostgreSQL 项在该命令中因未配置独立 URL 跳过 |
| Compose PostgreSQL integration | 35 通过、0 失败；管理员初始化项因长期测试库已存在唯一管理员按设计跳过 |
| Desktop `pnpm check` | 协议、Remote Sync、插件、真实 profile、Runtime bridge、安全、TypeScript 与 Rust 全通过；Rust 17 通过、1 个 artifact 测试按设计忽略 |
| Desktop Release | `.app` 与 `.dmg` 构建成功；生产 Remote Sync 配置真实注入 |
| Compose / PostgreSQL | Gateway/Admin healthy；pairing consumed、Token revoked、Runtime online、30 秒 heartbeat 与 Gateway 重启重连均通过 |
| 脱敏记录 | `test-evidence/20260824-T4W-10-gateway-web-e2e/record.md` |

### 下一步

- `T4W-03`、`T4W-05`、`T4W-06` 已关闭。`T4W-10` 仅剩一次性浏览器设备的真实“撤销当前设备并退出”；常用浏览器 installation ID 不用于破坏性验证。
- 完成该一步后关闭 `T4W-04/T4W-10`，再进入 Mobile Auth 产品批次，不继续并行扩张 Gateway 功能。

## 第十五轮：Desktop Gateway 原生入口收口

执行时间：2026-08-24（Asia/Shanghai）

执行范围：补齐 Desktop `File` 菜单入口，统一 Gateway 配置入口名称，并对应用菜单、File 菜单和快捷键执行真实 macOS 验收。

### 实现与验收结果

- 原生入口名称统一为 `Gateway & Remote Sync...`；Tauri 菜单文本使用 `&&` 转义，确保 macOS 实际显示单个 `&`。
- macOS 应用菜单保留配置入口和 `Cmd+,`；`File` 菜单新增同名入口。两个独立菜单 ID 均路由到 `RuntimeManager::show_settings()`。
- 其他桌面平台若默认菜单没有 `File`，启动时补建 `File` 菜单；快捷键放在 File 入口，避免同一菜单树注册重复 accelerator。
- Release Desktop 真实验证应用菜单、`File → Gateway & Remote Sync...`、`Cmd+,` 三条路径，均可从 Harness 返回 Gateway 配置页。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Desktop Rust | 18 通过、0 失败；1 个 artifact 测试按设计忽略 |
| Desktop Release | `tauri build --bundles app` 成功；`.app` 真实菜单验收通过 |
| 全量 bundle | `.app` 已生成；默认全量命令仅在后续 DMG 封装脚本阶段失败，不影响本轮 `.app` 验收，DMG 问题单独跟踪 |

### 下一步

- `T3-09` 的入口可发现性已完全关闭，回到直线任务继续完成 `T4W-10` 剩余的一次性浏览器设备当前设备撤销验收，之后进入 Mobile Auth 产品批次。

## 第十六轮：GW4 隔离浏览器当前设备撤销收口

执行时间：2026-08-24（Asia/Shanghai）

执行范围：完成 `T4W-04/T4W-10` 最后一项真实当前设备撤销；验证隔离会话失效、数据库级联、审计、Desktop Runtime 和其他设备不受影响，并将后续批次切换到 Desktop 状态与 Mobile Auth。

### 真实验收结果

- 在 `http://localhost:7018` 识别当前隔离设备 `dev_30a…9fa4`，设备表格只选中带“当前设备”标识的唯一行。
- 撤销确认明确提示当前 Console 会话会立即退出；确认后页面返回登录入口并显示“当前设备已撤销”，reload 后会话仍无法恢复。
- PostgreSQL 确认目标设备已 revoked、活动 access token 为 0，并写入 `device.revoked` 审计。保留的 refresh session 因 refresh 查询强制 `devices.revoked_at is null` 而不可继续轮换。
- Desktop `dev_7816…422e` 仍 active，`runtime_7a95…f54e` 保持 online，复核时心跳年龄约 0.2 秒；其他活动管理设备未被撤销。
- Admin `7018` 与 Gateway `7019` ready 均为 `ok`，说明撤销只影响目标 installation，不影响服务健康或 PC Runtime。

### 任务结论

- `T4W-04`、`T4W-10` 和 UX3 已完成，Gateway Web 管理端产品批次正式关闭。
- 下一条直线任务调整为 `T3-08` Desktop 远端连接/Runtime online/最近心跳状态；随后执行 `T4-01` 至 `T4-06` Mobile Auth 与产品收口，不继续扩张 Gateway 管理页面。

## 第十七轮：Desktop 远端连接与心跳状态收口

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T3-08`；Remote Sync → Runtime Bridge → Tauri 控制帧 → Desktop 状态页，以及生产 Runtime/profile 升级闭环。

### 实现结果

- Remote Sync Connector 在 `pc.registered` 后立即发送首次 `pc.heartbeat`，保留 30 秒周期心跳；连接状态与实际发送成功的心跳时间分别通过 Harness context 事件发布。
- Runtime Bridge 复用现有 nonce Unix socket，新增严格 `remoteSyncStatus` NDJSON 帧；状态仅允许 stopped/connecting/handshaking/connected/reconnecting，时间戳必须为安全整数且心跳不能晚于观测时间。
- Tauri 控制 listener 校验 Runtime version/API、profile、Harness commit、nonce 和严格字段后更新 `RuntimeSnapshot.remoteSync`；旧观测不会覆盖新状态，Runtime 停止后 Gateway/远端 online 归零并保留最后心跳供诊断。
- Desktop 配置页新增四格状态：Local Runtime、Gateway、Remote Runtime、Latest heartbeat；支持连接、握手、重连、离线和等待首次心跳文案，窄屏退化为单列。
- Runtime 版本升级到 `2026.08.24.1`。构建器保留旧 `2026.08.17.1` 归档并生成新产物；Shell 只向更高 bundled 版本单调升级，不因启动旧 Shell 降级。
- 修复生产 Runtime 升级后持久 Desktop profile 仍使用旧插件副本的问题：版本变化时通过内置 Node/pnpm 强制刷新四个产品包，恢复 base/web/desktop-bundle 固定顺序，保留第三方 bundle，并在成功后写入版本标记。

### 真实验收与质量门

| 验证 | 结果 |
| --- | --- |
| Remote Sync Connector | 12/12 通过；首次 heartbeat、回调和持久 outbox 顺序均覆盖 |
| Runtime Bridge | 真实 Unix socket 通过；ready、showSettings、remoteSyncStatus、heartbeat 和 schema 均覆盖 |
| Desktop Rust | 21 通过、0 失败；1 个需显式 artifact 环境的既有测试按设计忽略 |
| 根 `pnpm check` | 协议、插件、真实 profile、安全边界、TypeScript、Rust fmt/check/test 全通过 |
| Runtime artifact | `2026.08.24.1` / darwin-aarch64，64,832,744 bytes，SHA-256 `01bf9f397b20aff640703f217b3f5fda4a92f40256a96c782e3ee7ad5ddd5825`，目录与归档双重 verifier 通过 |
| Release Desktop | `.app` 构建成功；首次启动自动激活新 Runtime 并刷新持久 profile，current pointer 为 healthy |
| 真实 UI | Harness 常驻入口返回配置页；显示 Local Runtime Ready、Gateway Connected、Remote Runtime Online，Latest heartbeat 从 17:16:40 持续更新到 17:18:40 |
| Gateway/PostgreSQL | `7019 /health/ready` 为 ok；`runtime_7a95…f54e` 为 online，查询时 heartbeat age 为 0 秒 |
| 解除配对边界 | 未破坏真实本机身份；代码路径先停止 Runtime、清理身份/配置并读取 stopped snapshot，状态归零与旧帧拒绝由 Rust 单测覆盖 |

### 任务结论

- `T3-08` 已完成，Desktop Connector 产品任务全部收口；不再扩张 Gateway 或 Desktop 配置功能。
- 下一条直线任务切换为 `T4-01` 至 `T4-04` Mobile Auth 核心：AuthGate、管理员登录/refresh/logout、Gateway origin 恢复与 SecureStore 原子会话。

## 第十八轮：Mobile 产品 UI 文档与原型重排

执行时间：2026-08-24（Asia/Shanghai）

执行范围：重新核对 React Native 当前页面与 DeepSeek Harness 的信息架构差异；先调整功能需求、开发架构、实施计划、任务计划和 HTML 原型，不修改 Mobile 运行时代码。

### 代码事实与重排结论

- 当前 Mobile 的 Session projection、命令、离线恢复、Gateway origin 校验和 access token SecureStore 可以复用，但 `App.tsx` 仍是工程验证入口：手工 token、设备/Runtime 库存优先、平台默认控件、Conversation 与调试事件重复展示，不能作为产品 UI 完成证据。
- Mobile V1 延续 Harness 的 Session、Conversation、Composer、工具摘要和审批心智；布局使用移动端原生 AuthGate、Session 首页/抽屉、全屏 Conversation、固定 Composer/审批接管和设置页，不复制桌面三栏，也不使用 WebView 包装桌面 UI。
- 综合 `prototype.html` 重新标记为 Gateway Web/Desktop 资料；新增 `mobile-prototype.html` 作为 MP-01–MP-05 的独立产品基线，覆盖登录、Session 首页、Conversation、审批、设置和 online/offline/approval 状态。
- 任务计划新增 `T4D-01` 至 `T4D-05` 设计闸门，并把 Mobile 实施扩为 `T4-00` 至 `T4-10`。底层链路、产品 UI、原型和 E2E 的完成状态分开记录。

### 当前状态与下一步

- `T4D-01` 至 `T4D-04` 已完成首版文档和原型；`T4D-05` 处于产品与视觉评审中。
- 下一条直线任务不再是直接执行 `T4-01` Auth 编码。评审通过后先执行 `T4-00`：拆分单体 `App.tsx`，建立 navigation/screens/features/components/theme/services 和 Harness 同源 design token，再按 Auth → Session 首页 → Conversation → Composer/审批 → 设置/诊断实现。

## 第十九轮：Mobile 原型通过与优先执行计划冻结

执行时间：2026-08-24（Asia/Shanghai）

执行范围：确认 Mobile HTML 原型评审结果，关闭 `T4D-05`，修正 Mobile 实现/验证的循环依赖，并把后续产品开发切换为 Mobile 唯一主线。

### 评审与计划结论

- 用户确认 `mobile-prototype.html` 无问题；MP-01–MP-05、Harness 心智映射、Session 首页、Conversation、Composer、审批和设置边界正式冻结，`T4D-01` 至 `T4D-05` 全部完成。
- `T4-05/T4-06` 不再依赖 `T5-01/T5-02` 验证任务。页面直接复用已存在的 Gateway/Connector/Session projection 能力，完成后再由 T5/T7 统一验证，消除循环依赖。
- 当前执行顺序固定为：`T4-00` UI 架构 → origin/SecureStore/AuthGate/登录 → Session 首页 → Conversation → Composer/审批 → 设置/体验门 → Mobile E2E → 发布质量门。
- Gateway Web、Desktop、服务端扩展和 T8/T9 发布任务后置；只允许直接阻断 Mobile P0 的既定契约缺陷、安全/越权、凭据泄漏或数据损坏问题插队。

### 下一步

- 下一条直线任务为 `T4-00`：拆分单体 `App.tsx`，建立 navigation/screens/features/components/theme/services、Harness 同源 design token 和最小基础组件。本批次不改协议或扩张 Gateway/Desktop 功能。

## 第二十轮：Mobile UI 架构与基础组件壳

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4-00`；拆分 React Native 单体入口，建立 UI 分层、Harness 同源主题、最小基础组件和架构回退门禁，不修改协议、Gateway 或 Desktop。

### 实现结果

- `App.tsx` 从 647 行缩减为应用入口；导航、连接、Session 目录和 Conversation screen 分离到 `app/navigation` 与 `screens`。
- 原有连接凭据、ViewerSync/设备清单、SQLite 投影和 command 轮询分别进入 connection/sessions/conversation feature controller；screen 不再直接调用 storage 或 transport。
- 新增 `services/storage` 与 `services/transport` 边界，保留现有同步、补发、命令恢复和安全存储行为，不改公开协议。
- 落地 Harness 同源 neutral-bluish/DeepSeek blue/状态色、间距、圆角、字体和 44×44 触控 token；新增 AppHeader、AppButton/IconButton、Banner、Card、StatusDot、EmptyState 与导航占位，移除 screen 对平台默认 `Button` 的使用。
- 固定 BottomSheet、Composer、ApprovalPanel props 契约；业务组件仍由 T4-05 至 T4-08 对应纵切实现，未在基础批次提前堆入旧工程页面。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 35/35 通过；既有同步/投影/REST/WS 31 项无回退，新增主题、路由、screen 分层与入口边界 4 项 |
| 架构门禁 | screen 禁止直接依赖 `services/sync`，禁止重新引入 React Native 默认 `Button`；`App.tsx` 保持最小入口 |

### 下一步

- `T4-00` 已完成。下一条直线任务为 `T4-03`：把 Gateway origin 从构建默认值/页面状态升级为 SecureStore 可恢复配置，并保持生产 HTTPS、开发 loopback HTTP 与严格 origin 校验；之后执行 `T4-04` 安全会话生命周期。

## 第二十一轮：Mobile Gateway origin 持久恢复与安全校验

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4-03`；把 Gateway origin 从构建默认值/页面状态升级为 SecureStore 可恢复配置，统一 REST/Viewer 校验，并关闭公网 HTTP 和 origin 变更复用旧 token 的缺口。

### 实现结果

- SecureStore 新增版本化 `gateway.origin.v1`；连接成功后同时保存规范化 origin 与开发 access token，启动连接页时先恢复并校验 origin，再开放连接操作。
- 存储中的 origin 若不符合当前构建策略，会回退到安全默认值，并同时清理旧 origin 和旧 access token，避免协议策略从开发 HTTP 切回生产 HTTPS 后继续复用凭据。
- `normalizeGatewayOrigin` 统一校验 REST、Viewer 与连接表单：拒绝用户名/密码、path、query、fragment 和未允许协议；默认值也必须通过同一校验，否则回退到内置 HTTPS origin。
- 显式允许 `http` 时仍只接受 `localhost`、`*.localhost`、`127.x` 与 `::1`，公网/局域网明文 HTTP 在表单和 `GatewayApi` 两层均被拒绝。
- 修改已保存 origin 时立即清除当前 access token，要求为新 Gateway 重新输入凭据；重新连接会 reset Session 导航并重建 Viewer/API 状态，不静默沿用旧连接。
- 启动恢复期间禁用 origin、token 输入和连接按钮；SecureStore 读取/写入失败提供明确提示。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 39/39 通过；新增 origin 规范化、公网 HTTP 拒绝、不安全存储恢复和 origin 变更 token 清理测试 |
| 安全边界 | REST/Viewer/表单共用 origin 规则；origin 与 access token 不进入 SQLite/日志 |

### 下一步

- `T4-03` 已完成。下一条直线任务为 `T4-04`：把现有单 access token 存储升级为 access/refresh 分项、版本化、安全轮换和原子清理的 Mobile 会话边界，为 AuthGate 提供唯一恢复入口。

## 第二十二轮：Mobile SecureStore 版本化会话生命周期

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4-04`；按真实 Gateway Auth 响应建立 Mobile schema v1 会话，完成 access/refresh 分项安全保存、崩溃安全轮换、恢复校验、旧开发 token 兼容和完整清理，不提前实现登录 UI。

### 契约与实现结果

- 对照服务端 `AuthSessionResult` 固定 Mobile 会话字段：Gateway origin、account、device、access/refresh token、两级过期时间和 scopes；密码、prompt、Session payload 与完整事件不进入会话模型。
- SecureStore 使用 `gateway.session.v1.{a,b}.{access,refresh,metadata}` 双槽和 `gateway.session.v1.active` 指针。token 分项保存；metadata 不包含 token，只保存恢复 AuthGate 所需的最小身份与过期信息。
- 登录/refresh 保存时完整写入非活动槽，最后切换 active pointer，再清理旧槽。指针提交前失败仍读取旧的完整一代，不会组合新 access 与旧 refresh；指针提交后新一代立即成为唯一权威。
- 恢复只读取 active 指定槽；缺键、schema 错误、不安全 origin、非法 token/时间/account/device/scope 会触发整会话清理，不回退到可能已被服务端撤销的旧 refresh。
- 退出/撤销清理先删除 active pointer，再清空 a/b 两槽和旧 `gateway.access-token`；即使清理中断，恢复也不会重新激活无 pointer 的残留 token。
- 正式会话中的 Gateway origin 优先于独立未登录 origin key，避免新 token 搭配旧 origin；退出后仍保留独立 origin，符合连接页记住部署地址的产品行为。
- 保留当前开发 token 入口兼容：正式会话优先，写入正式会话会先移除旧开发 token；录入开发 token 会先清除正式 access/refresh，避免两套凭据并存。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 46/46 通过；新增 7 项会话 schema、脱敏 metadata、过期分类、双槽轮换、pointer 故障、坏代和清理测试 |
| 服务端契约 | 已核对 `/v1/auth/login`、`/v1/auth/refresh` 的旋转 token 与过期字段；本轮无需修改服务端 |

### 下一步

- `T4-04` 已完成。下一条直线任务为 `T4-01`：实现受控 Splash/AuthGate 状态机，用 `loadMobileSession` 分类 valid/access_expired/refresh_expired，并在 401、refresh 失败、设备撤销和退出时统一回到未登录态。

## 第二十三轮：Mobile AuthGate 与受保护导航

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4-01`；在正式登录 UI 之前完成启动恢复、Gateway 会话校验、refresh 轮换、logout、撤销回退和导航隔离，保留旧开发 token 兼容但不把正式 token 暴露给输入框。

### 实现结果

- 新增纯 AuthGate 状态机和 React Provider/Boundary。冷启动先显示受控 Splash；安全存储恢复和 Gateway 校验结束前不挂载导航，瞬时网络错误进入独立恢复页，不闪现 Session 页面。
- 有效正式会话通过 `GET /v1/me` 校验 account/device；access 已过期或有效 access 返回 401 时，单飞调用 `POST /v1/auth/refresh`，验证 account/device 未漂移并先完成 SecureStore 双槽轮换，再开放受保护导航。
- refresh 过期、refresh 401、account/device 不一致、REST 认证失败、Viewer `device_revoked` 和退出统一清理本机会话并切回公开导航；远端 logout 失败仍执行本机权威清理。
- 导航改为公开/受保护两棵互斥 Stack：未认证只能进入连接页；已认证从 Session 目录启动。认证状态或凭据代变化会重建导航，旧受保护 history 不会残留。
- Session 目录、库存、历史补发、命令提交和命令恢复的 401/撤销均上收 AuthGate；Viewer 会把协议 `error` frame 转为结构化 `GatewayApiError`，设备撤销可以立即触发退出。
- 开发 token 使用独立 legacy SecureStore 读取函数。连接表单不再通过通用 `loadAccessToken` 读取正式 access token，避免正式凭据回填到 UI；开发入口的生产隐藏和管理员登录表单仍由 `T4-02` 完成。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 56/56 通过；新增 Auth API、启动校验、access/refresh 过期、401 轮换、瞬时故障、不安全 legacy origin、撤销和 Viewer error frame 测试 |
| 服务端契约 | 已核对原生 `/v1/auth/refresh`、`/v1/auth/logout`、`/v1/me` 与 WebSocket `device_revoked`；服务端无需修改 |
| 凭据边界 | React 导航状态不保存原始 token；正式 token 只从 SecureStore 按需读取，连接输入框只读取旧开发 token |

### 下一步

- `T4-01` 已完成。下一条直线任务为 `T4-02`：实现 MP-01 Gateway origin + 管理员账号密码登录/退出，不提供注册，不持久化密码，并将手工 token 收口为显式 debug-only。

## 第二十四轮：MP-01 管理员登录、退出与 debug token 收口

执行时间：2026-08-24（Asia/Shanghai）

执行范围：`T4-02`；把旧 Pairing 工程页替换为 MP-01 正式登录与连接页面，接入原生 DSH Auth login，完成 Mobile installation identity、登录错误、会话激活、退出和生产手工 token 双门禁。

### 实现结果

- `GatewayAuthApi` 新增 `POST /v1/auth/login`，严格提交 `username/password/deviceName/platform/installationId` 并复用 schema v1 会话解析；Gateway origin 继续执行生产 HTTPS/显式 loopback HTTP 规则。
- SecureStore 新增 `gateway.mobile-installation.v1`，首次使用 `expo-crypto` 生成随机 UUID 并稳定复用。installation ID 是设备关联标识，不是 token；logout 只清理会话，不删除 installation，后续登录可复用同一 Mobile Device。
- 新增可单测的管理员登录边界：本地先校验 origin、账号和密码长度；安全存储不可用时不发送密码；成功会话必须持久化后才进入 AuthGate，持久化失败会尽力调用远端 logout，避免留下不可恢复的新 refresh session。
- 新 MP-01 页面按已评审原型提供 Gateway origin、管理员账号和密码，账号默认 `admin`，密码不预填、不持久化；修改 Gateway origin 会清空已输入密码。页面无注册、创建账号或密码修改入口。
- 公开路由由 `Pairing` 改为 `Login`，受保护 Stack 不再包含登录页面；Session 页头提供明确退出，logout 后导航代重建并回到 MP-01。
- 手工 token 兼容入口只在 `__DEV__` 且 `EXPO_PUBLIC_MOBILE_DEBUG_TOKEN=true` 时渲染；AuthGate 的 legacy token 恢复使用同一双门禁，生产构建会清理残留 legacy token，不能通过隐藏输入框继续进入正式流程。
- 401、429、Gateway 不可用、无效响应和安全存储失败使用稳定中文错误，不回显服务端内部认证细节。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 64/64 通过；新增 login 契约、字段前置校验、401/429、存储失败远端退出、debug 双门禁、production legacy 清理和 installation ID 测试 |
| Production Android bundle | `NODE_ENV=production ... expo export --platform android` 通过；930 modules，Hermes bundle 正常生成 |
| Android Debug APK | `./gradlew :app:assembleDebug` 通过；`expo-crypto 14.0.2` 已被 Expo modules 自动链接 |
| 凭据边界 | 密码只存在于登录组件和单次请求输入；正式会话持久化模型不含密码；生产不显示或恢复手工 token |
| 服务端改动 | 无；复用既有 `/v1/auth/login`、`/v1/auth/logout` 与唯一管理员契约 |

### 下一步

- `T4-02` 已完成。下一条直线任务为 `T4-05`：按 MP-02 把现有设备库存优先页面重构为“需要处理 / 最近 Session / PC 紧凑状态”，并建立 Session 抽屉。T7-03/T7-04 保持部分完成，待最新 RN 页面进入 BlueStacks 后重跑。

## 第二十五轮：MP-02 Session 首页与 Session 抽屉

执行时间：2026-08-25（Asia/Shanghai）

执行范围：`T4-05`；把设备库存优先的工程页面替换为正式 Session 首页，并在 Conversation 建立可复用 Session 抽屉。

### 实现结果

- Session 首页按“需要处理 / 最近 Session”分组；待审批和 waiting 状态优先，同组按 `lastActivityAt` 倒序、`sessionId` 稳定排序。整行是 Conversation 导航目标，不再使用行内“查看”按钮。
- 设备与 Runtime 完整清单移出首页，只保留最新在线 Runtime、心跳和 Gateway 状态的 PC 紧凑摘要；无配对 PC、PC 离线、Gateway 重连和库存读取失败均有独立文案与重试入口。
- 继续复用 `ViewerSync` 的 Gateway 不透明游标自动分页、REST history 和 SQLite projection，不新增协议或服务端接口。修正启动顺序，先启动 Viewer 恢复本地投影，再读取目录，避免冷启动短暂空列表。
- Conversation 左上角进入 Session 抽屉；抽屉复用同一投影分组，支持当前项高亮、切换 Session 和返回首页。Android 系统返回在抽屉打开时由 Modal 优先关闭，抽屉关闭后才执行原生页面返回。
- 分组、活动时间、摘要和 PC 状态提取为纯展示模型；新增 SessionRow、PcConnectionStrip、SessionDrawer 和独立 drawer hook，screen 仍不直连 SQLite/transport。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 70/70 通过；新增分组稳定性、相对时间、摘要优先级、在线/offline PC 状态和 MP-02 架构约束 |
| Production Android bundle | `NODE_ENV=production ... expo export --platform android` 通过；935 modules，Hermes bundle 正常生成 |
| 差异检查 | `git diff --check` 通过 |
| 服务端改动 | 无；复用既有 `/v1/sessions` 不透明游标分页、设备/Runtime 列表、SQLite projection 与 Viewer stream |

### 下一步

- `T4-05` 已完成。下一条直线任务为 `T4-06`：把 Conversation 的消息与工程调试事件双列表收敛为 MP-03 单一 Harness 同源事件时间线，补齐流式 assistant、工具/命令安全摘要、未知事件、历史补发和回到底部行为。

## 第二十六轮：MP-03 Harness 同源事件时间线

执行时间：2026-08-25（Asia/Shanghai）

执行范围：`T4-06`；把 Conversation 的消息气泡和“最近事件”调试列表收敛为唯一安全事件时间线。

### 实现结果

- 新增纯 `timeline-model`，将完整聚合消息、最近非消息事件和当前远程命令按 seq 合并。`assistant/chunk`/`assistant/delta` 不再单独渲染，流式内容只保留一个可增量更新的 Harness 消息节点。
- 新增 `EventTimeline`：用户消息、Harness 消息、工具、审批、生命周期、命令和未知事件使用同一滚动面；Header、同步状态和现有控制区移出滚动列表，删除重复“最近事件”调试区域。
- 工具节点可折叠，但展开内容只是固定安全说明；工具参数、路径、环境、结果、命令 payload 和未知 payload 均不进入展示模型。未知事件仍保留事件类型、时间和 seq，便于兼容未来协议。
- 初次进入和历史未完成时显示明确加载/补发状态；位于底部时流式内容自动跟随，用户上滚后停止抢占位置并显示“回到底部”。
- 抽屉 `replace` 切换 Session 时原子清空旧 projection、command、prompt 和状态消息，再加载目标 SQLite 投影，消除跨 Session 内容闪现。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 75/75 通过；新增 seq 合并、chunk 去重、工具/未知事件脱敏、命令安全状态和审批/生命周期摘要测试 |
| Production Android bundle | `NODE_ENV=production ... expo export --platform android` 通过；937 modules，Hermes bundle 正常生成 |
| 差异与文档 | `git diff --check`、`pnpm check:docs` 通过 |
| 服务端改动 | 无；复用既有 Session projection、REST history、Viewer stream 和安全事件数据 |

### 下一步

- `T4-06` 已完成。下一条直线任务为 `T4-07`：实现键盘安全区上方常驻 Composer，收口 prompt/cancel 的 queued/executing/stopping/stale/unknown/offline/retry 状态与重试语义。

## 第二十七轮：常驻 Composer 与远程命令状态

执行时间：2026-08-25（Asia/Shanghai）

执行范围：`T4-07`；在 MP-03 EventTimeline 下方建立键盘安全区常驻 Composer，并收口 prompt/cancel 的提交、执行、停止、失败与恢复语义。

### 实现结果

- 新增 `ConversationComposer`，固定在 Conversation 唯一滚动时间线下方，通过 `KeyboardAvoidingView` 适配软键盘；输入、发送和停止使用稳定尺寸与 44px 触控目标，不把 Composer 放进事件列表。
- 新增纯 `composer-model`，统一 loading、history replay、ready、submitting、queued、executing、stopping、stale、unknown、offline 和 error 展示状态；Runtime 离线、历史未追平或命令状态未知时禁止隐式提交。
- prompt 只有在 Gateway 接受命令后才清空；cancel 即使命令接口已返回 completed，仍保持“停止中”，直到真实 Session turn/end 事件推进投影终态。
- 将命令重试分为两类：网络结果不确定时复用原 commandId/baseSeq/expiry，依赖 Gateway 设备级幂等避免重复执行；stale、offline、rejected 或 expired 等明确结果使用最新 seq 和新 commandId 显式重提。
- Gateway 已接受但状态轮询失败时只刷新原命令，不重新提交。unknown 不自动重放，用户必须先检查时间线，再明确选择重新提交或关闭状态。
- SQLite 仍只保存脱敏命令元数据；待重提的 prompt payload 仅留当前 hook 内存，切换 Session 或关闭状态即清除。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 83/83 通过；新增 Composer 状态、cancel 真实终态、stale 追平门、unknown 明确处理、offline 禁用和幂等重试测试 |
| Production Android bundle | `NODE_ENV=production ... expo export --platform android` 通过；939 modules，Hermes bundle 正常生成 |
| 差异检查 | `git diff --check` 通过 |
| 服务端改动 | 无；复用既有命令提交、按 commandId 查询、设备级幂等和 Session 事件契约 |

### 下一步

- `T4-07` 已完成。下一条直线任务为 `T4-08`：让待审批状态接管 Composer，完成允许一次、拒绝、提交锁、already decided 与真实事件确认；最新 BlueStacks prompt/cancel/approval 回归仍保留到 Mobile 页面纵切完成后统一执行。

## 第二十八轮：MP-04 审批接管与 first-wins 客户端边界

执行时间：2026-08-25（Asia/Shanghai）

执行范围：`T4-08`；让未决审批完全接管 Conversation Composer，完成允许一次、拒绝、提交锁、already-decided 和真实事件确认状态。

### 实现结果

- 新增实现既有 `ApprovalPanelContract` 的 `ApprovalPanel`；projection 存在未决审批时与常驻 Composer 二选一，不再把审批 Card 叠在输入框上方。
- 面板只接收 `approvalId`、`toolName` 和脱敏控制状态，展示固定安全说明；不读取 recent events、工具参数、命令行或 payload，完整操作范围仍要求用户在 PC Harness 核对。
- 新增纯 `approval-model`，覆盖 pending、submitting、queued、executing、confirming、stale、unknown、offline、already-decided 和 error。允许一次/拒绝仅在历史追平、Runtime 在线且没有活动决定时开放。
- 新增 approvalId 同步提交锁，在任何异步操作前 claim；双击、两颗按钮交叉点击和活动审批期间的新决定都会被拦截。锁不因 HTTP accepted 或 command completed 释放，只在真实 projection 的 `approval/decided`/`approval/response` 清除或切换审批后释放。
- Gateway 返回 `approval_already_decided` 时进入不可重试的“已由其他设备处理”，等待真实事件同步；stale 只在 seq 追平后重提原决定，unknown 必须由用户明确重试，网络结果不确定仍复用原 commandId。
- 审批 attempt 只保留 approvalId、outcome 和 commandId 于当前 hook 内存；SQLite 继续不保存审批 payload。普通 Composer 忽略 approval 命令的切换帧，避免 resolved 事件到达时闪现错误状态。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 测试 | 94/94 通过；新增接管、补发/offline 禁用、同步锁、命令关联、提交锁、真实事件确认、already-decided、stale 和 unknown 测试 |
| Production Android bundle | `NODE_ENV=production ... expo export --platform android` 通过；941 modules，Hermes bundle 正常生成 |
| 差异检查 | `git diff --check` 通过 |
| 服务端改动 | 无；复用既有 approval first-wins、409 `approval_already_decided`、命令幂等和真实 Session 事件契约 |

### 下一步

- `T4-08` 已完成。下一条直线任务为 `T4-09`：实现 MP-05 当前账号/Device/scope、Gateway、PC Runtime、Viewer stream、游标/补发和退出的设置与诊断摘要；最新 BlueStacks approval 竞争回归仍在 Mobile 页面纵切后统一执行。

## 第二十九轮：MP-05 设置与诊断摘要代码纵切

执行时间：2026-08-25（Asia/Shanghai）

执行范围：`T4-09`；将 Mobile 设置与诊断从 HTML 原型落为真实 React Native 页面，优先复用现有 AuthGate、Session projection、ViewerSync 和设备/Runtime inventory，不扩张 Gateway Web 已完成的管理职责。

### 实现结果

- 新增受保护导航栈内的 `SessionDirectoryProvider`。`SessionsScreen`、`SessionScreen` 和 `SettingsScreen` 共享同一目录控制器与 ViewerSync，不会因为打开设置页建立第二条 WebSocket。
- 新增 `Settings` 路由和两个入口：Session 首页右上角账号缩写入口；Conversation 顶部设置入口，并把当前 Session 标识作为诊断选择条件传入。
- 新增 MP-05 设置页，展示当前账号、Mobile Device、scope、Gateway origin、PC Runtime/最近心跳、Viewer stream、Session 数量、历史补发数量、当前/最近 `lastSeq` 游标、脱敏诊断错误态和退出登录。
- 新增纯 `settings-model`，只输出界面摘要；不输出 access/refresh token、Session 标题、cwd、本地路径、事件正文、审批 ID、完整设备/Runtime/Session 标识或服务端错误正文。设备标识只保留首尾短片段。
- “设备、Token、PC pairing”在设置页明确回指 Gateway Web；Mobile 不复制管理端能力。诊断刷新调用共享 ViewerSync 的重试路径，避免重复 inventory 请求。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| MP-05 模型/架构测试 | 11 项定向测试通过；覆盖入口、单 ViewerSync、真实 Runtime/account 摘要、游标/补发、安全脱敏和退出 |
| Mobile 全量测试 | 99/99 通过 |
| Production Android bundle | `pnpm --filter @dsh-gui/mobile exec expo export --platform android` 通过；944 modules，Hermes bundle 正常生成 |
| 差异检查 | `git diff --check` 通过 |
| 服务端改动 | 无；继续使用 Gateway `7019` API/WS 和 Admin `7018` 管理边界 |

### 未闭合项与下一步

- `T4-09` 代码纵切已完成，但尚未宣称视觉与真机验收完成。下一轮进入 `T4-10`，检查 320/390/768 宽度、横向溢出、软键盘/安全区、系统返回、屏幕阅读器焦点和深色 token。
- 在 `T4-10` 完成后，集中重跑 BlueStacks 的登录恢复、Session 历史、Runtime offline、approval 竞争、设备撤销/重新登录和 Settings 入口回归。

## 第三十轮：T4-10 Mobile 尺寸、键盘与可访问性质量门

执行时间：2026-08-26（Asia/Shanghai）

执行范围：`T4-10`；补齐 Mobile 页面在 320/390/768 宽度下的布局约束、键盘点击、安全区、系统返回、触控目标与屏幕阅读器边界，并修复 MP-05 早期刷新和深链参数边界。

### 实现结果

- 修复 `useSessionDirectory.retrySync` 在 Viewer 尚未完成初始化时直接返回的问题：只要 inventory refresh 已就绪，设置页的“刷新诊断”仍会刷新真实设备/Runtime 状态；Viewer 可用时继续复用同一条 retry/replay 路径。
- 设置页读取 `route.params?.currentSessionId`，兼容系统恢复或深链没有参数的场景；设置行合并为单一可读摘要，避免状态点、标签和值产生重复读屏焦点。
- 登录页为 Gateway、管理员账号、管理员密码和开发兼容字段补齐稳定 `accessibilityLabel`；Session 抽屉和设置滚动区域使用 `keyboardShouldPersistTaps="handled"`。
- 增加 `t4-10-quality.test.mjs`，固化 44dp 触控目标、Session/Drawer/Composer/Settings 的尺寸约束、SafeArea/KeyboardAvoidingView、Modal 返回优先级、读屏标签和 T4-10 任务追踪断言。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | `pnpm --filter @dsh-gui/mobile typecheck` 通过 |
| Mobile 全量测试 | 104/104 通过 |
| T4-10 定向测试 | 16/16 通过 |
| Production Android bundle | `pnpm --filter @dsh-gui/mobile exec expo export --platform android` 通过；944 modules，Hermes bundle 正常生成 |
| ADB/真机 | 当前无在线 Android/BlueStacks 设备；`adb devices` 无可用目标，因此真机视觉截图、软键盘实际遮挡和 TalkBack/VoiceOver 证据尚未完成 |
| 差异检查 | `git diff --check` 通过 |
| 服务端改动 | 无；Gateway `7019`、Admin `7018` 边界不变 |

### 未闭合项与下一步

- T4-10 的代码和静态质量门已完成，任务保持“部分完成”，不能用静态测试替代真机视觉验收。
- 下一轮在 Android/BlueStacks 设备恢复后执行最新 RN 页面 E2E：登录恢复、Session 历史、Runtime offline、approval 竞争、设备撤销/重新登录、Settings 两个入口、系统返回、键盘和 320/390/768 截图。

## 第三十一轮：Mobile E2E 环境恢复与 Gateway 前置 smoke

执行时间：2026-08-26（Asia/Shanghai）

执行范围：恢复 BlueStacks、启动 Gateway/Admin/Worker、核验 `7019/7018`，并尝试安装当前 RN Development Build；设备可用时执行 T7-03/T7-04/T7-06/T7-07/T7-08 的最新 UI 回归。

### 环境与服务结果

- BlueStacks 实例 `Tiramisu64` 已重新启动；ADB 同时发现 `127.0.0.1:5555` 与 `emulator-5554`，Android boot 状态可见，但两个 target 在文件传输阶段均不稳定。
- Compose 已按现有 `deploy/compose.yaml` 重建，数据库迁移为最新；Gateway `http://127.0.0.1:7019/health/live`、`/health/ready` 和 Admin `http://127.0.0.1:7018/health/ready` 均返回成功。
- Metro 已在 `8082` 运行；ADB reverse 目标只规划为 Gateway `7019` 和 Metro `8082`，Admin `7018` 不用于 Mobile origin。

### Gateway 原生 smoke

- 使用独立 installation `mobile:e2e-local-t4-10` 调用 Gateway `7019`：管理员登录成功，`/v1/me` 返回账号/Device/scope 结构，`/v1/devices` 返回 6 个当前账号设备，`/v1/runtimes` 返回 1 个 Runtime，logout 返回 HTTP `204`。
- access/refresh 原文仅存在于当前 shell 内存，输出和执行记录只保留结构布尔值、数量和状态码；未写入仓库或日志。

### BlueStacks 安装阻塞

- APK `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` 已存在；尝试以 `adb -s emulator-5554 install --no-streaming -r ...` 和 `adb -s 127.0.0.1:5555 install --no-streaming -r ...` 安装均失败。
- 两个 target 均复现：`file_sync_client.cpp:477 protocol fault: failed to read stat response: Undefined error: 0`，此前 streamed/非 streamed 安装也出现 `abb_exec: closed`。这是 BlueStacks ADB file-sync transport 故障，不能据此判断 APK 或 RN 代码失败。
- 未执行会改变账号、设备、Token 或配对状态的 UI 操作；Gateway smoke 使用的会话已 logout。

### 结论与下一步

- T7-03/T7-04 的 Gateway API 前置 smoke 通过，RN 真机 UI 生命周期仍保持部分完成；T7-08 保持阻塞。
- 下一轮先恢复 BlueStacks ADB file-sync（重启实例/ADB 后确认 `adb shell`、`adb push` 和 `adb install` 均稳定），再安装 Development Build 并执行 Settings 两个入口、登录恢复、Runtime/Session、断网补发、approval、设备撤销和 320/390/768 截图。

## 第三十二轮：Android Emulator 最新 Mobile UI 与设备撤销闭环

执行时间：2026-08-26（Asia/Shanghai）

执行范围：改用 Android Studio `Medium_Tablet` AVD，执行 T4-10 视觉补证及 T7-03/T7-04/T7-08；发现并修复 revoked installation 无法重新登录的问题。

### Emulator 与 UI 结果

- AVD `emulator-5554` 为 Android 13 / API 33；Development Build 安装成功，ADB reverse 仅使用 Gateway `7019` 和 Metro `8082`，Admin Web 保持 `7018`。
- MP-01 正确显示 Gateway `http://127.0.0.1:7019`、管理员账号、密码和“登录并连接”，不存在注册或生产手工 token 入口。登录、冷启动安全会话恢复、logout 回 MP-01 和重新登录均通过。
- MP-02 从真实 API 读取 Runtime 和 Session；MP-05 展示当前账号、脱敏 Device、scope、Gateway、Runtime、stream、游标/补发、本机数据边界和退出入口。设置入口及系统返回通过。
- 320dp（720x1600）、390dp（1080x2400）和 768dp（1536x2048）内容态截图通过；未发现横向溢出或控件重叠，320dp 长标题按预期省略。登录软键盘和 accessibility tree 已实测，TalkBack/VoiceOver 实际焦点遍历仍待补。

### 设备撤销缺陷与修复

- 首次撤销 `dev_…a7e5` 后，Gateway 返回 `204`、设备状态变为 revoked，Mobile 自动清会话回 MP-01。随后发现稳定 installation ID 被 revoked Device 唯一索引占用，正确密码也无法重新登录。
- Mobile AuthGate 现在在明确 `device_revoked` 时清除旧 installation ID；普通 logout、refresh 过期和通用认证失败仍保留稳定 installation。
- Gateway Auth repository 在验证正确管理员凭据后，会在同一事务中释放已撤销 Device 的 installation digest，再登记全新 Device；旧 Device、旧 access/refresh 继续保持 revoked，并发登录仍由唯一索引收敛。
- 修复后再次撤销 `dev_…25c7`，离线冷启动回 MP-01；重新登录成功创建 `dev_…53a5`。当前 active Android Mobile 只有 1 个，旧 Mobile Device 均保持 revoked；临时 CLI 控制 Device 已自撤销。

### 质量门与剩余项

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript | 通过 |
| Mobile 全量测试 | 105/105 通过 |
| Gateway/Admin/Worker build | Compose 重建通过；Gateway `7019`、Admin `7018` ready 均为 `ok` |
| 服务端 TypeScript | 通过 |
| PostgreSQL Auth 定向集成 | 隔离数据库通过；撤销后重登记生成新 Device，旧 token 无效、新 token 有效；临时数据库已删除 |
| Gateway Console | 15/15 通过 |
| Gateway 定向 WebSocket 回归 | 全套并发运行出现一次既有 ACK/offline 时序波动；失败用例单独重跑通过 |
| 差异与文档 | 待本轮最终质量门 |

- `T7-04`、`T7-08` 已关闭；`T7-03` 仍缺强制 access 过期后的 refresh 轮换。
- `T7-06` 保持部分完成：AVD 冷启动已从本地 2 条恢复到 7 条并显示 Gateway 已连接，但显式断网后的补发无重复/丢失尚未关闭。
- 运行中动态修改 AVD 分辨率曾触发 Expo SQLite `NativeDatabase.execSync` 空引用和 DevLauncher React Context 错误；每档尺寸改为冷启动后均可渲染，作为开发壳层/动态配置重建风险保留记录。

## 第三十三轮：T7-03 Auth 轮换与 T7-06 显式断连恢复

执行时间：2026-08-26（Asia/Shanghai）

执行范围：在 Android Studio `Medium_Tablet` AVD 上强制当前 Mobile access token 过期，验证正式 refresh 轮换；停止并恢复 Gateway，补充 Viewer stream 显式断连证据。

### T7-03 强制 access 过期

- 测试前当前 active Android Device 为 `dev_…53a5`，数据库仅有 1 个有效 refresh session 和 1 个有效 access token。
- 只把该 Device 当前 token `token_…0e69` 的服务端过期时间调整到当前时间之前，不修改 refresh session；随后冷启动 Development Build。
- AuthGate 未返回 MP-01，首页正常恢复 7 个 Session。数据库显示新 token `token_…7832` 和新 auth session 生效，旧 token 与旧 auth session 均由 refresh 事务撤销。
- 轮换后仍只有 1 个有效 refresh session 和 1 个有效 access token；日志与证据未记录原始 access/refresh token 或密码。`T7-03` 关闭。

### T7-06 显式断连恢复

- 断开前 Settings 显示 Viewer stream 已连接、7 个 Session、无历史补发、最近游标 `seq 135`。
- 停止 Gateway 后，Mobile 首页保留 7 个 Session，并把 PC 状态副文案切换为“Gateway 重连中”；未清空本地投影、未退出登录。
- Gateway 恢复为 healthy 后，Viewer 自动重连；Settings 再次显示已连接、7 个 Session、无历史补发和 `seq 135`，现有投影无重复或丢失。
- 本轮 Desktop Runtime 最后心跳约 26 小时前，离线窗口内无法由真实 Harness 产生新增 Session 事件。因此 `T7-06` 仍为部分完成：显式断连/恢复已验证，离线新增事件的补发无丢失需要先恢复活跃 Desktop Connector。

### 结论与下一步

- `T7-03` 已关闭；`T7-06` 已补齐显式断连、缓存保留和同游标恢复证据，但不把“零新增事件”写成补发通过。
- Gateway 使用 `7019` 且已恢复 healthy，Admin Web 继续使用 `7018`；AVD reverse 为 Gateway `7019`、Metro `8082`。
- 下一条直线任务是恢复 Desktop Connector/Runtime 心跳，在 Viewer 断网窗口产生真实事件并关闭 `T7-06`，随后执行 `T7-07` approval first-wins/already-decided。

## 第三十四轮：T7-06 真实离线事件补发与 Runtime 发布恢复

执行时间：2026-08-26（Asia/Shanghai）

执行范围：恢复生产 Desktop Connector/Runtime，完成真实 Mobile force-stop 离线窗口、事件补发和重复性核验；构建并安装 Runtime `2026.08.26.1`；开始 `T7-07` approval 回归前置检查。

### T7-06 真实离线窗口

- Desktop Release 使用新 Runtime `2026.08.26.1`，Gateway `7019`、Admin `7018` 均 healthy；Runtime 重新连接后心跳恢复，outbox 从 68 条降为 0 条，目标 Session 游标从 41 推进到 92。
- Mobile 完全 force-stop 后，PC Harness 对 `DESKTOP_SYNC_OK` 执行只读 prompt：`Reply exactly T7_OFFLINE_REPLAY_OK and do not run tools.`。Harness 返回精确回复，Mobile 不在窗口内消费实时事件。
- 早期 Connector 只发送实时事件 seq 43+，遗漏本地持久化的 seq 42，Gateway 因 gap 拒绝后续帧；已在 `packages/remote-sync/src/index.ts` 增加按 Session 排序、缺口从 persistence 补齐和连续性校验，并补充回归测试。
- 修复后真实生产 flush 按 seq 42–92 连续发送，共 51 条唯一事件；PostgreSQL `session_events` 查询得到 min=42、max=92、count=51、count(distinct seq)=51，包含 seq 42 `session/end-seed`、user/message、assistant/message。Mobile 冷启动后首页摘要为 `T7_OFFLINE_REPLAY_OK`，Conversation 可见同一轮完整消息。

### Runtime 构建与故障记录

- `pnpm build:runtime`、`pnpm check:bundled-runtime`、完整 `pnpm build` 通过；Release 应用已安装并通过 ad-hoc 签名校验，runtime/current.json 指向 `2026.08.26.1`。
- 安装后首次未连通的原因是 Gateway 容器曾因 V8 heap OOM 退出（约 2GB heap）；重启 `deploy-gateway-1` 后 `/health/ready` 恢复，Connector 自动重连并完成上述 outbox flush。重启后 Gateway 内存约 47MiB，OOM 作为 T8-03/T8-05 故障注入与容量调查项保留，未伪称已解决。

### 结论与下一步

- `T7-06` 已关闭：真实 PC Harness 事件在 Mobile 离线期间产生，恢复后无丢失、无重复且顺序连续。
- `T7-07` 仍为部分完成。prompt/cancel 已通过；Desktop Harness 重启后当前窗口出现空白，尚未得到稳定的真实 `approval/requested`，因此不使用合成帧冒充 approval E2E。下一轮先恢复 Harness UI/approval 触发，再验证 Mobile 的允许一次、拒绝、first-wins 和 already-decided。

## 第三十五轮：Mobile 体验收口与 Release 本机 Gateway 连接修复

执行时间：2026-08-28（Asia/Shanghai）

执行范围：收口 T4-06/T4-10 之后的 Mobile Conversation 体验、长列表性能和 Android Release 本机 Gateway 连接；同步校准 T5-02 证据状态。

### 实现结果

- Harness 回复继续使用结构化 Markdown：标题、列表、引用、代码块、表格、链接、删除线和行内代码均有安全渲染；代码块/表格支持横向滚动，已完成回复提供复制按钮，复制失败有可操作反馈。
- Conversation 时间线使用 FlatList；SQLite 每秒恢复到语义相同的 Session projection 时复用原对象，避免整页重渲染。活动卡片展开状态提升到列表外，虚拟行回收和 Session 切换不会错误保留或丢失展开状态。
- 流式回复自动跟随改为无动画滚动，避免连续 chunk 堆积动画；时间线底部增加 Composer/回到底部按钮避让空间。
- Release Android 主 Manifest 增加受限 `network_security_config`：仅允许 `localhost`、`127.0.0.1`、`10.0.2.2` 和 `10.0.3.2` 的明文 HTTP；公网或局域网 HTTP 仍由基础配置禁止。业务层仍需构建时显式启用 `EXPO_PUBLIC_GATEWAY_PROTOCOLS=http`。

### 质量门

| 验证 | 结果 |
| --- | --- |
| Mobile TypeScript 与协议构建 | 通过 |
| Mobile 全量测试 | 115/115 通过 |
| Android release APK | `./gradlew app:assembleRelease` 通过；APK 已安装到 BlueStacks |
| Release 网络验证 | `adb` 设备访问 `10.0.2.2:7019/health/live` 返回 HTTP 200；应用发起无效测试登录后收到 Gateway 401“管理员账号或密码不正确”，证明请求已到达服务端 |
| 生产 Expo 导出与差异检查 | Expo Android export、`git diff --check` 均通过 |
| CodeGraph | 增量同步完成，索引为最新 |

### 状态校准与下一步

- `T5-02` 关闭：第三十四轮真实离线窗口已按 seq 42–92 连续补发 51 条唯一事件，满足 pause → REST replay → resume 的无跳号、无重复要求。
- `T4-10` 仍保持部分完成，但剩余范围已收窄为 TalkBack/VoiceOver 实际焦点遍历；320/390/768、键盘、安全区、系统返回、accessibility tree 和 Release 网络行为已有证据。
- `T7-07` 仍为 Mobile P0 主线唯一未关闭项：需要恢复稳定的 Desktop Harness `approval/requested` 事件，再验证允许一次、拒绝、双端 first-wins 和 already-decided；禁止使用合成协议帧替代真实 E2E。

## 第三十六轮：T7-07 Harness 审批触发核查

执行时间：2026-08-28（Asia/Shanghai）

执行范围：恢复并操作 Desktop Harness，切换测试会话权限，尝试生成真实 `approval/requested`，并用 Gateway 持久化数据核验审批事件是否产生。

### 结果

- Desktop Harness 重启后 UI 恢复，测试会话 `session-150313e5-6827-4f1a-8fd7-d573a2c5086f` 可操作；当前会话先后记录 `danger-full-access`、`read-only` 权限预设，最终为 `Read Only` / `approval: ask`。
- `str_replace_editor` 创建测试文件的请求被 Desktop 本地工具通道直接执行，没有停在审批面板；临时测试文件已删除，未保留工作区产物。
- 随后提交一次明确的 bash sandbox escalation 请求；Desktop UI 的插件清单显示 `tool-bash` 为停用、`tool-bash-persistent` 为启用。请求最终返回 `posix_spawnp failed`，没有形成可等待的审批请求。
- Gateway PostgreSQL 查询确认该 session 没有 `approval/asked`、`approval/decided` 事件，`approvals` 表为空；因此本轮不计入 approval E2E，不使用合成协议帧冒充真实链路。

### 结论与下一步

- `T7-07` 继续保持部分完成：prompt/cancel 已通过；真实 approval 的允许一次、拒绝、双端 first-wins 和 already-decided 尚未执行。
- 当前阻塞点收窄为 Desktop Harness 发布配置：需要启用并稳定挂载可触发升级审批的工具（bash 或 filesystem mutation），且请求必须在 `approval/requested` 到达后保持 pending，才能继续 Mobile 端验证。
- 在 Harness 配置恢复前，不修改 Mobile approval 代码、不降低审批策略，也不以数据库手工插入或合成帧替代真实 E2E。

## 第三十七轮：T8-01/T8-02 Gateway 安全与脱敏门

执行时间：2026-08-29（Asia/Shanghai）

执行范围：运行 Gateway 认证、IDOR、scope、重放、限流、撤销、命令幂等和审批冲突回归；在容器内运行 PostgreSQL 集成；扫描运行日志与持久化数据中的敏感字段。

### T8-01 结果

- 本地 Gateway 单元/注入回归 `tests/gateway.test.mjs` 共 31 项全部通过，覆盖无注册入口、DSH Auth 登录/refresh/logout、Web Auth cookie、`/v1/me` principal 绑定、账号范围、scope、限流、pairing 单次消费、Session/Viewer、命令幂等、设备撤销、审批冲突和 Runtime 签名校验。
- 容器内 `integration-test` 完整流程通过：Gateway Console 15/15，Gateway 与 PostgreSQL 集成 19 项通过；管理员初始化测试因共享数据库已有管理员按测试设计跳过 1 项。无失败、无取消。
- `postgres:16.4`、Redis、Gateway、Admin、Worker 容器保持 healthy；未修改生产管理员凭据或现有设备/token 数据。

### T8-02 结果

- Gateway 最近 24 小时容器日志未匹配 `password`、refresh/access token、私钥、Bearer 原文或 Web refresh cookie 等敏感输出模式。
- PostgreSQL 校验通过：access token 仅保存 64 位 SHA-256 digest，refresh session 仅保存 digest，密码字段均为 `scrypt$` 摘要格式；审计 metadata 与 Session event JSON 未出现密码、token 或私钥字段。
- 既有代码中的 token 一次性展示、HttpOnly refresh cookie、审计 metadata 裁剪和 Mobile 安全 projection 约束保持不变。

### 结论与下一步

- `T8-01`、`T8-02` 关闭。T8 剩余为 Gateway/Worker/Redis/PostgreSQL 故障注入、备份恢复/回滚和长连接容量压测。
- 本轮发现 `gateway-console` 本地构建仍受当前 i18n 工作区改动阻塞（`apps/gateway-console/src/App.tsx` 中 `t` 未定义/参数不匹配）；容器镜像内构建和 15 项 Console 测试通过，问题留给 i18n 变更责任边界处理，不在本轮安全门中擅改。

## 第三十八轮：T8-03 服务故障注入与自动恢复加固

执行时间：2026-08-29（Asia/Shanghai）

执行范围：对 Gateway、Worker、Redis、PostgreSQL 做真实容器级重启/进程退出注入，检查健康接口、数据状态和 Compose 恢复策略。

### 注入结果

- Gateway、Worker、Redis 单服务重启后容器恢复运行，Gateway `/health/live` 与 `/health/ready` 返回 200；Redis 重启期间捕获到短暂连接失败日志，恢复后未形成持续错误。
- PostgreSQL 重启期间 Gateway/Worker 曾退出，Gateway 健康接口短暂返回 000；恢复数据库后重新启动 Gateway/Worker，健康接口恢复 200。`session_events` 行数保持 15021，未见数据丢失。
- 在 `deploy/compose.yaml` 中为 Gateway、Admin、Worker 增加 `restart: unless-stopped`。随后终止两个服务的 PID 1，二者均进入 `restarting`，重启计数各增加 1，并在下一轮轮询恢复 `running`，Gateway 健康接口恢复 200。
- 另行执行的显式 `docker kill` 会按 Docker `unless-stopped` 语义保持容器停止；这是运维人员明确停止的预期行为，不作为进程崩溃自动恢复失败的证据。服务已重新拉起并保持 healthy/running。

### 结论与下一步

- T8-03 关闭“单服务重启、依赖短暂不可用、进程退出自动拉起”和数据持久性验证；当前状态标记为部分完成。
- 仍需完成 T8-04 的备份恢复、Redis 重建和镜像回滚，以及 T8-05 的长连接、P95 延迟、seq gap 和资源曲线压测；这些结果完成后再决定是否关闭 T8-03/T8 故障门。

## 第三十九轮：T8-04 备份恢复与 Redis 重建验证

执行时间：2026-08-29（Asia/Shanghai）

执行范围：验证当前部署是否能导出 PostgreSQL/Redis 备份，并在隔离目标中恢复，不覆盖现有数据卷。

### 验证结果

- 使用 PostgreSQL 容器内的 `pg_dump -Fc` 导出 custom dump，文件约 505 KB，`pg_restore --list` 可列出 100 个对象；恢复到临时数据库后，`accounts=2`、`devices=18`、`session_events=15021`，随后已删除临时数据库。
- 使用 Redis `redis-cli --rdb` 导出快照约 172 bytes；以独立 Redis 7.4 实例加载该 RDB 后 `PING=PONG`、`loading:0`，快照可读且未触碰现有 `redis-data` 卷。当前实例没有业务 key，因此隔离实例 `dbsize=0` 与现状一致。
- `docker compose -f deploy/compose.yaml config` 校验通过。Redis 基础镜像继续使用固定 digest；Gateway 当前为本地构建镜像，尚未准备上一版本候选 digest，因此本轮不执行无依据的镜像回滚。

### 结论与下一步

- T8-04 的 PostgreSQL 备份恢复、Redis RDB 重建和 Compose 配置可重复性验证完成，任务保持部分完成。
- 仍需准备并登记候选 Gateway/Worker 镜像 digest，执行一次回滚及回滚后迁移/健康检查，再关闭 T8-04；随后进入 T8-05 长连接和事件延迟压测。

## 第四十轮：T8-05 Gateway HTTP 容量基线

执行时间：2026-08-29（Asia/Shanghai）

执行范围：在当前本地 Compose 部署上对 Gateway 健康接口执行固定并发基线，记录请求延迟与核心容器资源；不将健康接口结果视为 WebSocket 长连接验收。

### 基线结果

- 并发数 60，总请求数 1200，交替访问 `/health/live` 与 `/health/ready`；成功 1200、失败 0，总耗时约 547.4 ms。
- 延迟：P50 17.96 ms，P95 66.56 ms，P99 97.10 ms，最大 102.78 ms。
- Gateway 内存由约 41.73 MiB 上升到 45.04 MiB；Worker 约 33.88 MiB，PostgreSQL 约 70.08 MiB，Redis 约 9.98 MiB。测试后服务保持 healthy/running，Gateway live/ready 仍为 200。

### 结论与下一步

- T8-05 的 HTTP 健康检查基线完成，任务保持部分完成。
- 仍需执行真实 WebSocket 长连接分层压测，记录连接数、事件端到端延迟、P95/P99、seq gap、断线重连和资源曲线；10,000 连接目标未在本轮宣称达标。

## 第四十一轮：T8-05 Viewer WebSocket 分层连接基线

执行时间：2026-08-29（Asia/Shanghai）

执行范围：使用现有 active Mobile Device 临时签发 `session.read` token，对生产形态 Gateway `/v1/stream` 建立 Viewer WebSocket 分层连接；连接结束后撤销 token，不发送业务订阅或事件帧。

### 基线结果

- 100 条连接：100/100 握手成功，失败 0；建立耗时约 601.5 ms，握手延迟 P50 218.71 ms、P95 562.26 ms、P99 573.29 ms。
- 300 条连接：300/300 握手成功，失败 0；建立耗时约 242.2 ms，握手延迟 P50 169.66 ms、P95 203.80 ms、P99 209.06 ms。
- 每层连接保持约 3 秒后全部关闭；Gateway 无新增 error/warn/overload 日志。测试期间 Gateway 约 54.46 MiB、Worker 约 33.72 MiB、PostgreSQL 约 56.47 MiB、Redis 约 9.54 MiB。
- 临时 token `token_de9c2f1edc644e41971586ee6ef493f9` 已在测试后撤销；数据库核对其 `revoked_at` 已写入，未留下可继续使用的压测凭据。

### 结论与下一步

- T8-05 的 Viewer WebSocket 100/300 连接握手和保持连接基线完成，任务保持部分完成。
- 尚未验证真实 PC Harness 事件链路下的端到端延迟、seq gap、断线重连补发和 10,000 连接目标；这些需要真实事件生产端与更长时间的分层压测。

## 第四十二轮：T8-05 真实 Harness 事件延迟与 seq 连续性探针

执行时间：2026-08-29（Asia/Shanghai）

执行范围：针对当前在线 Desktop Runtime 的真实 Session，临时签发 `session.read,session.control` token，提交一次固定只读 prompt，观察 Gateway/PostgreSQL 中的真实事件时间和命令状态；测试后撤销 token。

### 探针结果

- 目标 Session 提交前 `last_seq=5797`；命令 `capacity_probe_1787972695` 返回 HTTP 202，最终状态 `completed`。
- Gateway/PostgreSQL 收到连续 `seq=5798..5823` 共 26 条事件，包含 `user/message`、assistant 流式 chunk、聚合 `assistant/message`、`step/end` 和 `turn/end`，未发现 seq gap 或重复。
- 以 Gateway 接受命令时间为起点，首个 `assistant/chunk` 入库约 1.49 秒；最终聚合 `assistant/message` 入库约 5.83 秒；`turn/end` 约 6.35 秒。
- 测试 prompt 要求 Harness 原样回复固定探针文本且不运行工具；未触发审批或外部工具。临时 token `token_957ef7a8cb9241859443b5cd54f9e02b` 已撤销，数据库已核对 `revoked_at`。

### 结论与下一步

- T8-05 的真实单次事件端到端链路、命令完成和 seq 连续性探针完成；任务保持部分完成。
- 单次探针不代表延迟 P95/P99 或容量达标。仍需多轮事件样本、断线重连补发、事件延迟分布和更高连接层级压测；10,000 连接目标未宣称达标。

## 第四十三轮：T8-05 多样本 Harness 事件延迟分布

执行时间：2026-08-29（Asia/Shanghai）

执行范围：在同一在线 Desktop Runtime/Session 上连续提交 5 个固定只读 prompt，记录 Gateway 接受命令到 PostgreSQL 收到首个流式事件、聚合消息和 `turn/end` 的耗时，并校验每段 seq 连续性。

### 样本结果

- 5/5 命令返回 HTTP 202 并最终 `completed`；每段事件 seq 均连续，无重复或 gap。各样本首个流式事件延迟为 `3702/4868/4489/4889/5296 ms`，聚合消息延迟为 `4142/5683/5174/5612/5821 ms`，终态延迟为 `4469/6224/5668/6129/6195 ms`。
- 小样本（n=5）经验 P95 取最大观测值：首个 `assistant/chunk` 约 `5.30 s`，聚合 `assistant/message` 约 `5.82 s`，`turn/end` 约 `6.22 s`。这些时间包含 Harness 执行、Connector、Gateway 和 PostgreSQL 入库，不是纯网络 RTT，也不作为 10,000 连接容量承诺。
- 测试使用的临时控制 token `token_c8cedd5844c748e1a87a791d601b22ce` 已撤销；5 个探针均要求不运行工具，未触发审批。测试后 Gateway、Worker、PostgreSQL、Redis 保持 healthy/running。

### 结论与下一步

- T8-05 的真实事件多样本延迟和 seq 连续性完成，任务保持部分完成。
- 仍需验证 Viewer/PC 断线重连后的 REST replay/resume、长时间连接资源曲线和更高连接层级；在有足够样本前不关闭容量门，也不宣称 10,000 连接达标。

## 第四十四轮：T8-05 Viewer 断线与 cursor resume 探针

执行时间：2026-08-29（Asia/Shanghai）

执行范围：使用临时 `session.read` token 建立 Viewer stream，先从现有 Session 的 `seq=5960` 订阅历史，再主动断开并重新连接，通过 `cursor.resume(lastSeq)` 验证补发边界和重复抑制。

### 探针结果

- 首次订阅收到 `session.event` 的 `seq=5960..5963` 共 4 条，范围连续。
- 主动关闭连接后重新完成 `client.hello`，发送 `cursor.resume(lastSeq=5963)`；等待 1.5 秒未收到事件，说明已消费到最新游标时不会重复补发。
- 临时 token `token_51a70c4ea5534a6e8dc3f63246fa3b2a` 已撤销；测试后服务保持 healthy/running。

### 结论与下一步

- T8-05 的 Viewer 断线、重连和 cursor resume 边界探针完成，任务保持部分完成。
- 仍需在更高连接层级和更长持续时间下采集资源曲线，并用真实事件生产持续测量延迟分布；10,000 连接目标仍未执行。

## 第四十五轮：T8-05 500/1000 Viewer 长连接基线

执行时间：2026-08-29（Asia/Shanghai）

执行范围：使用临时 `session.read` token 对 Gateway `/v1/stream` 建立 500 和 1000 条 Viewer WebSocket 连接；每层保持约 10 秒后全部关闭，不发送订阅或业务事件。

### 基线结果

- 500 条连接：500/500 握手成功，失败 0；建立耗时约 5.01 秒，握手延迟 P50 2.86 秒、P95 4.74 秒、P99 4.87 秒，全部保持 10 秒后关闭。
- 1000 条连接：1000/1000 握手成功，失败 0；建立耗时约 7.09 秒，握手延迟 P50 3.32 秒、P95 6.60 秒、P99 6.95 秒，全部保持 10 秒后关闭。
- 500 层结束后 Gateway 内存约 61.34 MiB；两层连接关闭并完成 GC 后当前约 44.55 MiB。Worker、PostgreSQL、Redis 未见异常资源增长；测试后 Gateway/Admin/Worker/PostgreSQL/Redis 保持 healthy/running。
- Gateway 最近 15 分钟日志未出现 error、warn、overload、exception 或连接限流异常；临时 token 已由退出清理逻辑撤销并核对。

### 结论与下一步

- T8-05 的 500/1000 Viewer 长连接建立、保持和释放基线完成，任务保持部分完成。
- 该结果只证明本机当前部署在 1000 条短时连接下可工作，不代表 10,000 连接目标或生产容量达标。仍需长时间保持、真实事件广播下的端到端延迟/seq gap、断线重连，以及 5,000/10,000 分层压测。

## 第四十六轮：T8-05 2000 Viewer 突发连接边界

执行时间：2026-08-29（Asia/Shanghai）

执行范围：在 1000 条连接基线后，突发建立 2000 条 Viewer WebSocket；每条连接只完成 `client.hello` 握手并保持约 10 秒，不发送订阅或业务事件。

### 边界结果

- 2000 条连接中 1774 条握手成功、227 条在 15 秒握手窗口内超时，成功率约 88.7%；已成功连接全部保持约 10 秒后关闭。
- 建立期间 Gateway 内存由约 59.53 MiB 上升到 85.10 MiB；连接释放后约 20 秒回落到 66.48 MiB。Worker、PostgreSQL、Redis 无异常资源增长。
- Gateway 最近 30 分钟日志未出现 error、warn、overload、exception 或连接限流异常；容器始终 healthy/running，live/ready 均为 200。宿主机连接在测试结束后回落，没有观察到连接泄漏。
- 失败集中表现为突发握手超时，当前证据不足以区分宿主机 accept/backlog、Node 事件循环排队或客户端建连突发造成的排队；本轮不提高系统参数、不修改 Gateway 限制，也不宣称 2000 连接达标。
- 临时 `session.read` token 已由退出清理逻辑撤销，未产生业务事件。

### 结论与下一步

- T8-05 的 2000 条突发连接测试未通过“全量握手成功”门槛；当前可确认稳定基线为短时 1000 条，2000 条需要分批 ramp-up 或连接建立限速策略后重新测量。
- 仍需在解释握手超时原因后执行 2000/5000/10000 分层、长时间保持、真实事件广播和资源曲线测试；容量门保持开启。

## 第四十七轮：T8-05 分批 ramp-up 至 10000 Viewer 连接

执行时间：2026-08-30（Asia/Shanghai）

执行范围：针对第四十六轮发现的瞬时突发握手超时，使用每批 100 条连接的受控 ramp-up，批次间隔 200ms（5000）或 150ms（10000），只完成 Viewer `client.hello` 握手并保持约 10 秒，不发送订阅或业务事件。

### 分层结果

- 2000 条 ramp-up：`2000/2000` 成功，失败 0；总建立耗时约 10.40 秒，握手 P50 81.90ms、P95 630.20ms、P99 1.04s；保持 10 秒后全部关闭。
- 5000 条 ramp-up：`5000/5000` 成功，失败 0；总建立耗时约 14.84 秒，握手 P50 57.90ms、P95 101.68ms、P99 275.82ms；保持 10 秒后全部关闭，Gateway 峰值约 145.9 MiB。
- 10000 条 ramp-up：`10000/10000` 成功，失败 0；总建立耗时约 42.68 秒，握手 P50 75.23ms、P95 550.08ms、P99 649.64ms；保持 10 秒后全部关闭，Gateway 峰值约 194.2 MiB。
- 10000 连接释放后 Gateway 约 85.7 MiB、`/proc/net/tcp` established 仅 7 条；服务保持 healthy/running，live/ready 均返回 200，最近 20 分钟无 error、warn、overload、exception 或 OOM 日志。
- 2000 条瞬时并发仍有 227 条握手超时；因此结论是当前部署支持“受控 ramp-up 的 10000 条短时连接”，不支持无节制瞬时突发建连。未提高宿主机 fd/backlog 参数，也未修改 Gateway 业务限流。
- 10000 连接测试使用的临时 `session.read` token 已在退出清理中撤销，未发送业务事件。

### 结论与下一步

- T8-05 的 2000/5000/10000 受控 ramp-up 建连、保持和释放验证完成；短时 10000 连接目标在当前本地部署下通过。
- 容量门仍不关闭：需要长时间（至少分钟级）保持、真实事件广播下的端到端延迟/P95/P99、seq gap、断线重连，以及瞬时突发失败时的连接建立退避策略评估。

## 第四十八轮：T8-05 10000 Viewer ramp-up 连接验证

执行时间：2026-08-30（Asia/Shanghai）

执行范围：针对瞬时突发连接失败，使用每批 100 条、批次间隔 150ms 的 ramp-up 建立 10000 条 Viewer WebSocket；每条只完成 `client.hello` 并保持约 10 秒，不发送订阅或业务事件。

### 验证结果

- `10000/10000` 握手成功，失败 0；总建立耗时约 42.68 秒，P50 75.23ms、P95 550.08ms、P99 649.64ms，最大 835.05ms。
- 全部连接保持约 10 秒后关闭。Gateway 峰值约 194.2 MiB；连接释放后约 30 秒降至 85.7 MiB，`/proc/net/tcp` established 仅 7 条，未观察到连接泄漏。
- Gateway、Admin、Worker、PostgreSQL、Redis 保持 healthy/running，live/ready 均为 200；最近 20 分钟无 error、warn、overload、exception 或 OOM 日志。
- 临时 `session.read` token 已撤销，未产生业务事件。此前 2000 条瞬时并发仍有 227 条握手超时，因此 ramp-up 通过不等于瞬时突发通过。

### 结论与下一步

- T8-05 的 10000 条受控 ramp-up 建连、保持和释放验证完成；当前本地部署在受控建立速率下达到 10000 条短时连接目标。
- 容量门仍保持开启：需要分钟级以上长时间保持、真实事件广播期间的端到端延迟/P95/P99、seq gap、断线重连，以及针对瞬时突发握手超时的退避/限速方案评估。

## 第四十七轮：Mobile 交互升级设计批次 UXI-01/UXI-02

执行时间：2026-08-29（Asia/Shanghai）

执行范围：按 [interaction-upgrade-plan.md](interaction-upgrade-plan.md) 执行按钮行为矩阵和 Mobile HTML 原型更新；本轮不修改 React Native 运行时代码，UXI-03 评审冻结保留给用户确认。

### 结果

- UXI-01 已完成：新增按钮行为矩阵，覆盖 Primary、Secondary、Ghost/Icon、Destructive、Inline action 五类，并明确默认、按下、进行中、完成和失败/阻断状态；补充到 RN 组件、文案和入口映射。
- UXI-02 已完成初版：`mobile-prototype.html` 的登录、Session 行、图标入口、Conversation 发送、Approval 决策和退出按钮已区分主次/危险层级，并增加 hover/active/disabled 反馈。
- Conversation 非流式 Harness 回复已增加“复制”inline action；点击后显示“已复制”，尝试使用浏览器剪贴板，并在原型环境不可用时仍展示可评审的成功反馈。
- Composer 发送按钮在输入为空时禁用；输入后启用，发送后恢复禁用；Approval 两个决策按钮提交后锁定并显示已提交/已拒绝。

### 验证

| 项目 | 结果 |
| --- | --- |
| `pnpm check:docs` | 通过；34 个 Markdown 文件 |
| `git diff --check` | 通过 |
| 原型 HTML 结构检查 | 通过；关键 `data-*` 入口、复制状态、发送禁用状态和审批锁定逻辑存在 |

### 下一步

- UXI-03 待用户评审：确认 Primary 唯一性、复制按钮默认显示形式、Approval 决策层级和 Toast/震动取舍。
- 评审通过后再进入 UXI-04 至 UXI-07 React Native 组件批次。

## 第四十八轮：Mobile 交互升级组件批次 UXI-04 至 UXI-07

执行时间：2026-08-29（Asia/Shanghai）

执行范围：按已确认的 UXI-01/UXI-02 默认决策进入 React Native 组件批次；实现共享按钮 busy 语义、消息复制反馈、Composer 异步操作优先级和 Approval 提交反馈，不扩张页面信息架构或同步协议。

### 实现结果

- `AppButton` 新增 `loading`，统一映射 `ActivityIndicator`、`accessibilityState.busy` 和 disabled 行为；loading 不改变按钮尺寸。
- `IconButton` 新增 `busy`，忙碌时使用稳定的进度指示并锁定重复触发；保留 44dp 触控目标。
- `CopyButton` 增加复制中锁定、成功色、失败色、动态读屏反馈和可重试状态；流式 assistant 回复继续隐藏复制入口，代码块保留独立复制。
- Composer 的重试动作使用 loading 状态；状态文本增加 `accessibilityLiveRegion="polite"`；发送/停止的主次关系和命令状态机不变。
- Approval 的重试、拒绝和允许一次动作使用 loading 状态；状态文本增加动态读屏反馈；first-wins、already-decided 和真实事件确认仍由既有 approval model/controller 负责。
- 新增 `apps/mobile/tests/interaction-quality.test.mjs`，固化 UXI-04 至 UXI-07 的共享组件、复制入口、Composer/Approval 和设计决策契约。
- 修复 `ui-architecture.test.mjs` 中 MP-05 测试缺失 `controller` 局部变量的问题；该修复只恢复测试自身的作用域，不改变产品代码。

### 验证

| 项目 | 结果 |
| --- | --- |
| `pnpm --filter @dsh-gui/mobile typecheck` | 通过 |
| `pnpm --filter @dsh-gui/mobile test` | 通过；124/124 |
| `pnpm check:docs` | 通过；34 个 Markdown 文件 |
| `git diff --check` | 通过 |

### 下一步

- UXI-08：优化 Session 首页、连接摘要、抽屉和底部导航的行动层级。
- UXI-09：完成离线/恢复的统一禁用原因、恢复动作和 Toast 规范。
- UXI-10/UXI-11：补 TalkBack/VoiceOver 高频流程与 320/390/768 真机交互回归。

## 第四十九轮：Mobile 交互升级验收批次 UXI-08 至 UXI-09

执行时间：2026-08-29（Asia/Shanghai）

执行范围：优化 Session 首页和抽屉的行动层级，并把连接、同步、设备/Runtime 读取异常的恢复入口统一为就近的 Secondary retry；不改变 ViewerSync、命令提交、审批 first-wins 或离线不自动重放语义。

### 实现结果

- Session 首页的连接异常、同步异常和设备/Runtime 读取异常均在对应 Banner 内提供恢复动作，按钮沿用 `刷新同步` / `重试 PC 状态` 文案，并使用共享 `loading` 状态锁定重复触发。
- 历史补发状态显示为信息 Banner，历史补发完成显示为成功 Banner；同步失败才提供重试入口，避免在恢复态重复触发网络请求。
- Session 抽屉按“需要处理 → 最近 Session”分组展示并显示数量，仍保持整行进入 Conversation；当前 Session 通过无障碍 selected 状态明确标识。
- `Banner` 增加 action 容器布局，避免恢复按钮与状态说明脱节；`SessionRow` 补充选中语义，提升 TalkBack/VoiceOver 遍历可理解性。
- 新增交互质量契约测试，覆盖首页/抽屉优先级、恢复动作一致性、成功/补发状态色调和动态反馈。

### 验证

| 项目 | 结果 |
| --- | --- |
| `pnpm --filter @dsh-gui/mobile typecheck` | 通过 |
| `pnpm --filter @dsh-gui/mobile test` | 通过；126/126 |
| `pnpm check:docs` | 通过；34 个 Markdown 文件 |
| `git diff --check` | 通过 |

### 下一步

- UXI-10：在真机上完成 TalkBack/VoiceOver 高频流程验收，记录焦点顺序和动态状态播报。
- UXI-11：补齐 320/390/768dp、键盘、安全区、横竖屏和网络切换的交互回归证据。

## 第五十轮：Mobile 交互验收门 UXI-10 至 UXI-11

执行时间：2026-08-29（Asia/Shanghai）

执行范围：完成高频流程的无障碍语义回归和多尺寸/环境回归矩阵；补齐登录、设置异步按钮的共享 loading 反馈，不改变认证、导航、命令或同步协议。

### 实现结果

- 登录主按钮、开发凭据按钮和设置诊断刷新按钮接入共享 `loading` 语义，恢复/提交期间保持稳定尺寸并锁定重复触发。
- 新增 UXI-10 无障碍回归契约：验证登录字段、Session 导航、Conversation Composer、复制、Approval、抽屉关闭和系统返回的 label/role/state/live region。
- 新增 UXI-11 响应式回归契约：固定 320/390/768dp、键盘、安全区、横竖屏和网络切换检查项，并将自动化与真机证据分开记录。
- 新增 [Mobile 交互验收矩阵](mobile-qa-matrix.md)，作为后续 Android TalkBack、iOS VoiceOver 和 BlueStacks 截图/录屏的统一记录模板。
- 已执行 `pnpm --filter @dsh-gui/mobile android`：Gradle Debug APK 构建成功（`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`，约 55MB），但安装/启动阶段因 `127.0.0.1:5555` 与 `emulator-5554` 变为 offline 中断；未将该次尝试计入真机通过证据。
- 后续 ADB 重连后已成功安装同一 APK 到 `emulator-5554`，并通过 Expo Dev Client 启动 Metro bundle；Android UI 树确认 Session 首页、Conversation、抽屉、连接摘要、发送/停止按钮和设置入口均可见，连接摘要无障碍描述已从 `Gateway [object Object]` 修复为 `Gateway 已连接`。本次模拟器未启用 TalkBack，仅计入 Android 启动/UI 树 smoke evidence。

### 验证

| 项目 | 结果 |
| --- | --- |
| `pnpm --filter @dsh-gui/mobile typecheck` | 通过 |
| `pnpm --filter @dsh-gui/mobile test` | 通过；129/129 |
| `pnpm check:docs` | 通过；35 个 Markdown 文件 |
| `git diff --check` | 通过 |

### 剩余风险

- Android UI smoke 已完成，但 TalkBack/VoiceOver 焦点遍历、键盘动画、横竖屏和网络切换仍需现场验证。
- Android 模拟器曾被 ADB 发现但在首次安装阶段断开，重连后已完成安装与启动；仍需启用 TalkBack 并执行完整焦点遍历、键盘/旋转/网络切换截图或录屏。
- 静态门只能证明组件语义和布局约束存在，不能替代真实屏幕阅读器或视觉截图证据。
