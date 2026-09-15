# Harndock 应用更新任务计划

版本：1.0  
状态：规划中  
更新时间：2026-09-13

## 1. 目标与边界

当 Harndock 在 GitHub 发布新版本后，Desktop、Mobile 和 Gateway 管理端能够发现适用于自身产品、平台、渠道和兼容范围的版本，并向用户或管理员提供明确的更新提示。

本计划只覆盖产品应用本身的更新：

- Desktop 壳的安装包更新；
- Mobile 原生应用的商店或 APK 更新提示；
- Gateway 闭源服务的版本化容器镜像更新提示；
- 官网 Download/Release 数据与发布清单的同步。

本计划不替代以下已有专项：

- 插件更新：见 [插件更新专项任务计划](plugin-center/plugin-update-task-plan.md)；
- Harness Runtime 更新：见 [总体实施路线](roadmap.md) 的 P4；
- GitHub 仓库迁移：见 [GitHub 仓库迁移任务计划](harndock-migration-task-plan.md)。

第一版不做：

- Gateway 进程自行替换容器或访问 Docker socket；
- Mobile 在 iOS/商店环境中直接下载并安装二进制；
- 客户端携带 GitHub API Token；
- 通过远程清单执行任意 Shell 或部署命令；
- 把 Desktop、Mobile、Gateway 强行绑定为同一个版本号；
- 把普通更新默认做成阻断式强制更新。

## 2. 当前基线与差距

| 产品/工程 | 当前基线 | 主要差距 |
| --- | --- | --- |
| Desktop | Tauri 2 + React；版本目前为 `0.1.0` | `<harndock-repo>/apps/desktop/src-tauri/tauri.conf.json` 尚未配置 updater、更新签名和发布产物 |
| Mobile | Expo 52 / React Native；`app.json` 版本为 `0.1.0` | Expo Updates 已关闭；Android release 仍使用 debug 签名；尚未接入商店/官网更新入口 |
| Gateway | 私有 Node 服务，Admin Console 与 Gateway 分离 | `<dsh-sync-server-repo>/deploy/compose.yaml` 仍使用 `build:`，尚无版本镜像、digest 和升级提示 |
| 官网 | 已有 `/download`、`/releases` 和平台数据模型 | `<dsh-website-repo>/src/data/releases.ts` 尚未接入真实发布流水线 |
| 协议 | `sync-protocol` 已有 `protocolVersion` 和客户端版本字段 | Mobile 握手中的版本/平台仍有硬编码，缺少应用版本兼容矩阵 |

## 3. 总体设计

GitHub Release 是发布源，但客户端不直接依赖 GitHub 页面或未经约束的 API 响应。发布流水线在构建、签名和校验成功后，生成稳定的产品更新清单：

```text
GitHub Release / GHCR 镜像
          │
          ▼
发布流水线校验版本、签名、checksum、digest 和兼容性
          │
          ▼
产品更新清单（Desktop / Mobile / Gateway）
          │
          ▼
各端比较本地版本并按平台规则提示或跳转
```

### 3.1 统一清单基础字段

```json
{
  "product": "desktop",
  "channel": "stable",
  "version": "1.2.0",
  "publishedAt": "2026-09-13T10:00:00Z",
  "mandatory": false,
  "minSupportedVersion": "1.0.0",
  "notesUrl": "https://harndock.com/releases/1.2.0",
  "compatibility": {
    "protocolVersion": 1,
    "runtimeApi": 1
  },
  "artifacts": {}
}
```

字段约束：

- `product`：`desktop`、`mobile` 或 `gateway`；
- `channel`：第一版至少支持 `stable`，是否开放 `beta` 在决策阶段确认；
- `version`：产品版本使用严格 SemVer；
- `mandatory`：仅表示产品策略上的强提醒，不代表客户端必须失效；
- `minSupportedVersion`：低于此版本时持续提示并说明原因；
- `compatibility`：记录 `protocolVersion`、`runtimeApi` 等独立兼容维度；
- 清单必须通过 JSON Schema 校验，发布失败时不得生成可消费的清单。

### 3.2 各产品更新方式

| 产品 | 检查时机 | 提示动作 | 安装/升级动作 |
| --- | --- | --- | --- |
| Desktop | 启动后延迟检查、定时检查、设置页手动检查 | 更新对话框、下载进度、稍后提醒 | Tauri Updater 下载签名产物，安装后重启 |
| Mobile iOS | 启动、回前台、设置页手动检查 | 跳转 App Store | 由 App Store 完成更新 |
| Mobile Android | 启动、回前台、设置页手动检查 | 跳转 Google Play 或官网 APK 页 | 由商店或用户确认 APK 安装 |
| Gateway | Console 登录后、诊断页、手动检查 | 只向管理员显示当前版本、目标版本和升级说明 | 管理员或部署平台拉取指定镜像 digest 并执行升级 |

