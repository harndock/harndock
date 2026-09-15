# 插件中心功能开发详细文档

版本：0.8
状态：V1 GitHub 分发方案，管理端来源复核、审计和基础 Worker 巡检已接入
更新时间：2026-09-06

## 1. 文档目标

本文将插件中心原型拆解为可以开发、联调和验收的功能规格。V1 是内容发布平台，不是对象存储、交易或远程任务平台：管理端维护插件目录和 GitHub Release 元数据，公共前端展示已发布内容，Desktop 从 Center API 获取安装声明后直接从 GitHub Releases 下载并完成本地安装。

## 2. 工程归属

插件中心使用独立工程 `<dsh-center-plugin-repo>`，沿用 `dsh-sync-server` 的 pnpm workspace、TypeScript/Fastify、React/Vite、PostgreSQL/Redis、SQL migration、测试和 Compose 组织方式。

| 工程 | V1 职责 |
|---|---|
| `dsh-center-plugin` | Center API、公共 Marketplace、Center Admin、Catalog、GitHub Release 元数据、审核发布和审计 |
| `dsh-gui` | Desktop 插件中心页面、GitHub 下载、签名/哈希校验、本地安装和 Runtime 集成 |
| `dsh-sync-server` | V1 不修改，不承载插件市场和远程安装 |
| Mobile | V1 不接入，V2 再做许可证、设备和任务查看 |

三者可以复用工程模式，但不得共用数据库、管理员账号、Session、refresh token 或签名密钥。

## 3. V1 功能范围

### 3.1 Center Admin

- 创建、编辑插件条目。
- 录入公开 GitHub 仓库和 Release Tag。
- 选择 Release Asset 和 Manifest Asset。
- 读取并校验 GitHub Release 元数据。
- 校验 Plugin ID、版本、平台、Runtime API、权限、哈希和签名。
- 保存草稿、提交审核、发布、下架。
- 查看版本状态和内容审计。

V1 不从管理端向 Center 上传插件包。安装包由发布者先上传至 GitHub Release。

管理端真实页面位于 `dsh-center-plugin/apps/center-admin`。当前已实现内容总览、插件条目、版本审核、工件与签名、发布记录五个独立视图；管理员密钥只保存在浏览器 `sessionStorage`，连接、401、加载失败和空数据都有明确状态。插件条目页支持名称、作者、Plugin ID 和简介搜索，支持状态、分类筛选，以及新建、编辑、详情和版本列表。

插件创建和编辑由服务端执行运行时校验，不能仅依赖 HTML 表单：`pluginId`、`slug`、名称、作者、分类和简介必须合法且非空；描述和图标可选；图标仅接受 HTTP(S) URL 或 `null`。Plugin ID 或 Slug 冲突返回稳定错误码，更新时允许显式清空图标。版本审核保存结构化校验结果；工件与签名页支持对历史版本调用重新校验接口并刷新检查时间、失败原因和来源状态；发布记录页支持按插件、版本、动作、actor 和时间筛选审计事件，并展开查看事件 ID 和元数据。

### 3.2 Public Marketplace

- 精选、分类、搜索和分页。
- 插件详情、版本、兼容性、权限和 GitHub 来源展示。
- 只返回已经发布且来源状态不是 `failed` 的插件和版本。
- 提供“在 Harndock Desktop 中打开”的 `harndock://plugins/{pluginId}` 深链，不在浏览器执行本地命令、下载或安装。

Marketplace 静态页面通过构建变量 `VITE_PUBLIC_CENTER_API_ORIGIN` 请求公开 Center API；Docker Compose 使用 `PUBLIC_CENTER_API_ORIGIN` 将该值注入前端构建，避免在管理端 `7118` 上错误请求相对路径。

### 3.3 Desktop Plugin Center

- 从 Center API 拉取目录和版本声明。
- 根据平台选择 GitHub Release Asset。
- 下载到 staging 目录，支持重试和失败清理。
- 校验 Manifest、SHA-256、签名、平台和兼容性。
- 展示 Host/Client 权限并等待用户确认。
- 调用本地 Plugin Manager 安装、启用、更新、卸载和回滚，并读取本机已安装版本状态。

