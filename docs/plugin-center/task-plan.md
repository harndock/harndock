# 插件中心 V1 任务规划

版本：1.0
状态：执行中，Sprint B Marketplace 与 Desktop 联调阶段
更新时间：2026-09-11

## 1. 目标与边界

V1 交付一条可实际运行的免费公开插件链路：内容管理员在独立工程 `dsh-center-plugin` 中维护插件条目和 GitHub Release，完成校验、审核、发布及下架；公开 Marketplace 只展示已发布插件；Harndock Desktop 从 Center API 获取安装声明，直接从公开 GitHub Releases 下载并在本地完成验证、授权确认、安装、健康检查和回滚。

职责固定为：

- Center 管目录、来源、审核状态和审计。
- GitHub Releases 管 Manifest Asset 和插件安装包。
- Marketplace 管公开发现、详情和 Desktop 安装引导。
- Desktop 管下载、验签、权限确认、本地安装和 Runtime 生命周期。

V1 明确不做：

- Marketplace 登录、注册和开发者中心。
- 价格、购买、订单、支付、订阅和许可证。
- 对象存储、CDN、Center 下载代理和私有 GitHub 仓库。
- Gateway 组织策略、远程安装任务和 Mobile 审批。
- 插件开发者自主提交门户；第一版由内容管理员代为登记公开 GitHub Release。

商业化、账号授权、开发者平台、Gateway 和 Mobile 原型仅作为 V2 预研，不进入 V1 开发和验收。

## 2. 工程与产品面

| 产品面 | 工程 | V1 用户 | 主要职责 |
|---|---|---|---|
| Center Admin | `<dsh-center-plugin-repo>/apps/center-admin` | 内容管理员、审核员 | 插件条目、版本、GitHub 来源、审核、发布、下架、审计 |
| Marketplace | `<dsh-center-plugin-repo>/apps/marketplace` | 无需登录的访客 | 搜索、分类、详情、版本、权限、来源和 Desktop 安装引导 |
| Center API/Worker | `<dsh-center-plugin-repo>/src` | 系统 | 公共/管理 API、Catalog、GitHub Provider、来源巡检和缓存 |
| Desktop Plugin Center | `<harndock-repo>/apps/desktop` | 本机用户 | 目录、详情、下载、预检、安装、启停、卸载和回滚 |
| Harness Runtime | `<harndock-repo>/vendor/deepseek-harness` 及运行时组装层 | 系统 | 加载已启用插件并上报 ready/health |

Center Admin 与 Marketplace 是两个独立页面、独立路由和独立权限面。二者共享 Center 数据合同，但 Marketplace 不能出现管理操作，Center Admin 也不承担用户市场、登录或商业化流程。

对应原型：

- `docs/plugin-center/center-admin.html`：内容运营管理端。
- `docs/plugin-center/marketplace.html`：V1 公开插件市场。
- `docs/plugin-center/desktop-shell-prototype.html`：Desktop 中的插件中心入口。
- `docs/plugin-center/full-prototype.html`：仅用于 V2 商业化预研。

插件更新专项执行计划见 [plugin-update-task-plan.md](plugin-update-task-plan.md)，用于拆分已安装插件的版本发现、更新确认、Runtime 重启、健康检查和自动回滚任务；该专项仍属于 V1 Desktop 能力，不引入账号、对象存储或 Gateway 远程安装。2026-09-10 已完成 U-01/U-04 版本状态与启用状态继承、U-02/U-03 合同和更新确认面板、U-05 Runtime 停止/重启/健康检查/失败恢复闭环，以及 U-06 下载任务去重、终态清理和重试基础实现。2026-09-11 已完成真实 GitHub 下载核验、跨进程孤儿 staging 清理，并发布符合当前归档合同的 `dsh-at-file@0.7.3`；远端资产已通过摘要复核和 Desktop 隔离安装器验收。当前因 Docker Desktop 的 `com.docker.vmnetd` helper 缺失导致本地 Center 离线，管理员授权恢复 Docker 后继续 Center 登记发布和 Desktop `0.7.2 → 0.7.3` 更新与失败回滚联调。

## 3. 状态口径

