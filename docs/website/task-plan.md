# harndock 官网任务计划

版本：0.7
基线：`harndock-website` Tailcast `85843e5feaa46bdee05e180cf0c76f12408d7557`、官网三端原型与需求/开发文档 v0.3
目标：在 `<dsh-website-repo>` 独立目录中，基于 Tailcast 构建可发布的 Astro 官网，完整表达 Desktop、Mobile、Gateway 三端关系，并接入真实发布数据。

## 1. 工程边界

| 工程          | 负责内容                                                                                                    | 不负责                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `harndock`     | Desktop、Mobile、Gateway 实现；官网需求、原型与文档                                                         | 官网正式源码和部署产物                              |
| `harndock-website` | Tailcast/Astro 官网、静态数据、品牌资产、构建与发布                                                         | Runtime、Session、账号、设备管理和 Gateway 私有 API |
| Tailcast      | Astro 6 原始基线；官网当前已迁移至 Astro 7、Vite 8，保留 Tailwind CSS 4、SEO、View Transitions、响应式与 CI | harndock 产品文案、品牌资产、真实截图和下载数据      |

`harndock-website` 是独立 Git 工程和 npm 项目，不加入 `dsh-gui/pnpm-workspace.yaml`。两个工程通过文档、公开 Release 数据和静态资产约定协作，不通过源码 import 或运行时 API 耦合。

## 2. 当前状态

| 任务域                        | 状态   | 说明                                                                                                                      |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 三端产品定位与页面结构        | 已完成 | Desktop 执行源、Mobile Viewer / Controller、Gateway 连接层已冻结                                                          |
| 无依赖 HTML 原型              | 已完成 | `dsh-gui/docs/website/prototype.html` 已有三端 Tab、Mobile 下载区、工作流 Tab 和 FAQ                                      |
| 需求与开发文档                | 已完成 | v0.3 已明确 Tailcast 和 `harndock-website` 工程边界                                                                            |
| `harndock-website` Tailcast 初始化 | 已完成 | 已建立独立 Git 工程，commit、归档校验和与基线结果记录在 `UPSTREAM.md`                                                     |
| Tailcast 示例内容迁移         | 已完成 | 示例路由由 19 个收敛为 Home 与 404，保留 MIT License 和来源署名                                                           |
| 真实截图与品牌资产            | 阻塞   | 仓库仅有 Desktop / Mobile 应用图标和 vendor 文档图片，没有可用的三端产品截图；品牌关系也未冻结                            |
| Desktop / Mobile 下载数据     | 进行中 | 已建立静态 schema 和 `/download`；真实版本、URL、校验和与安装说明待接入                                                   |
| Download / Releases / About   | 已完成 | 5 个静态路由构建通过；无真实 Release 时展示明确空状态                                                                     |
| SEO / CI                      | 进行中 | 条件 canonical、JSON-LD、sitemap、robots 和 CI 产物检查已完成；Lighthouse 三项 100；harndock.com 已接入；OG 图待完成                |
| 依赖与发布准备                | 进行中 | Astro 7.2.9 / Vite 8.2.2 迁移、零审计、可复现安装、浏览器回归、Lighthouse 与通用发布手册已完成；目标平台配置待完成        |
| 国际化规划                    | 进行中 | 已完成 locale 基础、共享组件本地化、英文页面、双语平台/Release 字段、hreflang 与 sitemap 校验；文案审核和浏览器回归待执行 |

## 3. 决策门与输入

| 决策 / 输入                             | 影响任务                        | 最晚阶段 |
| --------------------------------------- | ------------------------------- | -------- |
| Tailcast commit、MIT License 与署名方式 | 初始化、LICENSE、NOTICE、审计   | P0       |
| 产品名 harndock 已确认；Logo、品牌关系声明          | Home、metadata、OG、Footer      | P0       |
| GitHub、文档、Issue、Release 真实地址   | Navbar、CTA、Footer、Download   | P0       |
| harndock.com 已确认；部署平台待定                      | `astro.config.mjs`、sitemap、CI | P1       |
| Desktop 四平台安装包与最低系统          | PlatformStatus、Download        | P2       |
| Mobile TestFlight / APK / 商店渠道      | Mobile Download                 | P2       |
| 是否中英文首发                          | 内容模型、路由、SEO             | P1       |
| Gateway 是否提供公开入口                | Hero、About、FAQ、外链          | P2       |

未关闭决策不得阻塞 Tailcast 工程初始化，但对应字段必须保留为空值或明确的 `planned` 状态，不能填入猜测链接。

## 4. 阶段计划

### P0：Tailcast 基线与内容冻结

