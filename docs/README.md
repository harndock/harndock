# Harndock 设计文档

本目录记录 Harndock 的产品边界、工程架构和实施计划。Harndock 是 DeepSeek Harness 的桌面宿主，不复制 Harness 的 Agent、Session、Tool、插件加载或 Web GUI 实现。

## 文档索引

- [品牌与兼容性约定](branding.md)：Harndock 名称、harndock.com 域名与历史标识保留边界。
- [跨端品牌与主题改造计划](branding-rollout-plan.md)：官网、Gateway、Desktop、Mobile 的 Logo、Indigo 色卡和浅色/深色主题统一计划。
- [总体架构](architecture.md)：进程边界、工程目录、启动链、插件集成和安全模型。
- [Runtime 管理](runtime-management.md)：Harness Runtime 的构建、安装、启动、更新和回滚。
- [浏览器自动化与图片识别](browser-automation.md)：Playwright MCP 的安装、启用、权限和图片输入限制。
- [实施路线](roadmap.md)：阶段目标、交付物、验收标准和待决事项。
- [GitHub 仓库迁移任务计划](harndock-migration-task-plan.md)：从 `dsh-gui` 迁移到公开 `harndock` 仓库的边界、阶段任务、验收门槛和发布后置项。
- [应用更新任务计划](update-task-plan.md)：Desktop、Mobile、Gateway 的 GitHub Release 驱动更新清单、平台更新方式、兼容矩阵、发布流水线和灰度验收。
- [移动端同步与远程控制](mobile-sync/README.md)：多端实时查看、远程控制、同步协议和开发拆分。
- [官网设计包](website/README.md)：Desktop、Mobile、Gateway 三端官网需求、开发说明、原型和任务计划。
- [插件中心原型](plugin-center/README.md)：Desktop、Gateway、Marketplace、Mobile 四端插件发现、商业化、治理和本地安装交互原型。
- [Gateway Web 与 Mobile 国际化任务计划](i18n-plan.md)：locale 契约、词典、双端迁移任务、测试门禁和发布里程碑。
- [Gateway Web 与 Mobile 国际化审计](i18n-audit.md)：当前文案、格式化、非翻译边界和迁移顺序。

## 当前决策

1. 桌面框架使用 Tauri 2。
2. 第一阶段复用 Harness 自带的 Web GUI，不重写聊天客户端。
3. Tauri 只管理窗口、Runtime 生命周期、更新和故障恢复。
4. Harness 上游源码保持只读，通过固定 commit 引入；产品定制通过外部 bundle 和 client plugin 完成。
5. Harness Host 只监听 `127.0.0.1`，WebView 默认不获得通用 Tauri IPC 权限。
6. 开发阶段先支持 macOS arm64，再扩展其他平台。

## 当前工程状态

P0 工程基线、P1 开发态 Runtime 托管和 P2 desktop profile 已于 2026-08-17 完成。P3 的 Runtime 契约、可复现 artifact 构建器、独立 verifier、Runtime bridge、Runtime Store、生产启动握手后端、artifact 安装器、Tauri resource 内置和首次启动自动发现已于 2026-08-18 完成第一轮；签名、正式安装包和 packaged app 启动观察 smoke 尚未完成。`harndock` 已初始化为独立 Git 仓库，Harness 以 `vendor/deepseek-harness` Git submodule 引入，并固定在 `cd5ef8148158c3a752a658978873241fdf8e2bbc`（`0.1.2-alpha.1`）。

当前桌面工程位于 `apps/desktop`，使用 Tauri 2、React、TypeScript 和 Vite。Bootstrap UI 启动 Rust Runtime Manager；Manager 通过开发适配器准备并托管 Harness `desktop` profile，识别随机回环端口的就绪 URL 后把主 WebView 导航到 Harness Web GUI。`packages/desktop-bundle` 和 `packages/client-desktop` 完全位于上游仓库之外，并通过 Harness profile 与 Client module loader 加载。Runtime 失败或崩溃时，窗口回到带诊断和重试操作的 Bootstrap UI。