| 状态 | 含义 |
|---|---|
| 完成 | 代码已落地，有对应验证，当前范围不再依赖占位实现 |
| 部分完成 | 主链路存在，但页面、异常处理、测试或运营能力尚未达到 V1 验收 |
| 未开始 | 只有文档、原型或空骨架，没有可验收实现 |
| 延期 V2 | 明确不进入 V1，不阻塞首版发布 |

“接口存在”不等于“产品完成”；“HTML 原型存在”也不等于“真实页面完成”。

## 4. 当前实现盘点

### 4.1 已完成

- 独立 `dsh-center-plugin` 工程骨架：API、Admin、Worker、Migrate、React/Vite Web、PostgreSQL、Redis 和 Compose。
- Manifest v1 Schema、Ed25519 签名合同和 Center/Desktop 一致的验签向量。
- PostgreSQL Catalog、插件条目、版本、GitHub 来源和内容审计表。
- GitHub Release、Tag、commit SHA、Asset、Manifest Asset 存在性和仓库白名单基础校验。
- 管理 API 的插件创建/编辑、版本登记、提交审核、发布和下架基础链路。
- 公共 API 的目录、详情、指定版本和 GitHub 下载声明基础链路。
- Desktop 的 Center Client、Marketplace 目录分页、GitHub 安全下载、SHA-256、签名、兼容性和恶意归档预检。
- Desktop 的版本目录、active 指针、原子安装、已安装清单、启用/禁用、卸载、手动回滚和启动失败自动回滚。
- 使用 `javajeans/dsh-at-file` v0.7.2 完成真实 GitHub Release、Center 发布和 Desktop 本地安装验证。
- Center Admin 与 Marketplace 已分别输出独立 HTML 原型。

### 4.2 部分完成

- Center Admin：五个真实导航页面、插件条目 CRUD、版本审核、来源复检、巡检指标和审计查询已落地；生产管理员会话和角色权限后续单独立项。
- Marketplace：真实 React 页面已接公开目录、搜索、分类、服务端分页、URL 查询状态、详情、来源信息和 Desktop 深链唤起；真实双插件目录、分类/平台/关键词筛选和分页 API 已验收，Desktop 端分页合同与前后页控制已接入；当前仍缺浏览器自动化覆盖与超过单页容量的真实翻页视觉验收。
- 发布校验：已固化 Manifest、签名和 GitHub 元数据校验结果、失败原因及重新校验流程；签名撤销策略待补。
- 内容审计：已提供查询 API、筛选、详情和管理页面；总数、导出和生产角色权限待补。
- Desktop：插件目录分页已接入 Center 的 `limit/offset/hasMore` 合同；仍缺少明确的下载重试 UI、多平台 Asset 自动选择、多插件冲突处理和运行期间热启停。
- 自动化测试：已有合同和基础 API 测试，但缺少 PostgreSQL 集成测试、浏览器 E2E 和完整真实 GitHub 回归。

### 4.3 未开始

- V1 发布、下架、签名撤销、GitHub 故障和数据恢复 runbook。
- 管理员生产会话和角色权限。V1 本地/受控环境暂时继续使用 `x-center-admin-key`，生产化认证单独立项，不伪装成已完成。
- V1 发布、下架、签名撤销、GitHub 故障和数据恢复 runbook 以外的产品缺口见工作包状态，不再单列已完成的 Desktop 深链。

## 5. 工作包总表