## 4. 版本与兼容模型

应用版本不能代替所有兼容性标识，至少分开管理：

| 字段 | 作用 |
| --- | --- |
| `appVersion` | Desktop、Mobile、Gateway 的用户可见版本 |
| `protocolVersion` | Client 与 Gateway 的通信协议版本 |
| `runtimeVersion` | Desktop 内置 Harness Runtime 版本 |
| `runtimeApi` | 插件/Runtime API 兼容版本 |
| `schemaVersion` | Gateway 数据库迁移版本 |
| `imageDigest` | Gateway 容器的不可变身份 |
| `buildId` | 具体 CI 构建或提交身份 |

兼容判断规则：

- 普通版本比较使用 SemVer，禁止字符串排序；
- stable 用户默认忽略 prerelease；
- Gateway 镜像以 digest 为最终身份，tag 只用于展示和查找；
- 协议不兼容、Runtime API 不兼容或数据库迁移不兼容时，清单必须给出明确原因；
- 本地版本高于线上版本时不自动降级；
- 更新检查失败时保留当前可用版本，不将网络错误误报为版本过期。

## 5. 分阶段任务

### U0：决策冻结与威胁建模

状态：未开始

- [ ] 确认 Desktop、Mobile、Gateway 是否独立版本节奏；建议独立版本。
- [ ] 确认 Mobile 的 iOS、Google Play、官网 APK 分发渠道。
- [ ] 确认 Gateway 镜像是公开 GHCR 还是私有 GHCR，以及拉取认证方式。
- [ ] 确认 stable/beta 频道和普通更新/安全更新的提示级别。
- [ ] 确认更新清单托管地址、缓存策略和 CDN/HTTPS 规则。
- [ ] 确认版本回滚、最小支持版本和协议兼容窗口。
- [ ] 输出版本兼容矩阵、更新威胁模型和产品文案约定。

退出条件：渠道、签名责任、兼容策略和清单地址没有 P0 未决项。

### U1：更新清单与发布合同

依赖：U0。

- [ ] 定义更新清单 JSON Schema 和示例 fixture。
- [ ] 定义 Desktop 平台/架构 artifact 字段和 Tauri `latest.json` 映射。
- [ ] 定义 Mobile 商店地址、APK 地址、最低系统和构建号字段。
- [ ] 定义 Gateway 镜像仓库、tag、digest、迁移版本和升级文档字段。
- [ ] 定义 `mandatory`、`minSupportedVersion`、`compatibility` 和变更说明规则。
- [ ] 增加清单生成器、校验器和非法清单测试。
- [ ] 约定发布清单只包含公开信息，不出现 token、内部 origin 或部署凭据。

退出条件：三端可以使用同一基础 Schema，不需要读取 GitHub Release HTML。

### U2：GitHub Release 与镜像发布流水线

依赖：U1、仓库迁移计划中的公开仓库边界。

Desktop：

- [ ] 建立多平台构建矩阵和 Release tag 规则。
- [ ] 生成 Tauri updater artifacts、签名文件和 SHA-256。
- [ ] 将 Tauri 公钥写入配置，私钥只存 CI Secret。
- [ ] 生成并发布 `latest.json`/产品清单，校验所有平台条目完整。

Mobile：

- [ ] 建立 EAS、App Store Connect 和 Google Play 的发布任务。
- [ ] Android 使用正式签名，递增 `versionCode`。
- [ ] 将商店版本、APK（如保留）和 GitHub Release 建立映射。

Gateway：

- [ ] 构建并推送版本化 GHCR 镜像。
- [ ] 生成 SBOM、漏洞扫描结果和不可变 digest。
- [ ] 将 Compose 生产配置从 `build:` 迁移到 `image:`。
- [ ] 明确迁移、健康检查、回滚和旧版本兼容窗口。

官网：

- [ ] 将发布清单或经过审核的静态数据接入 `/download` 和 `/releases`。
- [ ] 未通过校验的产物不得生成可点击下载链接。

退出条件：从一个候选版本开始，可以同时产出 Desktop 更新包、Mobile 发布元数据、Gateway 镜像和官网 Release 数据。

### U3：Desktop 自动更新

依赖：U1、U2。

主要范围：

- `<harndock-repo>/apps/desktop/src-tauri/Cargo.toml`
- `<harndock-repo>/apps/desktop/src-tauri/src/lib.rs`
- `<harndock-repo>/apps/desktop/src-tauri/tauri.conf.json`
- `<harndock-repo>/apps/desktop/src/App.tsx`