目标：建立可追溯的独立网站基线，完成实现所需的产品输入。

- [x] 导入 Tailcast 公开源码并记录 HEAD commit、归档 SHA-256 和导入方式。
- [x] 保留并检查 Tailcast `license`；补充上游来源和必要署名说明。
- [x] 运行 Tailcast 原始依赖安装、lint 和 build，建立基线记录。
- [x] 确认产品名 `harndock` 和官网域名 `harndock.com`。
- [ ] 确认 Logo、品牌关系声明、GitHub / 文档 / Release / Issue 地址。
- [ ] 确认 Desktop 四平台和 Mobile iOS / Android 的状态词汇与渠道。
- [ ] 评审原型首屏、三端 Tab、Mobile 下载区和 FAQ，冻结首页信息架构。

交付物：

- `harndock-website` 初始 Tailcast 工程；
- Tailcast commit、许可证和原始构建记录；
- `docs/website/product-content.md` 或同等内容清单（如需要）；
- 品牌、链接、平台和发布渠道决策表。

验收：原始 Tailcast 可构建；License 未丢失；所有待确认字段被标记，不出现伪造产品内容。

### P1：Tailcast 清理与首页骨架

依赖：P0 工程基线；产品名固定为 harndock，中英文保持一致。

- [x] 删除或隔离 Tailcast 的虚构 Home、Services、Careers、Contact、Blog 和职位内容。
- [x] 保留并改造 `Layout.astro`、Theme、Navbar、View Transitions、SEO、Prettier、ESLint、CI 配置。
- [x] 以 `harndock` 内容替换 Home：Hero、SurfaceShowcase、SurfaceCards、ConnectionFlow、WorkflowTabs、FAQ、CTA、Footer。
- [x] 建立 `src/data/product.ts` 和 `src/data/platforms.ts`，统一维护三端文案与平台状态。
- [x] 将原型中的 Desktop / Mobile / Gateway CSS 预览迁移为 Astro 组件，保持稳定最小高度。
- [x] 首屏加入 `认识三端`、`下载 Mobile`、`浏览源代码`；未确认的源代码地址显示 pending，Mobile CTA 指向 iOS / Android 状态区。
- [x] 改造 `src/pages/404.astro`，清理遗留虚构链接和图片 import。

交付物：可识别的 harndock 首页、三端预览、数据文件、404 和保留 Tailcast 工程质量基线。

验收：`npm run build` 通过；首页首屏 320px–1280px 不溢出；三端 Tab、Workflow Tab、FAQ、移动菜单和 Mobile 下载锚点可用。

### P2：下载、Release 与 About 内容

依赖：P1 数据模型；Desktop / Mobile 渠道和平台规格决策。

- [x] 实现 `/download`，分组展示 Desktop 四平台和 Mobile iOS / Android。
- [x] 统一 `available`、`building`、`planned`、`unavailable` 状态组件与可点击规则。
- [x] 建立版本、最低系统、发行格式、安装说明、SHA-256、Release 和反馈入口字段。
- [x] available 平台只使用真实 URL；planned / building 平台使用解释性状态按钮。
- [x] 实现 `/releases`，为 harndock 版本、Harness commit、Runtime API 和变更摘要建立数据模型与空状态。
- [x] 实现 `/about`，说明 Desktop / Mobile / Gateway 边界、插件信任、开源协议和非官方关系。
- [ ] 若 Gateway 提供公开入口，加入登录引导和安全边界；不直接嵌入私有管理台。

交付物：Download、Releases、About 页面和静态发布数据 schema。

验收：Desktop 与 Mobile 入口视觉分组清楚；没有真实 URL 的平台无网络请求；版本信息、校验和与安装说明可逐项核对。

### P3：真实资产与 SEO 发布准备

依赖：P0 资产、P1 首页骨架、P2 页面与发布数据。

- [ ] 替换 Tailcast / 原型资产为真实 Desktop、Mobile、Gateway 截图或录屏首帧。
- [x] 生成 harndock favicon，完成社交标题、描述和 WebSite JSON-LD。
- [ ] 在正式品牌输入确认后生成 OG 图并检查图片文字。
- [x] 完成 `SITE_URL`、canonical、Open Graph / X metadata、sitemap、robots.txt 的条件配置。
- [x] 接入 `https://harndock.com` 为默认 `site` URL，覆盖双语 SEO 和 sitemap 产物检查。
- [x] 完成首页、Download、Releases、About、404 的标题、描述和结构化层级。
- [ ] 按 [i18n-plan.md](i18n-plan.md) 执行双语字典、语言路由、数据本地化、hreflang 和语言切换入口。
- [x] 删除 Tailcast 未使用的依赖、资产、页面和 CSS，但保留必要的许可与工程配置。