当前 Desktop 的固定 Tauri 命令为 `plugin_marketplace_list(query)`、`plugin_marketplace_detail(pluginId)`、`plugin_download_start(pluginId, version)`、`plugin_download_status(taskId)`、`plugin_download_cancel(taskId)`、`plugin_install_preflight(taskId)`、`plugin_install(taskId)`、`plugin_installed_list()`、`plugin_rollback(pluginId)`、`plugin_enable(pluginId)`、`plugin_disable(pluginId)` 和 `plugin_uninstall(pluginId)`。前端只传查询词、插件 ID、版本或由 Rust 创建的任务 ID，不能提交 URL 和本地路径。`plugin_download_start` 对同一插件的同一活动版本任务幂等复用，对同一插件的不同活动版本返回冲突；失败或取消后的终态任务可通过再次调用重新发起，旧 staging 会被清理。下载完成后，`plugin_install_preflight` 验证本地 Manifest 签名、兼容性和归档，再把已验证权限返回确认弹层；用户确认后，`plugin_install` 重复安全检查并原子写入版本目录。安装结果先标记为 `pending`，已安装清单可以查看当前版本、健康和启用状态，并允许用户手动回滚、启用、禁用或卸载；生命周期变更要求 Runtime 处于停止状态，并在下次启动时生效。

正式外部入口为 `harndock://plugins/{pluginId}`。协议解析只接受 `harndock` scheme、`plugins` host 和一个由 ASCII 字母、数字、点、下划线或连字符组成的 Plugin ID；拒绝凭据、端口、额外路径、查询参数、片段和编码路径穿越。冷启动与运行中链接都进入同一插件详情，重复唤起保持单实例。macOS 只能在安装到 `/Applications` 的打包应用上验证协议注册，开发 WebView 的 `?view=plugins&pluginId=...` 只是内部导航合同，不作为公开入口。

### 3.4 明确不做

- Center 对象存储、CDN、下载代理和安装包持久化。
- 任意外部 URL、任意 Git 仓库、GitHub `main` 分支源码直接安装。
- Marketplace 账号、OAuth、支付、订单、订阅、许可证和组织席位。
- Gateway 组织策略、远程安装任务和 Mobile 审批。
- 浏览器直接调用 shell、npm、git 或通用 Tauri IPC。

## 4. Manifest v1

Manifest 是版本级安装合同，规范文件位于 `dsh-center-plugin/contracts/plugin-manifest.schema.json`。第一版最小结构如下：

```json
{
  "pluginId": "com.example.docs",
  "version": "1.2.0",
  "pluginTypes": ["host", "client"],
  "harness": { "minVersion": "0.1.0" },
  "runtimeApi": 1,
  "platforms": ["darwin-aarch64", "darwin-x64"],
  "permissions": {
    "filesystem": ["workspace"],
    "network": ["api.example.com"]
  },
  "artifact": {
    "sha256": "<64 lowercase hex characters>",
    "size": 123456
  },
  "signature": { "keyId": "marketplace-prod-1", "value": "<signature>" }
}
```

实现要求：

- `pluginId`、版本、平台和权限集合必须参与签名。
- GitHub 仓库、Release Tag 和 Asset 不写入 Manifest 的信任判断；它们由 Center 的来源合同维护。
- Manifest 中的插件 ID、版本和平台必须与 Center Admin 登记记录一致。
- Host 和 Client 插件使用同一版本发布时，必须共享同一个 Release 版本合同。
- 发布后的 Manifest 不允许被覆盖；内容变化必须产生新版本或重新审核。

### 4.1 Manifest 签名合同

- 算法固定为 Ed25519；公钥和签名均使用标准 Base64，不接受 URL-safe Base64。
- 签名消息以字节前缀 `DSH-PLUGIN-MANIFEST-V1\0` 开始，后接 UTF-8 JSON。
- JSON 字段顺序固定为 `pluginId`、`version`、`pluginTypes`、`summary`、`description`、`harness`、`runtimeApi`、`platforms`、`permissions`、`artifact`；不包含 `signature`。
- 缺省的 `summary`、`description` 和 `harness.maxVersion` 必须编码为 `null`；权限 scope 按 ASCII 升序排列，权限值数组保持 Manifest 顺序。
- Center 在版本登记时验签，Desktop 在显示权限和正式安装前分别再次验签；Center 声明中的 `keyId/value` 必须与 Manifest 完全一致。
- Center 运行时通过 `PLUGIN_TRUSTED_KEYS_JSON` 读取公钥映射。Desktop 发布构建通过 `HARNDOCK_PLUGIN_TRUSTED_KEYS_JSON` 将同一公钥映射编译进签名应用；私钥不得进入 Center、Desktop、仓库或日志。
- Debug 构建仅为联调内置信任 `marketplace-dev-rfc8032` 测试键；Release 构建不包含该测试信任根。