任务：

- [ ] 接入 Tauri updater/process 插件和最小权限配置。
- [ ] 启动后异步检查，不阻塞 Bootstrap UI 或 Runtime 启动。
- [ ] 设置页提供手动检查入口。
- [ ] 展示当前版本、目标版本、变更说明、下载进度和错误分类。
- [ ] Runtime 有任务运行时只允许下载，安装延迟到空闲或退出。
- [ ] 支持稍后提醒、忽略当前版本和显式重试。
- [ ] 签名、公钥、HTTPS、版本回滚保护全部启用。
- [ ] 更新失败不覆盖当前安装，并保留恢复路径。

验收：无更新不打扰；有更新可下载、校验、安装和重启；签名篡改、断网、中断和磁盘不足均不破坏当前版本。

### U4：Mobile 更新提示

依赖：U1、U2。

主要范围：

- `<harndock-repo>/apps/mobile/app.json`
- `<harndock-repo>/apps/mobile/android/app/build.gradle`
- `<harndock-repo>/apps/mobile/src`
- `<harndock-repo>/apps/mobile/src/sync/gateway-client.ts`

任务：

- [ ] 读取真实应用版本、构建号和运行平台，不再硬编码 `0.1.0`/`android`。
- [ ] 增加更新清单客户端、缓存和检查失败降级。
- [ ] 启动、回前台和设置页手动检查。
- [ ] iOS 跳转 App Store；Android 按分发渠道跳转 Google Play 或官网 APK。
- [ ] 显示最低支持版本、变更说明和兼容性提示。
- [ ] 支持稍后提醒，不在每次启动重复弹窗。
- [ ] 单独评估 Expo OTA；如果启用，必须使用 `runtimeVersion`，不能替代原生应用发布。
- [ ] 完成正式 Android 签名、版本递增和发布构建验证。

验收：商店版和 APK 版都能进入正确下载渠道；更新清单不可用时 Mobile 仍可正常使用；不尝试在 iOS/商店环境中自行安装二进制。

### U5：Gateway 版本与 Console 提示

依赖：U1、U2。

主要范围：

- `<dsh-sync-server-repo>/src/config.ts`
- `<dsh-sync-server-repo>/src/app.ts`
- `<dsh-sync-server-repo>/src/admin-server.ts`
- `<dsh-sync-server-repo>/apps/gateway-console/src/api.ts`
- `<dsh-sync-server-repo>/apps/gateway-console/src/App.tsx`
- `<dsh-sync-server-repo>/deploy/compose.yaml`

任务：

- [ ] Gateway 暴露只读 `appVersion`、`buildId`、`protocolVersion`、`schemaVersion`。
- [ ] Console 显示当前 Gateway 版本和 image digest。
- [ ] Console 登录后查询 Gateway 更新清单，只向管理员提示。
- [ ] 展示目标版本、迁移说明、升级文档、回滚版本和当前兼容状态。
- [ ] 生产 Compose 使用指定镜像和 digest，不依赖本地源码构建。
- [ ] 第一版只提供升级命令/文档；不开放容器控制权限。
- [ ] 后续若要一键升级，另行设计部署 Agent 或平台适配器。

验收：管理员能判断当前部署是否落后；升级提示不泄露私有镜像凭据、内部地址或数据库敏感信息；镜像 tag 被覆盖时仍以 digest 判断身份。

### U6：官网与发布可见性

依赖：U1、U2。

- [ ] 将更新清单与官网 Release 数据建立单向发布映射。
- [ ] `/download` 展示真实平台、版本、最低系统、校验和和安装说明。
- [ ] `/releases` 展示产品版本、Harness commit、Runtime API、Gateway digest 和变更摘要（按公开边界过滤）。
- [ ] planned/building/unavailable 平台不得生成死链接。
- [ ] 增加清单、Release 页面和下载入口的构建检查。

验收：官网显示的版本、URL、checksum 和安装说明可以回溯到同一个候选发布记录。

### U7：跨端测试、灰度与运维

依赖：U3、U4、U5、U6。

- [ ] 清单 Schema、SemVer、频道过滤和兼容矩阵单元测试。
- [ ] Desktop 更新成功、失败、中断、坏签名、回滚和 Runtime 忙状态测试。
- [ ] Mobile 商店/官网跳转、前后台、离线和重复提醒测试。
- [ ] Gateway 版本接口、digest 展示、迁移失败和回滚文档测试。
- [ ] GitHub 403/429、超时、清单损坏、Release 删除和 Tag 漂移测试。
- [ ] 更新日志不记录 token、私钥、完整环境变量或内部部署凭据。
- [ ] beta 灰度后再启用 stable；观察下载成功率、更新失败率、回滚率和旧版本占比。
- [ ] 发布手册包含签名轮换、密钥备份、镜像回滚、数据库迁移和事故处理。