| ID | 工作包 | 状态 | 优先级 | V1 验收结果 |
|---|---|---|---|---|
| PC-000 | 独立工程、部署与迁移底座 | 完成 | P0 | API/Admin/Worker/Migrate 和两个 Web 可构建，数据库可迁移 |
| PC-001 | Manifest v1 与签名合同 | 完成 | P0 | Center/Desktop 使用一致 Schema、签名消息和信任根 |
| PC-002 | 权限枚举、错误码和本地化映射 | 部分完成 | P0 | 管理端和 Desktop 能展示稳定错误码与权限说明 |
| PC-003 | Center 发布状态与 Desktop 安装状态 | 完成 | P0 | 非法状态转移被拒绝，两个状态域互不覆盖 |
| PC-004 | GitHub Release 来源模型与持久化 | 完成 | P0 | repository、tag、releaseId、commit SHA 和 Asset 可追溯 |
| PC-005 | GitHub Artifact Provider | 完成 | P0 | 发布登记和周期巡检都能处理来源、限流和异常 |
| PC-006 | GitHub Release 登记 API | 完成 | P0 | 管理员不上传文件即可登记版本草稿 |
| PC-007 | 发布前 Manifest/工件/签名校验 | 部分完成 | P0 | 每项校验有结构化结果，失败版本不能发布 |
| PC-008 | Desktop GitHub 下载任务 | 部分完成 | P0 | 下载支持进度、取消、失败清理和可控重试 |
| PC-009 | Desktop 本地安全预检 | 完成 | P0 | 哈希、签名、平台、版本和归档攻击测试通过 |
| PC-010 | 本地版本存储和 active registry | 完成 | P0 | staging、版本目录、原子切换和旧版本保留可用 |
| PC-011 | Runtime 加载与健康确认 | 部分完成 | P0 | ready 后健康确认，启动失败恢复旧版本，运行期事件可见 |
| PC-012 | Desktop 插件生命周期 | 部分完成 | P1 | 安装、启停、更新、卸载、回滚和状态反馈完整 |
| PC-013 | Desktop 一级入口、发现和详情 | 完成 | P1 | 保留 Workspace/Session 外壳，可通过菜单、页面和深链进入、浏览和返回 |
| PC-014 | Desktop 权限确认、进度和错误反馈 | 部分完成 | P1 | 用户看到真实权限、阶段、失败原因、重试和日志入口 |
| PC-015 | Marketplace 公共目录 API | 部分完成 | P0 | 搜索、分类、平台过滤、分页、详情和公开缓存完整 |
| PC-016 | Center Admin 内容管理产品化 | 部分完成 | P0 | 五个管理页面可完成内容发布闭环 |
| PC-017 | Marketplace V1 公共前端 | 部分完成 | P0 | 无登录浏览、搜索、分页、详情和 Desktop 正式深链可用 |
| PC-018 | GitHub 来源巡检 Worker | 完成 | P0 | 定期发现 Release/Tag/Asset 变化并保存来源状态与状态切换告警 |
| PC-019 | 更新策略与自动回滚闭环 | 部分完成 | P1 | 新版本失败恢复旧版本，更新路径有 E2E |
| PC-020 | 审计、日志、指标和诊断 | 部分完成 | P1 | request、actor、plugin、version 和来源检查可关联查询 |
| PC-021 | V1 运维与安全 runbook | 未开始 | P1 | 发布、下架、撤销、GitHub/Center 故障有执行手册 |
| PC-022 | 安全、兼容和端到端测试 | 部分完成 | P0 | 恶意包、来源漂移、验签失败、更新回滚报告通过 |
| PC-023 | Marketplace OAuth、账号和许可证 | 延期 V2 | P2 | 不进入 V1 |
| PC-024 | Gateway 组织治理和远程任务 | 延期 V2 | P2 | 不进入 V1 |
| PC-025 | 商业化、开发者中心和 Mobile | 延期 V2 | P2 | 不进入 V1 |
| PC-026 | 对象存储、CDN、镜像和私有源 | 延期 V2 | P2 | 不进入 V1 |

## 6. PC-016 Center Admin 详细拆分

PC-016 是当前第一优先级。原型以 `center-admin.html` 为基准，真实实现位于 `apps/center-admin`，不得继续把所有功能堆在一个 React 组件中。

| 子任务 | 页面/能力 | 后端依赖 | 验收标准 |
|---|---|---|---|
| PC-016-A | 管理端 Shell 与连接状态 | `/health/ready`、管理员认证 | 五个导航可切换；加载、401、依赖失败和空数据状态清晰；密钥不显示在页面正文或日志 |
| PC-016-B | 内容总览 | 汇总查询或现有数据聚合 | 展示插件数、已发布数、待审核数、来源异常数和最近活动；所有数字来自 API |
| PC-016-C | 插件条目 | 插件列表、详情、创建、更新 API | 支持搜索、状态/分类筛选、新建、编辑、详情和版本列表；字段有前后端校验 |
| PC-016-D | 版本登记与审核 | Release 登记、submit/publish/unpublish | 可录入 repository、tag、commit SHA、Asset 和 Manifest；审核员能查看权限、兼容性和校验结果后发布或退回 |
| PC-016-E | 工件与签名 | 来源检查结果、重新校验 API | 展示 Release ID、commit SHA、Asset 大小、SHA-256、签名 Key ID、检查时间和失败原因；可重新校验 |
| PC-016-F | 发布记录与审计 | 审计查询 API | 支持按插件、版本、动作、actor 和时间筛选；可查看事件详情，不展示密钥和敏感配置 |
| PC-016-G | 管理端测试 | API/React 测试设施 | 状态转移、401、校验失败、空状态和五个页面关键操作有自动化覆盖 |