插件包为 `tar.zst`，必须包含固定根目录 `harndock-plugin/`，并在根目录提供供 Runtime Loader 加载的 `package.json`。`plugin-manifest.json` 是同一个 GitHub Release 中的独立 Asset，不能放进归档，否则 Manifest 中记录归档 SHA-256 时会形成自引用。Desktop 分别下载归档和 Manifest，完成校验后再把 Manifest 写入本地版本目录。解压前扫描完整 tar 索引，拒绝根目录外路径、保留的 Manifest 路径、绝对路径、重复路径、硬链接、设备文件、FIFO 和逃逸符号链接；同时限制条目数量与解压后体积。

生产 Desktop 启动时会把当前插件版本作为 `file:` 包加入 `desktop` profile。Runtime Loader 完成并通过既有 `ready` 控制帧后，Desktop 将 pending 插件标记为 `healthy`；如果 profile 解析、插件加载、Runtime 启动或 ready 握手失败，Desktop 会对 pending 插件执行自动回滚。首次安装没有旧版本时删除当前版本和指针，升级失败时恢复上一健康版本。开发模式不加载本地插件市场版本，也不会误标记其健康状态。

## 5. GitHub Release 来源合同

Center 记录的是来源声明，不是工件内容本身：

```ts
type GithubReleaseSource = {
  provider: 'github'
  repository: string        // owner/repository
  releaseTag: string        // v1.2.0
  releaseId?: number
  commitSha: string
  assetName: string
  manifestAssetName: string
}
```

建议每个 Release 至少包含：

```text
plugin-manifest.json
SHA256SUMS
com.example.docs-1.2.0-darwin-aarch64.tar.zst
com.example.docs-1.2.0-darwin-x64.tar.zst
```

V1 只支持公开 GitHub Repository 和 GitHub Releases Asset。Center 可以调用 GitHub API 读取元数据，也可以在发布审核阶段临时下载验证，但不得把安装包写入对象存储或作为 Center 资源长期保存。

## 6. 内容状态机

### 6.1 插件版本状态

```text
draft ──submit──> review ──publish──> published ──unpublish──> unpublished
```

- `draft`：可以编辑和重新登记。
- `review`：等待人工审核，公共 API 不可见。
- `published`：公共 API 返回，Desktop 可以作为安装候选。
- `unpublished`：停止新安装和更新，保留审计及已安装用户的本地版本。

禁止跳过审核直接发布，禁止覆盖已存在的 `pluginId + version`，禁止把下架版本重新改写成其他内容。

### 6.2 本地安装状态

本地安装状态只在 Desktop 保存，与 Center 发布状态分离：

```text
DISCOVERED → DOWNLOADING → VERIFYING → AWAITING_CONFIRMATION → INSTALLING → INSTALLED
                                      └→ REJECTED
任何阶段失败 → FAILED → CLEANED
更新失败 → ROLLED_BACK
```

Center 不维护本地安装结果，不因为客户端离线、卸载或回滚修改发布状态。

## 7. API 契约

所有接口使用 `/v1` 前缀。公共接口不要求登录；当前第一轮管理端使用 `x-center-admin-key`，仅适用于本地开发和受控内网，生产必须替换为管理员会话和角色权限。第一轮服务端已经接入 GitHub Release、Asset、commit SHA 校验和仓库白名单基础能力。

### 7.1 公共接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/marketplace/categories` | 已发布分类 |
| `GET` | `/v1/marketplace/plugins` | 搜索、分类、平台过滤、分页 |
| `GET` | `/v1/marketplace/plugins/{pluginId}` | 已发布详情和版本 |
| `GET` | `/v1/marketplace/plugins/{pluginId}/releases/{version}` | 指定版本安装声明 |
| `GET` | `/v1/marketplace/plugins/{pluginId}/releases/{version}/download` | GitHub Asset 下载信息和校验材料 |

下载接口不再承诺 Center 短期 URL。响应应包含：

```json
{
  "pluginId": "com.example.docs",
  "version": "1.2.0",
  "url": "https://github.com/example/docs/releases/download/v1.2.0/com.example.docs-1.2.0.tar.zst",
  "source": { "provider": "github", "repository": "example/docs", "releaseTag": "v1.2.0", "commitSha": "<40 lowercase hex characters>", "assetName": "com.example.docs-1.2.0.tar.zst", "manifestAssetName": "plugin-manifest.json" },
  "sha256": "<digest>",
  "size": 123456,
  "signature": { "keyId": "marketplace-prod-1", "value": "<signature>" }
}
```

