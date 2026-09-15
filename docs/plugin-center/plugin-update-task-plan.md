# 插件更新专项任务计划

版本：1.0
状态：执行中，Sprint U4 真实插件与发布验收
更新时间：2026-09-11

## 1. 目标

为已安装插件提供可靠、可解释、可回滚的更新能力。用户可以在 Harndock Desktop 插件中心看到本地版本与 Center 最新已发布版本的差异，确认更新条件后，从 GitHub Release 下载新版本，在本地完成完整校验，并在 Runtime 重启后确认新版本健康。

本专项服务于插件中心 V1，不改变当前分发边界：

- Center 只维护插件条目、发布版本、GitHub 来源和安装声明。
- Center 不保存插件包，也不代理插件下载流量。
- Desktop 直接从公开 GitHub Release 下载，并在本地重新验证 SHA-256、签名、Manifest、平台和兼容性。
- Marketplace 只展示最新公开版本并引导用户进入 Desktop，不负责直接更新本机插件。
- V1 不引入登录、许可证、付费、开发者中心、Gateway 远程更新或 Mobile 审批。

## 2. 当前基础与差距

已有基础：

- Center 公共目录返回 `latestPublishedVersion`。
- Center 详情和下载声明返回版本、GitHub Release、Asset、SHA-256、大小和签名信息。
- Desktop 已有下载、取消、预检、安装、版本目录和 active pointer。
- 新版本安装时会记录 `previousVersion`。
- Runtime 启动失败时可以执行 pending 插件回滚。
- Desktop 已有禁用、启用、卸载和手动回滚命令。

需要补齐：

- 本地版本与线上版本的 SemVer 比较。
- 已安装插件的更新状态和更新按钮。
- 更新详情中的当前版本、目标版本、权限变化和兼容性变化。
- 更新时保留原有启用/禁用状态。
- Runtime 运行期间的停止、更新、重启和健康等待。
- 更新失败时恢复旧版本并向用户展示原因。
- 更新过程中的并发控制、取消、重复安装和网络失败处理。

## 3. V1 产品规则

### 3.1 版本判断

以 `pluginId` 作为匹配键：

- 线上版本高于本地版本：显示“更新”。
- 线上版本等于本地版本：显示“已是最新”。
- 本地版本高于线上版本：显示“本地版本较新”，不允许自动降级。
- Center 没有可用 published 版本：保留本地插件，不显示更新错误。
- 线上版本状态为 unpublished、来源失效或下载声明校验失败：不可更新。
- 版本比较必须使用严格 SemVer，不使用字符串排序。

### 3.2 更新触发位置

- Desktop 的“已安装插件”列表提供单插件更新按钮。
- Desktop 的插件目录卡片在匹配到已安装插件时显示“更新”，否则显示“获取插件”。
- 插件详情面板显示当前版本、最新版本和更新说明；V1 没有强制更新。
- Marketplace 的“安装到 Desktop”深链可以打开 Desktop 对应插件详情，但不在浏览器执行更新。
- V1 暂不提供“全部更新”，避免多个 Host 插件同时重启造成故障难以定位。

### 3.3 更新确认内容

更新确认面板至少展示：

- 当前版本和目标版本。
- GitHub 仓库、Release Tag、Release ID 和固定 commit SHA。
- 目标平台、Harness 最低版本和 Runtime API。
- 新增、删除和保持不变的权限。
- 包大小、SHA-256 和签名 Key ID。
- Runtime 是否需要停止和重启。
- 更新失败后的自动回滚策略。

如果目标版本新增权限，必须明确要求用户再次确认；没有权限变化时仍展示校验结果，但不重复制造模糊授权文案。

## 4. 状态模型

### 4.1 展示状态

| 状态 | 条件 | 用户操作 |
|---|---|---|
| 未安装 | 本地不存在该 `pluginId` | 获取插件 |
| 已是最新 | 本地版本等于线上版本 | 查看详情、回滚 |
| 有可用更新 | 线上版本高于本地版本 | 更新 |
| 本地版本较新 | 本地版本高于线上版本 | 查看详情，不降级 |
| 无法检查更新 | Center 或 GitHub 暂时不可用 | 重试，继续使用当前版本 |
| 更新受阻 | 目标版本不兼容、签名失败或来源失效 | 查看原因，不切换 active |
| 更新中 | 下载、预检、安装或 Runtime 重启 | 查看阶段，必要时取消下载 |
| 更新成功 | 新版本健康并成为 active | 查看版本、返回 Runtime |
| 已回滚 | 新版本启动或健康检查失败 | 查看失败原因、重试更新 |