退出条件：三端均有失败降级路径，发布和回滚由另一位维护者按文档独立执行。

## 6. 任务依赖图

```text
U0 决策冻结
   │
   ▼
U1 更新清单与兼容合同
   │
   ├──────────────┬──────────────┬──────────────┐
   ▼              ▼              ▼              ▼
U2 发布流水线   U3 Desktop     U4 Mobile      U5 Gateway
   │              │              │              │
   └──────────────┴──────────────┴──────────────┘
                          ▼
                    U6 官网可见性
                          │
                          ▼
                    U7 灰度与发布
```

协议或兼容矩阵发生变化时，必须先发布向后兼容的协议/清单，再发布 Gateway，最后发布 Connector、Desktop 和 Mobile；不能先让客户端依赖尚未部署的协议能力。

## 7. 更新提示状态

| 状态 | 条件 | 用户动作 |
| --- | --- | --- |
| `latest` | 当前版本与目标版本相同 | 无需操作 |
| `update-available` | 目标版本更高且兼容 | 查看说明、更新或稍后提醒 |
| `mandatory-update` | 低于最小支持版本或安全策略要求 | 查看原因并尽快更新 |
| `local-newer` | 本地版本高于清单版本 | 继续使用，不自动降级 |
| `incompatible` | 协议、Runtime API、系统或构建不兼容 | 查看原因，不安装 |
| `unavailable` | 清单暂时不可用或校验失败 | 重试，继续使用当前版本 |
| `installing` | 正在下载/安装/重启 | 查看进度 |
| `failed` | 下载、校验、安装或启动失败 | 重试或回滚 |

普通更新默认允许稍后提醒；同一版本的提示需要去重。安全更新、协议不兼容和低于最小支持版本的情形必须显示明确原因，但是否阻断功能由 U0 决策后实现。

## 8. 安全要求

- 所有清单和下载地址使用 HTTPS；生产环境不允许通过不安全 HTTP 检查更新。
- Desktop 更新包必须使用 Tauri 签名，不能只依赖 HTTPS 或 SHA-256。
- Gateway 镜像必须记录 digest；tag 不能作为唯一信任依据。
- 签名私钥、Android keystore、App Store 凭据和 GHCR 凭据只存在 CI Secret 或受控发布系统。
- 客户端只解析白名单字段，不执行清单中的命令、脚本或任意 URL scheme。
- Gateway Console 不获得 Docker socket 或宿主机管理权限。
- 更新日志只记录版本、阶段、结果和错误分类，不记录访问令牌或私密配置。
- 更新清单服务异常时必须 fail-open 到“继续使用当前版本”，不能把异常升级为破坏性操作。

## 9. V1 完成定义

只有同时满足以下条件，应用更新 V1 才能标记完成：

1. U0 的渠道、版本、兼容和签名决策已冻结。
2. U1 的 Schema、生成器和校验测试已通过。
3. 至少有一个真实候选版本完成 Desktop、Mobile、Gateway 和官网的发布映射。
4. Desktop 能完成签名更新和失败恢复。
5. Mobile 能按平台进入正确商店或 APK 渠道。
6. Gateway 能显示当前版本与目标镜像 digest，并有可执行的升级/回滚文档。
7. 断网、清单损坏、坏签名、旧版本、协议不兼容和回滚场景均有自动化或实机证据。
8. beta 灰度完成后，stable 发布和回滚由维护者按文档执行成功。

## 10. 待决事项

| 事项 | 最晚决策阶段 | 当前建议 |
| --- | --- | --- |
| 三端版本是否同步 | U0 | 独立版本，清单统一聚合 |
| Mobile 分发 | U0 | iOS/App Store；Android 优先 Google Play，APK 作为补充 |
| Gateway 镜像可见性 | U0 | 可公开发现版本，按部署权限控制拉取 |
| 更新清单托管 | U0 | 官网 HTTPS 静态清单 + GitHub Release assets |
| Desktop 更新方式 | U1 | Tauri Updater + 签名 `latest.json` |
| Gateway 一键升级 | U5 | V1 不做，先提供命令和回滚手册 |
| Expo OTA | U4 | 作为后续专项，不能替代原生发布 |
| 强制更新 | U0 | 默认不阻断，安全/协议不兼容时再按矩阵提升级别 |