PC-016 完成门禁：管理员能仅通过真实管理页面完成 `新建插件 → 登记 GitHub Release → 查看校验 → 提交审核 → 发布 → 下架 → 查看审计`，不需要手工调用 curl 或直接修改数据库。

### 6.1 PC-016 当前进度（2026-09-05）

| 子任务 | 状态 | 本轮结果 | 下一缺口 |
|---|---|---|---|
| PC-016-A | 完成 | 五页 Shell、会话级密钥、连接/401/错误/空数据状态和刷新/断开已接真实 API | 生产管理员会话延期单独立项 |
| PC-016-B | 部分完成 | 插件、发布、待审核、登记版本和来源异常统计来自真实 API | 最近活动和汇总分页待独立查询接口 |
| PC-016-C | 完成 | 搜索、状态/分类筛选、详情、新建、编辑、版本列表及前后端字段校验已完成 | 后续只处理测试发现的缺陷 |
| PC-016-D | 部分完成 | GitHub Release 登记、逐项校验结果、校验失败草稿、审核退回和发布前校验门禁已完成 | 来源重新校验、审核确认与更完整的退回工作流待开发 |
| PC-016-E | 完成 | 工件页已展示来源健康、SHA-256、大小、签名材料、检查时间和失败原因；已接入历史版本重新校验 API，Worker 具备限流退避 | 后续只处理全链路测试发现的缺陷 |
| PC-016-F | 部分完成 | 已接入审计查询 API，支持插件、版本、动作、actor、时间筛选和事件详情展开 | 分页总数、事件导出和生产角色权限待开发 |
| PC-016-G | 部分完成 | 17 项构建/API 回归通过，覆盖重新校验失败/通过、Worker 连续失败和审计筛选；五页浏览器冒烟通过 | 真实 `dsh-at-file` 浏览器发布闭环待 D/E/F 完成 |

## 7. PC-017 Marketplace V1 详细拆分

Marketplace 原型以 `marketplace.html` 为基准。第一版是无需登录的公开目录，不出现开发者中心、账号、价格或许可证。

| 子任务 | 页面/能力 | 验收标准 |
|---|---|---|
| PC-017-A | 公开目录 | 从真实 Center API 加载 published 插件；支持加载、错误、空数据和重试 |
| PC-017-B | 搜索、分类和分页 | 查询条件映射到 `q/category/platform/limit/offset`，刷新后结果一致 |
| PC-017-C | 插件详情 | 展示简介、版本、类型、平台、Harness/Runtime 兼容性、权限和 GitHub 来源 |
| PC-017-D | Desktop 安装引导 | 未安装 Desktop 时给出说明；已安装时进入 Desktop 插件中心，不在浏览器执行 shell/git/npm |
| PC-017-E | 边界检查 | 页面和构建产物中没有登录、开发者中心、价格、购买、支付、订单和许可证入口 |
| PC-017-F | 前端测试 | 搜索、详情、API 失败、下架不可见和响应式页面通过测试 |

本轮（2026-09-07）已补齐 PC-015/PC-017 的分页基础能力：公共目录接口按 `limit + 1` 查询并返回 `hasMore/nextOffset`；Marketplace 默认每页 6 条，支持搜索、分类、平台筛选、页码、URL 状态恢复、浏览器前进/后退和请求取消；目录加载失败可显式重试，详情页保留 Desktop 深链及未响应提示。已通过 Marketplace URL 筛选状态浏览器冒烟，Center 类型检查、构建和 28 项回归测试通过，线上 `7118/7119` 已更新到包含该能力的构建。真实 `dsh-at-file` v0.7.2 与 `dsh-univer-office` v0.2.14 已同时发布；以 `limit=1` 验证了两页目录的 `hasMore/nextOffset` 边界、末页空结果，以及分类、平台和关键词筛选。Marketplace 默认每页 6 条，仍需增加到至少 7 个发布条目，才能完成页面“下一页”按钮的真实视觉验收。