### 4.2 更新任务阶段

建议复用现有下载任务并扩展阶段语义：

`checking → fetchingDeclaration → downloading → ready → preflighting → waitingForConfirmation → stoppingRuntime → installing → startingRuntime → waitingForHealth → completed`

失败分支：

`cancelled`、`failed`、`rolledBack`。

下载阶段可以取消；进入原子安装后不允许中断写入，必须完成清理或回滚后再返回结果。

## 5. 技术任务拆分

### U-01 版本比较和更新状态

工程：`apps/desktop/src`、`apps/desktop/src-tauri/src`

- 抽取严格 SemVer 比较函数。
- 将本地安装清单与 Center 目录按 `pluginId` 合并。
- 为每个插件计算 `updateAvailable`、`currentVersion`、`latestVersion` 和 `versionState`。
- 对非法版本、缺失版本和本地版本较新的情况增加测试。

当前进度：已新增 Desktop 纯函数版本比较和状态模型，支持严格 SemVer 核心版本、预发布版本和本地版本较新保护；目录卡片已接入“获取插件 / 更新 / 已是最新 / 本地版本较新 / 暂无法检查”状态。已安装列表在当前目录页可发现更新版本。

完成标准：同一插件的安装状态、目录状态和详情状态使用同一套版本判断结果。当前仍需补充独立自动化用例和跨分页的已安装插件版本发现。

### U-02 Center/Desktop 目录合同

工程：`dsh-center-plugin/src`、`apps/desktop/src-tauri/src/plugin_center.rs`

- 确认 `latestPublishedVersion` 足以支撑更新判断。
- 如果更新 UI 需要变更说明，增加可选字段，不把审核内部字段暴露给公共 API。
- 确认详情接口始终返回可安装的 published release。
- 对已下架、来源失效、版本不存在和下载声明不匹配增加合同测试。

当前进度：已确认 `latestPublishedVersion`、详情中的 published releases 和版本下载声明足以支撑 V1 主动更新；Desktop 已补充目录分页、详情和下载声明的反序列化回归测试。更新确认面板只使用公开发布字段和本地预检结果，不依赖审核内部字段。

完成标准：V1 更新不需要新增对象存储、下载代理或账号接口。

### U-03 更新按钮和详情面板

工程：`apps/desktop/src/App.tsx`、`apps/desktop/src/App.css`

- 已安装列表新增“更新”按钮和版本差异文案。
- 插件卡片根据安装状态显示“获取插件 / 更新 / 已是最新”。
- 详情面板增加当前版本、目标版本和权限差异。
- 下载、预检、确认、安装和完成状态保持稳定布局。
- Runtime 运行时更新按钮应进入“需要重启 Runtime”的确认状态。

当前进度：已安装列表和目录卡片已接入更新按钮；安装确认面板已展示当前版本、目标版本、GitHub 仓库、Release Tag、commit、目标平台、插件类型、兼容性、权限、包大小和 SHA-256。Runtime 运行中时的停止/重启确认仍留给 U-05。

完成标准：用户不需要阅读日志或执行命令即可理解更新正在进行、成功或失败的原因。

### U-04 保留启用状态的安装器改造

工程：`apps/desktop/src-tauri/src/plugin_installer.rs`

- 更新安装前读取当前 pointer 的 `enabled` 值。
- 新版本写入 active pointer 时继承旧版本启用状态。
- 首次安装仍默认启用。
- 更新失败时旧版本目录、旧 pointer 和启用状态保持可恢复。
- 重复更新同一版本返回明确的 already-installed 状态，不破坏当前版本。

当前进度：安装器已在写入新 active pointer 时继承旧 pointer 的 `enabled` 值；首次安装仍默认启用，并新增禁用插件升级后的 Rust 回归测试。

完成标准：禁用插件更新后仍保持禁用，启用插件更新后仍保持启用。Runtime 重启协调仍属于 U-05，尚未在本轮实现。