GitHub URL 可能发生重定向，Desktop 只能接受允许的 GitHub 下载域名，并且必须对最终文件做本地校验。

### 7.2 管理接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/admin/plugins` | 查看全部插件和版本 |
| `GET` | `/v1/admin/plugins/{pluginId}` | 查看单个插件 |
| `POST` | `/v1/admin/plugins` | 创建插件条目 |
| `PATCH` | `/v1/admin/plugins/{pluginId}` | 修改内容草稿 |
| `POST` | `/v1/admin/plugins/{pluginId}/releases` | 登记 GitHub Release 和 Manifest |
| `POST` | `/v1/admin/plugins/{pluginId}/releases/{version}/submit` | 提交审核 |
| `POST` | `/v1/admin/plugins/{pluginId}/releases/{version}/publish` | 发布 |
| `POST` | `/v1/admin/plugins/{pluginId}/releases/{version}/unpublish` | 下架 |
| `POST` | `/v1/admin/plugins/{pluginId}/releases/{version}/reverify` | 重新校验 GitHub 来源并保存结果 |
| `GET` | `/v1/admin/audit-events` | 按插件、版本、动作、actor、时间查询审计事件 |

错误响应统一包含 `error.code`、`requestId` 和机器可读状态。管理写操作后续增加 `Idempotency-Key` 和资源 `revision`。

管理端当前本地化的稳定错误至少包括 `admin_unauthorized`、`invalid_plugin`、`plugin_exists`、`slug_exists`、`plugin_not_found`、`release_exists`、`release_not_found`、`invalid_release_transition`、`invalid_manifest`、`invalid_github_source` 以及 GitHub 来源、Tag、Asset、摘要、大小、网络和限流相关错误。未知错误仍保留服务端消息和 `requestId`，便于定位，页面不得显示管理员密钥。

### 7.3 发布校验结果与审核退回

版本登记成功后，Center 保存 `verification_status`、`verification_checked_at`、`verification_checks` 和 `verification_error_code`。校验项至少覆盖 Manifest 格式、签名、插件 ID、版本、GitHub Release、commit SHA、安装包 Asset、Manifest Asset、Asset SHA-256 和 Asset 大小；远程 Provider 未配置时明确记录为 warning，不能伪装成已完成 GitHub 复核。Manifest/签名本身无法解析时接口返回错误，不生成不可识别的版本记录；GitHub 远程检查失败或摘要/大小不一致时，仍保存为 `draft + failed`，页面展示失败原因。

版本状态机增加审核退回路径：`review → draft`，接口为 `POST /v1/admin/plugins/{pluginId}/releases/{version}/return`，请求必须包含 1-1000 字符的 `note`。`draft → review` 和 `review → published` 都要求版本校验状态为 `passed`；发布校验失败的草稿只能修复来源或重新登记新版本，不能绕过校验。退回原因写入版本记录和审计元数据。校验摘要和审核原因属于管理数据，公共 Marketplace 响应会主动剔除，不向访客或 Desktop 暴露。

历史版本可以调用 `POST /v1/admin/plugins/{pluginId}/releases/{version}/reverify`。该操作重新查询 GitHub Release、Tag、commit、Asset、Manifest Asset、摘要和大小，并覆盖版本的 `verification_*` 字段，同时刷新 `source_status`、`source_checked_at`、`source_failure_count`、`source_etag` 和 `source_release_id`；每次结果追加 `plugin.release.reverified` 审计事件。没有 GitHub Provider 时返回 `verification_unavailable`，不会伪造校验通过。审计查询支持 `pluginId`、`version`、`action`、`actorId`、`from`、`to`、`limit` 和 `offset`，事件详情只展示已脱敏的业务元数据。Worker 使用相同校验器按 `WORKER_INTERVAL_MS` 周期扫描有 GitHub 来源的版本，生产默认间隔为 15 分钟，开发默认间隔为 1 秒，失败递增连续失败次数，成功清零；Worker 不自动下架版本、不修改 Desktop 本地安装状态。GitHub Provider 会携带已保存的 `If-None-Match`，Release 返回 `304` 时复用最近一次通过的校验结果，但仍重新确认固定 commit；遇到 403/429 时按有限指数退避并读取 `Retry-After` 或限流重置时间，最终记录 `github_rate_limited`，Worker 停止当前批次剩余来源请求。来源状态为 `failed` 的已发布版本仍保留在管理端，但不会出现在公开 Marketplace、详情或下载接口；完整复核恢复为 `healthy` 后自动重新成为安装候选。Worker 日志和 `source_sweep_runs` 表输出/保存本轮耗时、成功率、未修改、限流、漂移、跳过和延迟统计，管理端通过 `GET /v1/admin/source-sweeps` 查询最近记录。设置 `SOURCE_SWEEP_ALERT_WEBHOOK_URL` 后，Worker 只在正常到异常、异常到恢复的状态切换时发送 JSON Webhook 告警；告警失败只记录日志，不阻断巡检，连续异常不会重复通知。生产环境不得将巡检间隔配置为秒级。

