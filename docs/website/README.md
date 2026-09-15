# Harndock 官网设计包

工程名称为 `harndock-website`，本机检出目录仍为 `../dsh-website`；实际路径与 file 依赖不随品牌名自动迁移。

本目录保存 Harndock 官网的规划、开发说明和 HTML 原型。它是产品官网的独立设计资料，不属于当前 Tauri 桌面应用的运行时页面。

当前原型已经按三端产品重新组织：Desktop 作为本机执行源，Mobile 作为 Viewer / Controller，Gateway 作为认证、同步与设备管理层。首屏的端切换预览、工作方式、Runtime 状态、平台计划与 FAQ 都围绕这套关系展开。

## 文件索引

- [官网需求文档](requirements.md)：产品定位、页面结构、内容边界、视觉方向和验收标准。
- [功能开发文档](development.md)：三端页面映射、技术方案、数据模型、交互、SEO、发布和测试计划。
- [官网任务计划](task-plan.md)：按阶段、依赖、交付物和验收标准拆分的实施任务。
- [国际化任务计划](i18n-plan.md)：中英文路由、字典、数据、SEO、质量和发布任务。
- [发布清单](release-checklist.md)：生产发布前的平台产物、内容、构建、质量和回滚签核项。
- [部署与回滚手册](release-runbook.md)：静态构建契约、环境、缓存、smoke、发布和回滚流程。
- [HTML 原型](prototype.html)：不依赖构建工具的单文件原型，可直接用浏览器打开。

正式官网工程位于同级目录 [`harndock-website`](../../../dsh-website)，基于 [Tailcast](https://github.com/matt765/Tailcast) 初始化；本目录只维护需求、开发说明、任务计划和评审原型。

## 参考模板

- 项目：[matt765/Tailcast](https://github.com/matt765/Tailcast)
- 技术栈：Tailcast Astro 6 导入基线，当前正式工程使用 Astro 7、Vite 8、Tailwind CSS 4、TypeScript、ESLint、Prettier；HTML 原型无外部依赖
- 参考方式：复用页面节奏、深色主题、宽幅产品展示、Feature Tabs、Gallery、FAQ 和底部 CTA 的组织方式。
- 使用边界：不复制 Tailcast 的虚构产品文案、品牌资源或图片；正式实现需要保留 Tailcast 的 MIT License 和相应署名要求，并重新制作 harndock 的产品资产。

## 当前约定

- 产品名已确认为 `harndock`，官网正式域名为 `https://harndock.com`；Logo 和品牌关系声明仍需独立确认。
- 正式网站不放在 `dsh-gui/apps/website`，而是在同级 `harndock-website` 独立开发、构建和发布。
- 官网首发平台按产品结构设计为 Desktop 的 macOS arm64、macOS Intel、Windows x64、Linux，以及 Mobile 的 iOS / TestFlight、Android / APK；每个平台仍需独立接入可验证的安装包、渠道、校验和与安装说明。
- 首屏必须提供 `下载 Mobile` 入口，并能到达 iOS / Android 状态区域；没有真实产物时只展示解释性状态。
- 官网文案不宣称“官方产品”“绝对隐私”“永久免费”或“已支持自动更新”等未经确认的能力。
- 下载、版本号、GitHub、文档和更新日志地址在正式开发前统一配置，不在原型中伪造真实链接。

## 打开原型

```sh
open docs/website/prototype.html
```

原型没有外部依赖，所有视觉元素均使用 HTML/CSS 构造，适合先评审信息架构和交互方向。