### U-05 Runtime 更新协调

工程：`apps/desktop/src/App.tsx`、`apps/desktop/src-tauri/src/plugin_center.rs`、`apps/desktop/src-tauri/src/runtime`

- 更新前判断 Runtime 是否运行。
- 运行中更新必须先停止 Runtime，并等待进入可管理状态。
- 安装完成后按更新前状态决定是否自动启动 Runtime。
- 启动后等待 ready/health 事件。
- 健康检查超时或启动失败时切换旧版本并重新启动旧版本。
- Runtime 运行失败不得删除旧版本，也不得将失败版本伪装成健康。

当前进度：Desktop 已在安装前读取真实 Runtime 状态；`ready/starting` 状态会先停止并等待进入可管理状态，再执行安装并自动重启。Runtime 到达 ready 时沿用现有机制把 pending 插件标记为健康；启动失败时 Runtime 后端先回滚 pending 插件，Desktop 再确认 active 版本并启动恢复后的旧版本。`plugin_install` 命令新增服务端 Runtime 停止门禁，不能绕过前端直接运行期写入。顶部任务条会展示停止、安装、启动检查和恢复阶段。

完成标准：代码闭环和自动化状态测试已完成；仍需在 macOS arm64 使用真实 GitHub Release 验证更新成功、启动失败回滚和界面状态恢复。

### U-06 下载和并发控制

工程：`apps/desktop/src-tauri/src/plugin_center.rs`

- 同一插件同一时间只允许一个更新任务。
- 已有下载任务时，重复点击不创建第二个任务。
- 下载失败支持显式重试，并清理 staging。
- 下载取消不得改变当前 active 版本。
- Center 声明、GitHub 来源、大小和摘要校验失败时停止更新。
- 保留现有 HTTP 代理配置和 GitHub Host 白名单。

当前进度：同一插件的同一活动版本重复调用 `plugin_download_start` 会复用已有任务；同一插件的不同活动版本会被拒绝，避免两个版本同时写入 staging。失败、取消和声明阶段异常统一清理 staging；新下载启动时还会清理上次 Desktop 进程遗留、且不属于当前活动任务的孤儿 staging。前端任务条已提供重试入口，重试会重新读取 Center 声明并创建新任务。Rust 已覆盖活动任务复用、不同版本冲突、终态任务回收、失败清理和跨进程孤儿目录清理；真实取消和代理不可达回归仍留在 U4。

完成标准：网络失败、取消、重复点击和来源不一致均不会损坏当前安装。

### U-07 更新审计和诊断

工程：Desktop 本地日志，必要时扩展 Center/Admin 审计合同

- 记录插件 ID、旧版本、新版本、任务 ID、阶段、结果和失败分类。
- 不记录管理员密钥、GitHub token、完整环境变量或插件包内容。
- 用户可以从更新失败状态进入诊断日志。
- V1 不把本地更新行为强制写入 Center，除非后续需要跨设备审计。

完成标准：支持定位“声明失败、下载失败、预检失败、Runtime 启动失败和回滚成功/失败”。

## 6. 测试计划

### T0 合同和单元测试

- SemVer 比较：低版本、相同版本、高版本、预发布版本、非法版本。
- Center 目录和详情响应反序列化。
- 更新状态计算和本地版本较新保护。
- 禁用/启用状态继承。
- 重复版本、下载取消、失败清理和 active pointer 保持。

### T1 Desktop 集成测试

- 已安装插件能够发现新版本并显示更新按钮。
- 更新任务能够读取声明、下载、预检和安装。
- 更新后旧版本仍保留，并可手动回滚。
- 更新失败后旧版本成为 active，启用状态不变。
- Runtime 运行时更新会先停止再重启。

### T2 真实插件测试

使用真实公开 GitHub Release：

- `dsh-at-file`：使用后续版本验证正常更新。
- `dsh-univer-office`：验证较大包下载、代理和兼容性检查。
- 两个插件分别验证已启用和已禁用更新。

### T3 故障和安全测试

