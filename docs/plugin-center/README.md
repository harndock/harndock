# 插件中心原型

本目录包含 DeepSeek Harness 插件中心的各端 HTML 原型、V1 内容平台设计、功能开发、技术架构和任务规划文档。当前已确认 V1 使用 GitHub Releases 承载插件工件。

## 工程约定

插件中心使用独立同级工程 `dsh-center-plugin`（本机目录：`<dsh-center-plugin-repo>`），工程架构与 `dsh-sync-server` 一致：pnpm workspace、TypeScript/Fastify API、React/Vite Web、PostgreSQL/Redis、同镜像 API/Admin/Worker/Migrate 和 Docker Compose。V1 只维护插件内容，分为内容管理端和公共 Marketplace 前端。

Marketplace 公共前端与中心管理端放在新工程；Desktop 插件中心从 Center API 拉取目录和安装声明，再直接从公开 GitHub Releases 下载，保留在 `dsh-gui`；`dsh-sync-server` 和 Mobile 暂不接入 V1。Center 不保存或代理插件包，不共用账号、数据库或密钥。完整目录及部署约定见 [架构文档](architecture.md#2-工程落点)；当前 GitHub 分发、Desktop 直装、管理端发布审核、历史来源复核、限流退避和基础 Worker 巡检已经跑通，下一阶段补来源告警和真实 `dsh-at-file` 浏览器发布闭环。

## 原型范围

管理端和用户侧市场是两个独立产品面：`center-admin.html` 只面向内容管理员，负责目录与发布运营；`marketplace.html` 只面向用户，负责公开发现、详情和安装引导。两者共享 Center 的内容合同，但不共享页面、权限和操作入口。

- 发现页：精选插件、分类筛选、搜索和插件卡片
- 已安装：本地插件状态、启用/禁用和配置入口
- 更新：可更新插件与批量更新入口
- 详情面板：版本、能力、权限、兼容性、GitHub Release 来源和校验信息
- 本地安装流程：检测 Harness、权限确认、模拟安装进度、安装完成状态
- 响应式布局：桌面三栏和移动端抽屉/底部详情

## 完整商业化原型

- [完整交互原型](full-prototype.html)：账号登录、客户端授权、付费购买、许可证、本地安装、订阅订单、组织席位和开发者发布等 V2 素材。
- [产品设计](product-design.md)：GitHub 分发 V1 的产品边界、管理端/公共前端/Desktop 分工，以及 V2 身份、商业化和组织治理预研。
- [功能开发详细文档](development.md)：GitHub Release 来源合同、Manifest、状态机、API、本地安装门禁、验收标准和测试矩阵。
- [技术架构设计](architecture.md)：Center、GitHub Provider、Marketplace、Desktop、Harness Runtime 和安装器的组件边界与数据流。
- [任务规划](task-plan.md)：GitHub 分发方案下的里程碑、工作包、依赖、排期、Definition of Done、发布门禁和风险。
- [插件更新专项任务计划](plugin-update-task-plan.md)：已安装插件的版本发现、更新按钮、权限确认、Runtime 重启、失败回滚和真实插件验收计划。
- [轻量安装原型](prototype.html)：只聚焦发现、详情和本地安装链路，适合对照早期方案。

## 各端原型套件

- [原型套件入口](index.html)：从一个入口查看各端定位和推荐评审顺序。
- [Desktop 原型](desktop.html)：进入真实 Harness Desktop 外壳后的插件中心入口和本地安装流程。
- [Desktop Shell 原型](desktop-shell-prototype.html)：对齐当前 Harness 浅色窗口、Workspace/Session 侧栏和全局插件中心入口。
- [Center Admin 原型](center-admin.html)：内容管理员维护插件条目、GitHub Release、Manifest、审核、发布、下架和发布记录。
- [Gateway 原型](gateway.html)：组织管理员的插件治理、成员席位、安装任务、插件源、策略和审计。
- [Marketplace 原型](marketplace.html)：V1 公开插件目录和 Desktop 安装引导，不包含登录、开发者中心、支付和许可证。
- [Marketplace V2 交互原型](marketplace-v2.html)：Desktop 内嵌版市场重设计，包含后台可配置轮播、发现/已安装/更新视图、Markdown 详情内容和 YouTube/Bilibili 视频交互。
- [Center Admin V2 管理端原型](center-admin-v2.html)：轮播图片 URL、目标插件、发布状态、Markdown 详情编辑和视频配置。
- [Mobile 原型](mobile.html)：移动端许可证、设备、远程安装任务和本地权限审批。

## 打开方式

建议先打开 [原型套件入口](index.html)，再分别查看 Center Admin、Marketplace、Desktop、Gateway 和 Mobile。完整商业化流程可打开 [full-prototype.html](full-prototype.html)。所有 HTML 原型都不依赖构建工具或网络资源。

## 设计决策

1. 插件中心的可信边界是本地 Harness，而不是浏览器页面。页面始终展示当前本地客户端版本、连接状态和安装范围。
2. 安装前明确列出文件、网络和命令执行权限，用户确认后才进入安装流程。
3. 插件卡片只承担发现和快速动作；详细信息、权限和安装反馈集中到右侧详情面板，避免用户在列表中迷失。
4. 第一版使用当前用户安装范围，后续再扩展工作区级安装、组织策略和远程插件源。

## 后续接入点

- 用真实插件目录 API 替换原型内置数据。
- 用 Tauri command 或本地安装协议替换模拟安装器。
- 接入 GitHub Release 下载、签名/hash 校验、版本回滚和安装日志。
- 通过 `ArtifactProvider` 抽象预留企业镜像、CDN、对象存储和私有源，不进入 V1。