## 8. Desktop 安装安全门禁

安装器必须按顺序执行：

1. 校验 Center 响应中的插件 ID、版本和发布状态。
2. 校验 GitHub Repository、Release Tag、Asset Name 和 commit SHA。
3. 下载到 staging，不覆盖 active 目录；新任务启动时清理不属于当前进程活动任务的孤儿 staging。
4. 计算 SHA-256 并与 Center 声明一致。
5. 校验 Manifest schema、签名、平台、Harness 版本和 Runtime API。
6. 检查归档路径穿越、绝对路径、重复路径、设备文件、FIFO、硬链接和逃逸符号链接。
7. 展示权限差异和 Host 高风险提示，等待本地用户确认。
8. 原子写入版本目录和 active 指针。
9. 健康检查失败则删除 staging 或恢复旧版本。

禁止仅因为 URL 来自 GitHub 就跳过哈希、签名和归档安全检查。

## 9. 测试矩阵

| 层级 | 必测内容 |
|---|---|
| Contract | Manifest 合法/非法字段、版本、平台、权限、签名和 GitHub 来源白名单 |
| Center API | 草稿不可见、审核状态、发布、下架、重复版本、审计和分页 |
| GitHub Provider | Release 不存在、Tag 漂移、Asset 缺失、重定向域名、API 限流和网络重试 |
| Desktop Installer | 哈希不一致、验签失败、恶意归档、磁盘不足、取消、失败清理、Runtime 加载、健康确认和回滚 |
| E2E | 管理端登记 GitHub Release → Center 发布 → Desktop 拉取 → GitHub 下载 → 本地安装 |
| Regression | Center 与 `dsh-sync-server` 同时启动时端口、数据库、Redis key 和凭据不冲突 |

没有真实 GitHub 或 PostgreSQL 的测试只能标记为 unit/contract，不得标记为生产集成验收。

真实 Release 制品可以通过 Desktop 安装器的忽略测试进行隔离验收，不写入用户生产 profile：

```bash
HARNDOCK_TEST_PLUGIN_ARCHIVE=/absolute/path/plugin.tar.zst \
HARNDOCK_TEST_PLUGIN_MANIFEST=/absolute/path/plugin-manifest.json \
TAURI_CONFIG='{"bundle":{"resources":[]}}' \
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --lib plugin_installer::tests::installs_a_real_marketplace_release_in_an_isolated_store \
  -- --ignored --exact
```

该测试执行真实摘要、Manifest、签名、平台、归档和 package 校验，并在临时 AppData 中完成安装和 active pointer 检查；它不能替代 Center 发布和 Desktop UI 更新验收。

## 10. 验收标准

- 管理员可以只通过 GitHub Release 信息完成一个插件版本的登记和发布。
- Center 不需要对象存储即可完成构建、迁移、发布和公共目录查询。
- 公共 API 永远不返回草稿、审核中和下架版本。
- Desktop 能根据当前平台选择 GitHub Asset，并在本地校验后安装。
- 安装后的插件会进入生产 Desktop profile；Runtime ready 后状态变为 `healthy`，加载失败会自动回滚。
- GitHub Asset 被删除、Tag 发生变化、哈希不一致或签名失败时，安装被拒绝。
- 已安装插件不因 Center 或 GitHub 短暂不可用而被静默删除。
- 版本内容变化必须产生新版本或重新审核，不能覆盖已发布记录。
- V1 不需要账号、支付、许可证、Gateway 和 Mobile 即可完成免费插件安装。