- GitHub 403/429、超时、断网和代理不可达。
- Release 删除、Tag 漂移、commit 漂移、Asset 替换。
- SHA-256 不一致、签名错误、Manifest 篡改和平台不匹配。
- 新版本 Runtime 启动失败、ready 超时和进程崩溃。
- 更新中退出 Desktop、重复点击和磁盘空间不足。

## 7. 执行顺序

### Sprint U1：更新基础

1. 完成 U-01 版本比较和更新状态模型。
2. 完成 U-02 Center/Desktop 合同确认和测试。
3. 完成 U-04 安装器启用状态继承。
4. 为现有下载任务补充重复任务、取消和失败清理测试。

退出条件：能够可靠判断“未安装、已是最新、有更新、本地版本较新和无法检查更新”。

## 11. 执行记录

### 2026-09-10：U-01/U-04 第一轮实现

- 新增 `apps/desktop/src/plugin-version.ts`，实现严格 SemVer 比较、预发布版本排序和更新状态计算。
- Desktop 插件目录卡片接入本地安装版本，更新按钮只在 Center 版本高于本地版本时可用；线上版本相同、本地版本较新和版本无法比较时不会发起下载。
- Desktop 已安装列表展示当前版本与目录版本，并在当前目录页发现新版本时提供更新入口。
- `PluginStore::install_archive` 在升级时继承旧 pointer 的 `enabled` 状态，避免禁用插件被意外重新启用。
- 新增 `upgrade_preserves_a_disabled_plugin_state` Rust 回归测试。

本轮退出条件：U-01/U-04 基础实现、U-02 合同测试和 U-03 更新确认面板已完成；下一轮进入 U-05 Runtime 停止/重启协调和 U-06 下载任务并发控制。

### 2026-09-10：U-02/U-03 合同与确认面板

- 为 Center 目录详情和 published release 增加 Desktop 反序列化回归测试。
- 扩展本地安装预检响应，返回已经校验过的 GitHub repository、Release Tag、commit、SHA-256 和包大小。
- 更新安全安装确认面板，区分首次安装和插件更新，并展示当前版本与目标版本。

### 2026-09-10：U-05 Runtime 更新协调

- `plugin_install` 增加 Runtime 停止门禁，阻止运行期直接写入插件目录。
- Desktop 更新前记录 Runtime 是否处于运行/启动状态，需要时停止并等待终态。
- 更新完成后自动启动 Runtime 并等待 ready；健康事件将 pending 插件标记为 healthy。
- 新版本启动失败时确认 active pointer 已由后端回滚，必要时主动回滚或移除首次安装版本，再启动恢复后的 Runtime。
- 新增 Runtime 安装状态决策测试，覆盖允许安装和需要恢复的状态集合。

下一轮：执行 U-06 同插件下载任务去重、取消清理和失败重试，并准备真实插件版本更新测试数据。

### 2026-09-10：U-06 下载任务并发控制第一轮

- 下载任务预留改为在任务锁内完成，同一插件同一活动版本重复请求直接复用原任务；同一插件不同活动版本返回冲突，避免并发写入多个 staging 目录。
- 失败、取消、Manifest 下载失败和 GitHub 声明失败统一清理 staging，并清除任务中的临时文件路径；当前 active 插件版本不参与下载任务清理。
- 任务条对失败和取消状态提供“重试”，重试创建新任务并重新读取 Center 声明；旧终态任务只在同插件重试时回收，其他插件任务不受影响。
- 新增 4 项 Rust 回归测试；Desktop TypeScript 测试 6 项、Web 构建和 Rust `plugin_center` 16 项测试通过。

本轮边界：未宣称真实网络失败、取消、代理不可达或完整插件升级已验收；这些场景仍属于 U4 真实插件与发布验收。

### 2026-09-11：U4 真实 GitHub 下载与本机状态核验

- Center API 和 GitHub API 均确认 `javajeans/dsh-at-file` 存在 `v0.7.1`、`v0.7.2` 两个公开 Release。
- 通过 Desktop 配置使用的 `http://127.0.0.1:1087` 代理真实下载两个版本；`v0.7.1` 为 238745 bytes、SHA-256 `da7ddb5707f1147468deb6848ba0772c78c04ce51448c701ad90266ab1c4ff9a`，`v0.7.2` 为 237918 bytes、SHA-256 `46c273f152259e90614220314cb8df69ef9fbc911d99f36bccae51faeb831e01`，均与 Release Manifest 和 Center 声明一致。
- 本机生产 profile 的 active pointer 为 `dsh-at-file@0.7.2`，状态 `healthy`、`enabled=true`，安装目录 Manifest 与 Center 声明一致。
- 发现上次进程遗留的 `v0.7.1` staging。下载任务新增跨进程孤儿 staging 清理，并增加回归测试；插件中心 Rust 测试增至 17 项全部通过。