## 8. PC-018 Worker 与运营闭环

| 子任务 | 能力 | 验收标准 |
|---|---|---|
| PC-018-A | 来源状态模型 | 已完成 | 保存最后检查时间、状态、错误码、GitHub ETag/Release ID 和失败次数 |
| PC-018-B | 周期巡检 | 已完成 | Worker 启动和周期执行 Release、Tag、commit SHA、Asset 和 Manifest Asset 检查；生产默认 15 分钟并支持环境变量覆盖，403/429 使用有限退避并在限流后停止当前批次 |
| PC-018-C | 来源异常处理 | 已完成 | 异常只更新来源健康状态和审计，不自动下架或影响 Desktop 已安装版本；`source_status=failed` 的版本已从公共安装候选过滤，完整复核成功后自动恢复可见；可选 Webhook 只在异常和恢复状态切换时告警 |
| PC-018-D | Admin 展示 | 已完成 | 总览显示来源异常数，工件页显示健康状态、连续失败次数、检查时间、失败原因和重新校验入口 |
| PC-018-E | 指标与日志 | 已完成 | Worker 输出并持久化成功率、耗时、未修改、限流、漂移、跳过和延迟统计，管理端可查询最近运行结果；可选 Webhook 告警失败不阻断巡检 |

## 9. 执行顺序

### Sprint A：管理端可用闭环，当前轮

1. PC-002：冻结管理端权限说明和错误码。
2. PC-016-A/PC-016-C：拆分真实管理端页面结构，完成 Shell、插件列表、详情、新建和编辑。
3. PC-016-D/PC-007：完成版本登记、结构化校验结果、审核、发布和下架。
4. PC-016-E/PC-016-F/PC-020：增加来源检查详情和审计查询 API/UI。
5. PC-016-G：使用 `dsh-at-file` 覆盖管理端完整浏览器流程。

Sprint A 退出条件：`http://127.0.0.1:7118/console/` 不再是静态导航和手工 API 工具，五个页面均使用真实数据完成发布闭环。

本轮执行记录（2026-09-06）：完成 PC-018，新增来源健康模型、`006_source_health.sql` 与 `007_source_sweep_metrics.sql`；Worker 已按配置周期扫描 GitHub Release 来源并保存健康状态、检查时间、失败次数、ETag/Release ID，巡检结果已持久化并由管理端总览展示。GitHub Provider 已支持 ETag 条件请求、304 复用最近一次通过的校验、固定 commit 复核、403/429 有限指数退避和 `Retry-After` 解析；限流后停止当前批次剩余请求，失败版本已从公共 Marketplace 安装候选过滤，远端恢复后可通过完整复核自动恢复。新增 `SOURCE_SWEEP_ALERT_WEBHOOK_URL` 状态切换告警，并修复 Marketplace 静态页面从管理端 `7118` 请求公开 API 的跨端地址问题。Marketplace 已完成真实目录、搜索、分类、详情、权限、GitHub 来源和 Desktop 安装引导的浏览器冒烟；真实 `dsh-at-file` v0.7.2 可见。27 项 Center 回归和 41 项 Desktop 原生测试通过。

深链联调记录（2026-09-06）：正式注册 `harndock://plugins/{pluginId}`，Marketplace 详情可唤起 Desktop，Desktop 对协议、主机、路径和 Plugin ID 做白名单校验；macOS bundle 的 `CFBundleURLTypes` 已验证，Windows/Linux 接入单实例插件。真实 `dsh-at-file` v0.7.2 已完成冷启动定位、热启动定位、详情自动打开和单实例可视验收；深链冷启动不会被已配对 Runtime 的自动导航覆盖，返回启动页会按状态恢复或启动 Runtime，并已实际进入 Harness 页面。`@` 候选建议已在真实 Runtime 中显示 `at-file 文件与文件夹`。本地 HTTP 接收器已真实收到来源异常 `critical` 和恢复 `info` 两种 Webhook。由于 Docker BuildKit 拉取 `node:22.22.3-slim` 元数据超时，本轮使用已构建的本地 Center `dist` 更新运行中的 `7118/7119` 服务镜像，并保留 `pre-deeplink-20260906` 回滚标签；`7118` 实际静态资产已确认包含 `harndock://plugins` 深链入口，`7118/7119` 的 live/ready 检查均通过。锁屏造成的 GUI 阻断已解除，本轮证据已补齐。