交付物：真实资产版网站、完整 SEO metadata、可分享页面和清理后的 Tailcast 工程。

验收：无 Tailcast 虚构文案、图片、品牌或链接残留；每个页面均能解释其产品语境；OG / sitemap / robots 输出正确。

### P4：质量、CI 与部署

依赖：P1–P3 完成，域名和部署平台确认。

- [x] 配置 npm CI：install、lint、format、typecheck、build、链接检查和产物检查。
- [x] 执行 1280px、768px、390px、320px 浏览器回归。
- [x] 验证 Desktop / Mobile / Gateway Tab、Workflow Tab、FAQ、移动菜单、ESC、跳转主内容和焦点回收。
- [ ] 验证 reduced motion、长中文、图片失败、计划平台和可下载平台状态；当前已覆盖 reduced motion、长中文和 planned 状态。
- [x] 执行 Lighthouse SEO / Accessibility / Best Practices；首页三项均为 100，无失败审计。
- [ ] 配置目标托管、HTTPS、缓存和 Preview / Production 环境；平台无关的构建、smoke 与回滚手册已完成。
- [x] 建立发布清单：版本、平台产物、SHA-256、安装说明、Release notes、截图、License、免责声明。

交付物：可部署 `harndock-website`、CI workflow、部署配置、发布和回滚文档。

验收：目标托管平台构建成功；全部可下载链接指向真实产物；关键无障碍检查通过；另一位维护者可按文档完成发布。

## 5. Tailcast 迁移清单

每次删除或改造 Tailcast 示例内容时逐项确认：

- [x] Navbar 不再指向虚构 Services / Careers / Contact / Blog。
- [x] Home 不再出现 startup、客户评价、职位、价格、虚构数字或虚构团队。
- [x] `public/` 中的 Tailcast favicon、OG 图、图片和字体已替换或删除。
- [x] `src/assets/` 中的示例图片和 logo import 已清理。
- [x] Tailcast View Transitions、SEO、sitemap、404、ESLint、Prettier 和 CI 在清理后仍可运行。
- [x] MIT License 和必要的 Tailcast 归属仍在仓库中。

## 6. 任务依赖图

```text
P0 Tailcast 基线 + 内容冻结
              │
              ▼
P1 清理模板 + 首页骨架 ────── P0 真实资产准备
              │                         │
              ▼                         ▼
P2 Download / Releases / About ─── P3 资产与 SEO
              └──────────────┬──────────┘
                             ▼
                      P4 质量与部署
```

国际化专项在 `WEB-P0-02` 的产品输入冻结后启动：`WEB-I18N-01` → `WEB-I18N-02` / `WEB-I18N-03` → `WEB-I18N-04` → `WEB-I18N-05`，其中 `WEB-I18N-04` 与 P3 SEO 汇合，`WEB-I18N-05` 与 P4 质量门禁汇合。

## 7. 任务编号与完成定义