本轮边界：本机 active pointer 的 `previousVersion` 为 `null`，只能证明 `v0.7.2` 已安装且健康，不能证明 `v0.7.1 → v0.7.2` 更新切换和回滚已经完整验收。下一轮需要通过 Desktop UI 安装旧版本测试基线，再执行更新、启用状态继承、Runtime 重启和失败回滚。

### 2026-09-11：v0.7.3 更新候选制品准备

- 确认 `v0.7.1`、`v0.7.2` 公开归档仍使用旧的 `harnone-plugin/` 根目录，不符合当前 Desktop 固定 `harndock-plugin/` 安全合同；不在客户端引入长期旧品牌兼容分支。
- `javajeans/dsh-at-file` 本地主分支已有归档根目录修复提交 `1e54ba2`，并新增版本准备提交 `ded07d1`，将 `package.json` 和 `dsh.plugin.json` 提升到 `0.7.3`。
- 恢复插件源码的 Harness link 依赖后，类型检查、13 个测试文件共 171 项测试和构建全部通过。
- 最终候选归档根目录为 `harndock-plugin/`，大小 237883 bytes，SHA-256 `d210119c1b289d7a4f809877a21ad49ab27098506763e37eb29b27cf8f4bffcd`，仓库 `release:verify` 通过。
- Desktop 新增可通过环境变量传入真实 Release 的隔离安装验收测试；v0.7.3 已通过摘要、签名、预检、解包、版本目录和 pending active pointer 检查，没有修改用户生产 profile。

后续进展：GitHub 已切换到 `javajeans`，提交 `1e54ba2`、`ded07d1` 已推送到 `main`，公开 `v0.7.3` Release 已创建并包含归档和 Manifest 两个资产。远端重新下载后的归档仍为 237883 bytes，SHA-256 `d210119c1b289d7a4f809877a21ad49ab27098506763e37eb29b27cf8f4bffcd`，与本地候选和 Manifest 一致。

当前状态：Docker Desktop 已恢复，compose 项目 `dsh-center-plugin` 的 PostgreSQL、Redis、Center API、Admin 和 Worker 均已启动；`/health/ready` 返回 `{"status":"ready"}`，管理端 `/console/` 返回 HTTP 200。已继续执行 `Center 登记/审核/发布`，Desktop 0.7.2 → 0.7.3 的 UI 点击验收仍待使用包含本轮代码的新版构建完成。

### 2026-09-12：真实 Center 发布链路验收

- 通过管理 API 登记 `javajeans/dsh-at-file` 的 GitHub Release `v0.7.3`，后台验证通过 Manifest、Ed25519 签名、插件 ID、版本 Tag、Release #386914336、commit SHA、安装包 Asset、Manifest Asset、SHA-256 和大小共 11 项检查。
- 版本状态已真实完成 `draft → review → published`，公开 Marketplace 列表返回 `dsh-at-file@0.7.3`；下载声明返回 GitHub Release URL、`d210119c1b289d7a4f809877a21ad49ab27098506763e37eb29b27cf8f4bffcd` 和 237883 bytes，与 Release Asset 一致。
- 重新启动 compose 时发现旧 worker 容器曾因不在当前 compose 网络而出现 `ENOTFOUND postgres`；使用当前 compose 项目重新启动后，worker 已重新接入网络并运行。

本轮边界：后台和公开 API 的真实发布链路已通过；由于当前可见 Desktop 窗口来自 2026-09-06 的旧 release bundle，本轮没有把旧构建的 UI 状态计入 Desktop 更新验收。下一步需用包含更新逻辑的新版构建验证 `0.7.2 → 0.7.3`、启用状态继承、Runtime 重启和失败回滚。

### Sprint U2：Desktop 更新交互