本轮执行记录（2026-09-08）：按插件中心重设计需求完成第一条真实内容链路。新增 `marketplace_banners` 数据表和公开/管理 API，管理端可配置目标插件、图片 URL、排序、状态和生效时间，第一版轮播严格只进入插件详情并记录审计；Marketplace 已读取公开轮播并支持详情页顶部展示。插件条目新增 Markdown 详情内容和受约束的 YouTube/Bilibili 视频配置，管理端提供 Markdown 实时预览，Marketplace 详情按白名单平台生成嵌入播放器。补充图片 URL、视频 ID、轮播 CRUD、Markdown 内容公开和非法输入测试；新增真实轮播组件测试，覆盖自动加载、搜索、切换、详情跳转、Markdown/视频渲染、Escape 关闭和失败重试。Center 类型检查、双 Web 构建、Marketplace 3 项前端测试和 Center 32 项回归测试通过；根目录 `pnpm test` 已串联执行全部检查。数据库迁移 `008_marketplace_banners.sql` 与 `009_plugin_media.sql` 已在本地真实 PostgreSQL 执行，运行中的 `7118/7119` 已更新到本轮构建。临时视觉验收数据已清理，公开轮播接口恢复为空。剩余工作是解锁 Mac 后完成管理端配置、Marketplace 轮播和详情页的浏览器视觉验收。

### Sprint B：公开 Marketplace 可用闭环

1. PC-015：补齐分类、总数、平台过滤、分页和缓存语义。
2. PC-017-A/PC-017-B/PC-017-C：公开目录、搜索、分类、详情全部接真实 API。
3. PC-017-D：接入 Desktop 安装引导。
4. PC-017-E/PC-017-F：移除并防止 V1 越界入口，补前端测试。

Sprint B 退出条件：未登录用户可以浏览和查看所有公开信息，草稿、审核中、下架和来源失效版本不可见，页面不包含账号或开发者中心。

### Sprint C：来源巡检与运营保障

1. PC-005/PC-018：实现 Worker 来源巡检、退避、状态持久化和重新校验。
2. PC-020：补齐审计、日志、指标和诊断关联。
3. PC-021：编写发布、下架、签名撤销、GitHub 故障和数据库恢复 runbook。
4. PC-022：完成真实 PostgreSQL、GitHub 异常和安全专项测试。

Sprint C 退出条件：来源漂移能够被发现、展示和阻断，故障处置有可执行手册。

### Sprint D：Desktop 完整回归

1. PC-008/PC-014：下载重试、错误反馈和日志入口。
2. PC-011/PC-012/PC-019：运行期健康事件、可控热启停、更新和回滚。
3. PC-022：以 `dsh-at-file` 完成 `Admin → Marketplace → Desktop → Runtime` 全链路 E2E。

Sprint D 退出条件：macOS arm64 至少完成安装、启动健康、更新、失败回滚、禁用、重新启用和卸载，并保留审计与诊断证据。

## 10. 测试阶段划分

| 测试阶段 | 进入条件 | 测试重点 |
|---|---|---|
| T0 合同/单元测试 | 随开发持续执行 | Manifest、签名、状态机、GitHub 来源、错误码 |
| T1 管理端功能测试 | Sprint A 完成 | 五个页面、CRUD、登记、审核、发布、下架、审计 |
| T2 Marketplace 功能测试 | Sprint B 完成 | 公开目录、搜索、详情、边界检查和下架不可见 |
| T3 集成与故障测试 | Sprint C 完成 | PostgreSQL/Redis、Worker、GitHub 限流、漂移、删除和恢复 |
| T4 Desktop 全链路测试 | Sprint D 完成 | 下载、权限、安装、Runtime、更新、回滚和卸载 |
| T5 V1 发布验收 | 所有 P0 完成且无阻断缺陷 | 真实 `dsh-at-file` 全链路和发布 runbook 演练 |