| ID          | 任务                                              | 依赖                     | 验证                                       | 状态                                                                                                  |
| ----------- | ------------------------------------------------- | ------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| WEB-P0-01   | 导入 Tailcast 并记录 commit / license             | 无                       | 原始 `npm run build`                       | done                                                                                                  |
| WEB-P0-02   | 冻结产品名、真实链接和品牌声明                    | 无                       | 内容清单评审                               | todo                                                                                                  |
| WEB-P0-03   | 冻结 Desktop / Mobile 发布渠道                    | 无                       | 平台决策表                                 | todo                                                                                                  |
| WEB-P1-01   | 清理 Tailcast 虚构页面与资产                      | WEB-P0-01                | 链接、import、build 检查                   | done                                                                                                  |
| WEB-P1-02   | 迁移首页三端叙事和预览                            | WEB-P0-02                | 1280px / 320px 浏览器回归                  | done                                                                                                  |
| WEB-P1-03   | 建立平台与产品数据模型                            | WEB-P0-02、WEB-P0-03     | 类型检查、空 URL 不生成链接                | done                                                                                                  |
| WEB-P1-04   | 接入 Mobile 下载 CTA 与状态区                     | WEB-P1-02、WEB-P1-03     | iOS / Android 锚点验证                     | done                                                                                                  |
| WEB-P2-01   | 实现 Download 页面                                | WEB-P1-03、WEB-P0-03     | 320px / 1280px 分组、disabled 与链接规则   | done                                                                                                  |
| WEB-P2-02   | 实现 Releases / About 页面                        | WEB-P1-01、WEB-P1-02     | 路由、metadata、空状态与边界文案           | done                                                                                                  |
| WEB-P3-01   | 替换真实三端资产                                  | P0 资产准备              | 图片加载、alt、截图回归                    | blocked：真实三端截图待输入                                                                           |
| WEB-P3-02   | 完成 SEO / OG / sitemap / robots                  | WEB-P1-02                | 构建产物检查                               | blocked：正式域名与 OG 图待输入                                                                       |
| WEB-P4-01   | 建立 CI 与质量门禁                                | P1、P2、P3 阶段          | lint、format、build、Lighthouse            | done                                                                                                  |
| WEB-P4-02   | 配置部署和回滚                                    | WEB-P4-01                | Preview / Production smoke                 | blocked：托管平台与正式域名待输入；通用手册已完成                                                     |
| WEB-P4-03   | 升级 Astro 6.x 依赖并验证锁文件                   | WEB-P4-01                | `npm ci`、`npm run check`、依赖审计        | done                                                                                                  |
| WEB-P4-04   | 迁移 Astro 7 并清除剩余审计项                     | WEB-P4-03                | 全量构建、浏览器与 Lighthouse 回归         | done：Astro 7.2.9 / Vite 8.2.2、零审计、Production HTTP smoke、浏览器回归与 Lighthouse 三项 100       |
| WEB-P4-05   | 建立发布清单与平台无关运行手册                    | WEB-P4-01                | 维护者文档走查                             | done                                                                                                  |
| WEB-I18N-01 | 冻结 locale、英文术语和审核责任                   | WEB-P0-02                | 决策表、术语表和责任人                     | blocked：英文产品/法律表述待确认                                                                      |
| WEB-I18N-02 | 建立双语字典、类型和同构路由                      | WEB-I18N-01、WEB-P4-04   | 类型检查、缺失 key 构建失败、中文 URL 不变 | in progress：locale 配置、路由 helper、共享组件和语言/路由构建校验已完成                              |
| WEB-I18N-03 | 接入英文页面与平台/Release 本地化数据             | WEB-I18N-02、WEB-P0-03   | 双语页面、技术字段单一来源、无中文残留     | in progress：英文页面和双语 detail/channel/state/summary 字段已完成；真实 Release 数据待接入          |
| WEB-I18N-04 | 完成双语 metadata、canonical、hreflang 和 sitemap | WEB-I18N-02、WEB-I18N-03 | 双语产物、路由对称性、SEO 检查             | in progress：已通过 `SITE_URL` 构建验证 canonical、hreflang、x-default 和 sitemap                     |
| WEB-I18N-05 | 执行双语浏览器、可访问性和 Lighthouse 回归        | WEB-I18N-04              | 四档视口、键盘、交互、双语 Lighthouse      | in progress：四档视口、语言切换、Surface/FAQ、移动菜单 ESC 和关键 ARIA 已通过；双语 Lighthouse 待执行 |

任务状态只在完成验证后更新为 `done`；因产品决策未确认而暂停时使用 `blocked`，并记录阻塞输入，不用假链接绕过。

## 8. 风险跟踪

| 风险                      | 触发条件                                                    | 应对                                                                            |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Tailcast 升级导致结构变化 | 上游模板更新或 Astro 版本不兼容                             | 固定 commit；升级单独建任务并重新跑原始基线                                     |
| 遗留虚构内容              | 示例页面或资产未清理                                        | 运行链接扫描、文案扫描和截图审查                                                |
| 真实安装包未就绪          | 平台仍为 planned / building                                 | 状态按钮不生成下载请求，发布数据保留空 URL                                      |
| Mobile 渠道变化           | TestFlight / APK / 商店策略调整                             | 渠道作为数组或枚举管理，首页展示当前确认状态                                    |
| 官网误触达私有服务        | 引入 Gateway API、token 或 Session                          | 静态构建禁止运行时 API；CI 扫描私有 URL、凭据和会话内容                         |
| 许可证归属遗漏            | 删除 Tailcast 文件时遗漏 license / notice                   | P0 固定清单，P4 发布前检查 License 文件                                         |
| 产品文案漂移              | Desktop / Mobile / Gateway 需求变化                         | 每次需求变更同步 requirements、development、task-plan 和 `harndock-website` 数据     |
| Astro 主版本迁移回归      | Astro 7.2.9 / Vite 8.2.2 的编译器和前端构建链发生主版本变化 | 已完成静态、HTTP、四档浏览器与 Lighthouse 回归；后续只需跟随 Astro 安全更新维护 |
| 国际化内容漂移            | 中文、英文和需求边界不同步                                  | 以技术字段单一来源、术语表、双人审核和双语发布清单控制；详见 `i18n-plan.md`     |