1. 完成 U-03 已安装列表、目录卡片和详情更新 UI。
2. 接入 U-06 更新任务并发控制。
3. 展示版本差异、权限差异、校验阶段和失败原因。
4. 完成单插件更新的成功、取消和失败测试。

退出条件：Runtime 停止状态下，用户可通过 Desktop 完成一次更新并看到新版本状态。

### Sprint U3：Runtime 重启和自动回滚

1. 完成 U-05 更新前停止和更新后启动。
2. 接入 ready/health 等待和超时。
3. 接入失败自动回滚和旧版本恢复。
4. 完成 U-07 更新日志和诊断信息。

退出条件：Runtime 运行中更新成功；新版本启动失败时旧版本自动恢复。

### Sprint U4：真实插件和发布验收

1. 使用真实 `dsh-at-file` 和 `dsh-univer-office` 完成更新测试。
2. 完成代理、GitHub 异常、签名和来源漂移测试。
3. 完成升级后启用状态保持测试。
4. 更新 V1 总任务计划、开发文档、架构文档和发布 runbook。

退出条件：macOS arm64 达到 V1 更新发布门禁，无阻断级数据一致性或安全缺陷。

## 8. 验收场景

| ID | 场景 | 预期结果 |
|---|---|---|
| UAT-01 | 未安装插件获取 | 执行现有安装流程，不显示更新文案 |
| UAT-02 | 线上版本相同 | 显示已是最新，不发起下载 |
| UAT-03 | 线上版本更高 | 显示更新，展示旧/新版本和更新条件 |
| UAT-04 | 本地版本更高 | 不降级，保留当前版本并提示本地版本较新 |
| UAT-05 | 禁用插件更新 | 更新成功后仍为禁用，重启 Runtime 后不加载 |
| UAT-06 | 启用插件更新 | 更新成功后仍为启用，Runtime 重启后加载新版本 |
| UAT-07 | Runtime 运行中更新 | 先停止、更新、重启并等待健康 |
| UAT-08 | 新版本启动失败 | 自动恢复旧版本，旧版本健康启动 |
| UAT-09 | 下载中取消 | 清理临时文件，当前版本不改变 |
| UAT-10 | 签名或哈希失败 | 拒绝更新，旧版本可继续使用 |
| UAT-11 | GitHub 暂时不可用 | 保留当前版本，显示可重试错误 |
| UAT-12 | 重复点击更新 | 只保留一个任务，不重复写入版本目录 |

## 9. Definition of Done

- Desktop 能在已安装清单中准确显示更新状态。
- 更新按钮只在目标版本高于本地版本且来源有效时可用。
- 更新前展示版本、来源、兼容性和权限变化。
- 更新下载、预检、安装、Runtime 重启和健康确认都有明确阶段。
- 新版本安装失败或启动失败时，旧版本和启用状态可恢复。
- 更新取消、重复点击、网络故障和安全校验失败不会破坏当前 active 版本。
- `dsh-at-file` 和 `dsh-univer-office` 至少各完成一次真实更新链路验证。
- 单元、集成、故障和真实插件测试结果进入任务计划和发布记录。
- 相关功能开发文档、架构文档、HTML 原型和总任务计划与实现状态一致。

## 10. 风险和决策记录

| 风险 | 影响 | 处理 |
|---|---|---|
| 更新时 Runtime 正在运行 | 高 | 强制进入停止/重启流程，不做运行期热替换 |
| 新版本启动失败 | 高 | 新旧版本并存，健康确认失败自动回滚 |
| 禁用状态被更新重置 | 中 | 安装器从旧 pointer 继承 `enabled` |
| GitHub Release 暂时不可达 | 中 | 保留当前版本，支持重试和代理配置 |
| 版本号格式不规范 | 中 | 严格 SemVer，非法版本不参与自动更新 |
| 多插件同时更新相互影响 | 中 | V1 只做单插件更新，批量更新延期 |
| 更新行为需要跨设备审计 | 低 | V1 先记录 Desktop 本地诊断，Gateway 审计延期 V2 |

关键决策：V1 更新采用“用户主动触发、单插件、下载前确认、安装后健康确认、失败自动回滚”的策略，不做后台静默更新和运行期热替换。