管理端已通过 T0 和 T1 的主要功能测试；Marketplace 已进入 T2，完成真实目录、搜索、分类、分页、URL 状态、详情和 Desktop 深链浏览器冒烟，失败重试与未安装客户端提示已落地。真实两个已发布插件已经完成 API 分页及筛选验收；仍需补浏览器自动化覆盖和超过默认单页容量的视觉分页验收。Center 已在本地 Docker compose 中恢复并完成 `dsh-at-file@0.7.3` 的真实 GitHub 登记、11 项来源校验、审核和发布，公开接口已返回 0.7.3。Desktop 已具备主链路测试条件，并已验证 `dsh-at-file` v0.7.1/v0.7.2 可经配置代理从 GitHub 下载，大小与摘要和 Center 声明一致；本机 v0.7.2 安装状态为 healthy/enabled。由于当前可见窗口使用旧 release bundle，T4 仍需使用新版构建完成真实旧版本到新版本切换、启用状态继承、失败回滚和故障场景。

## 11. Definition of Done

- 功能进入对应工程，原型、开发文档、架构文档和任务状态同步。
- 页面使用真实 API，不以静态假数据或手工 curl 作为完成标准。
- 正常路径和至少一个关键失败路径有自动化测试。
- 管理写操作记录 actor、pluginId、version、action、requestId 和必要的脱敏元数据。
- GitHub repository、Release ID、Tag、commit SHA、Asset、Manifest、SHA-256 和签名可以关联追溯。
- 公共 API 和 Marketplace 不暴露 draft、review、unpublished 或来源失效版本。
- Center 不持久化插件包，也不代理 Desktop 下载流量。
- Desktop 只安装 Center 声明的公开 GitHub Release，并在本地重新验证。
- 安装失败清理 staging，更新失败恢复上一健康版本。
- 日志不记录管理员密钥、私钥、token、cookie、完整环境变量或用户项目内容。
- V1 Marketplace 构建产物没有登录、开发者中心和商业化入口。

## 12. V1 发布门禁

- Center Admin 五个页面真实可用，完整发布流程不依赖命令行。
- Marketplace 无需登录即可浏览，且只展示 published、来源有效的内容。
- `dsh-at-file` 可从公开 GitHub Release 登记、审核、发布并安装到 Desktop。
- Desktop 完成 SHA-256、Ed25519、兼容性、权限和归档安全校验。
- Release 删除、Tag 漂移、Asset 替换、哈希不一致、签名失败和 GitHub 限流均有明确处理。
- Center 或 GitHub 暂时不可用时，已安装插件不会被静默删除。
- 所有 P0 工作包完成，没有阻断级安全或数据一致性缺陷。
- V1 不依赖账号、开发者中心、支付、许可证、Gateway、Mobile 或对象存储。

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 管理端 UI 进度被 API 基础能力掩盖 | 高 | 页面、API、测试分别标状态；以浏览器发布闭环作为 PC-016 完成门禁 |
| GitHub 下载在部分网络环境不可达 | 高 | Desktop 代理配置、可控重试、明确错误和 V2 镜像 Provider |
| Release Tag 被移动或 Asset 被替换 | 高 | 固定 Release ID、commit SHA、Asset 哈希、签名和 Worker 复核 |
| GitHub API 限流 | 中 | ETag、缓存、退避重试和最近一次有效状态，不影响已安装插件 |
| Host 插件拥有本机代码执行能力 | 高 | 内容审核、签名、权限确认、隔离版本目录、健康检查和回滚 |
| Center 与 Desktop 合同不一致 | 高 | 共享测试向量、版本化 Manifest/Runtime API 和真实 E2E |
| V2 商业化内容混入 V1 | 中 | Marketplace 边界自动检查；V2 只保留在独立原型和延期任务中 |
| 审计事件已写入但无法查询 | 中 | PC-016-F 与 PC-020 在 Sprint A 一起交付，不将数据库记录等同于审计产品完成 |
