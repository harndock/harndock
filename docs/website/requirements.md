# harndock 官网需求文档

工程名称为 `harndock-website`，本机检出目录仍为 `../dsh-website`；实际路径与 file 依赖不随品牌名自动迁移。

版本：0.5
状态：产品名 harndock、官网域名 harndock.com 和三端结构已确认；下载产物与托管部署待接入

正式官网工程位于同级目录 `harndock-website`，由 Tailcast 的 Astro 6 基线迁移至 Astro 7 + Vite 8，并继续使用 Tailwind CSS 4；本目录只保存需求、原型、开发说明和任务计划。

## 1. 产品与官网定位

harndock 是围绕 DeepSeek Harness 的多端工作台，由三个互相配合的产品面组成：

- **Desktop**：可安装、可恢复的本机桌面宿主，负责启动和管理 Harness Runtime。
- **Mobile**：React Native Viewer / Controller，用于在手机上查看 Session、接收实时事件并进行有限控制。
- **Gateway**：独立 Web 管理入口，负责当前账号的认证、设备、PC Runtime、Token、pairing、连接诊断和隐私设置。

PC Harness Runtime 仍是模型、工具、文件与 Session 的唯一执行源。Gateway 负责认证、转发、存储和协调，不替代本机 Runtime；Mobile 不复制 Desktop 的三栏界面，只承载 Viewer / Controller 场景。

官网的任务是让访客快速理解“三端如何协作”，并为 Desktop、Mobile 和 Gateway 分别提供产品入口、状态说明和后续下载位置，而不是把官网做成聊天页或运维后台。

## 2. 目标

### 2.1 用户目标

- 第一次访问 5 秒内理解 harndock 是连接 Desktop、Mobile 与 Gateway 的 Harness 工作台。
- 首屏可看到三端入口，并能进入 Desktop / Mobile 的下载或发布状态区域。
- Harness 用户能理解本机 Runtime、Gateway 和 Mobile 的边界与数据流向。
- 用户能区分已实现、开发中、计划中和暂不可用的能力。
- 开源用户能直接进入 GitHub、架构文档和贡献入口。
- 桌面、平板和手机访问时均保持清晰、可操作、可访问。

### 2.2 项目目标

- 建立统一的 harndock 产品视觉基线和三端内容模型。
- 用真实产品界面或高保真 CSS 界面表达 Desktop、Mobile、Gateway，而非泛化 AI 插图。
- 将平台、版本、架构、下载 URL、校验和与发布状态集中为可替换数据。
- 首期支持简体中文和英文，确保双语页面、下载入口、Release、About、metadata 和搜索引擎信号一致。
- 为 `/download`、`/docs`、`/releases` 和 `/about` 预留清晰的扩展边界。

## 3. 非目标

- 官网不实现聊天、Agent、插件安装、远程 Runtime 或 Gateway 管理功能。
- 不把官网做成 Harness Web GUI 的复制品，也不把 Gateway 管理台做成跨账号运维后台。
- 没有数据来源时不展示用户数、下载量、性能指标、评价或稳定性百分比。
- 不承诺尚未完成的生产 Runtime、自动更新、插件市场、附件、跨 PC 迁移或端到端加密。
- 首轮不加入定价、账号注册、在线客服或复杂博客系统。

## 4. 目标用户

| 用户 | 主要问题 | 官网需要给出的答案 |
| --- | --- | --- |
| 桌面端用户 | 这是什么，能否安装 | Desktop 定位、平台、版本与下载状态 |
| 移动端用户 | 手机能看到和控制什么 | Mobile Session、实时同步、审批与平台入口 |
| Gateway 管理者 | Gateway 管什么，是否替代 Runtime | 设备、Runtime、Token、诊断和边界说明 |
| Harness 用户 | 三端如何协作 | Desktop → Gateway → Mobile 的连接关系 |
| 开发者和插件作者 | 能否扩展，项目是否透明 | GitHub、架构、Profile / Plugin、开发文档 |

## 5. 信息架构

首版继续采用一页式首页，主导航和章节按三端产品叙事组织：

```text
首页 /
├── Hero：三端定位、Desktop / Mobile 入口、GitHub、端切换产品预览
├── Surface strip：Desktop host / Mobile viewer / Gateway admin
├── Products：三端职责、能力边界和使用场景
├── How it connects：PC Runtime -> Gateway -> Mobile 的关系
├── Workflow tabs：启动 Runtime、失败恢复、移动端接管
├── Release status：桌面平台状态 + 移动端 iOS / Android 下载状态
├── FAQ：三端关系、Gateway 边界、Mobile 能力、插件与凭据
├── CTA：查看平台状态、参与 GitHub
└── Footer：产品、工作方式、下载、FAQ、GitHub、许可和免责声明
```

后续路由：

- `/download`：桌面四平台与移动端 iOS / Android 的版本、下载、校验和、安装说明。
- `/docs`：指向仓库文档或独立文档站。
- `/releases`：版本记录与更新日志。
- `/about`：项目关系、开源协议、维护方式与安全边界。

## 6. 页面需求

### 6.1 导航

- 左侧显示 harndock 品牌标记和产品名称。
- 桌面端显示“产品”“工作方式”“下载”“FAQ”四个锚点。
- 右侧显示 GitHub、平台状态按钮；首屏另提供明确的 `下载 Mobile` 入口。
- 移动端收纳为菜单按钮，支持 Enter / Space、ESC 关闭、焦点回到菜单按钮。
- 滚动超过约 24–48px 后显示半透明背景、模糊层和边框。

### 6.2 Hero 与三端预览

首屏应表达“一个入口，连接你的工作流”，并包含：

- harndock 产品名和一句话定位。
- `认识三端`、`下载 Mobile`、`浏览源代码` 三个行动入口。
- `Desktop`、`Mobile`、`Gateway` 三个可切换的产品预览 Tab。
- Desktop 预览：Runtime ready、Workspace / Profile、Session 入口。
- Mobile 预览：Session 列表、在线状态、实时事件或审批入口。
- Gateway 预览：设备、PC Runtime、Stream、管理导航或连接诊断。
- 不使用“官方产品”“绝对隐私”“永久免费”等未经确认的表述。

### 6.3 三端产品说明

使用三个高密度产品卡片，每个卡片包含职责、三项以内能力和状态标签：

1. **本机 Desktop / 执行源**：启动、停止、健康检查、Runtime 版本与 Profile、本地会话和插件工作流。
2. **移动 Mobile / 随身端**：Session 时间线、历史补发、实时流、断线重连、prompt、停止和一次性审批。
3. **远程 Gateway / 连接层**：设备与 PC Runtime、Pairing、Token、会话撤销、隐私设置和连接诊断。

### 6.4 工作方式

用三段关系说明边界：

```text
PC Harness Runtime（本机执行源）
        ↓ 出站 TLS / WebSocket
Gateway（认证、转发、存储、协调）
        ↓ 同步 Session 与命令状态
Mobile（Viewer / Controller）
```

说明必须同时强调：Gateway 不运行模型和工具；PC Runtime 不要求对家庭网络开放端口；Mobile 只展示和控制已定义的 V1 能力。

### 6.5 工作流功能预览

采用左右 Tab 布局，至少包含：

- **启动 Runtime**：显示 desktop profile 加载、127.0.0.1、插件图和 Ready 状态。
- **失败可恢复**：显示 Crashed、日志已捕获、用户数据保留和 Retry 入口。
- **移动端接管**：显示审批等待、命令串行、Session cursor 恢复和 Review approval 入口。

Tab 支持点击、键盘聚焦和移动端触摸；状态切换不依赖自动轮播。

### 6.6 下载与版本状态

- Desktop 展示 macOS arm64、macOS x64、Windows x64、Linux x64。
- Mobile 单独展示 iOS / TestFlight 与 Android / APK（或正式商店链接）。
- 每个入口必须使用统一状态：`可下载`、`构建中`、`计划中`、`暂不可用`。
- 没有真实产物时不生成下载链接；按钮可显示明确的“发布阶段接入”状态并提供解释反馈。
- 已发布入口显示产品、平台、架构、版本、最低系统版本、发行格式和 SHA-256。
- 下载开始后提供安装说明、校验和、问题反馈和安全边界。
- 移动端下载区必须在首屏 CTA 可达的锚点内，不能只藏在 FAQ 或 Footer。

### 6.7 FAQ

第一版至少回答：

- Desktop、Mobile 和 Gateway 是什么关系？
- Gateway 会替代本机 Runtime 吗？
- 移动端能做什么，哪些能力不在首版？
- 当前支持哪些桌面平台和移动平台？
- 是否需要预装 Node、pnpm 或 Harness 源码？
- 插件是否会执行本机代码，Token 如何处理？
- 启动失败时如何查看日志和重试？

## 7. 视觉与内容原则

- 深色背景、浅色文字、绿色主强调色，蓝色代表 Mobile，橙色代表 Gateway 状态。
- 宽幅内容容器约 1120–1200px，移动端左右留白约 18–20px。
- 面板圆角控制在 9–18px；通过边框、实色和少量阴影表达层次。
- 产品界面优先使用真实截图；资产未准备好时允许使用可交互 CSS 界面作为原型替代。
- Hero 标题两行以内，正文短句化；不以大段工程术语替代产品解释。
- 所有状态、平台、下载和未发布能力都要有可理解的文字说明。
- 支持 `prefers-reduced-motion`，动画不承担信息传达的唯一责任。

## 8. SEO、分享和可访问性

- 每个页面有唯一 title、description、canonical URL 和 Open Graph 图。
- 首页只使用一个 H1，章节使用有层级的 H2/H3。
- Tab 使用 `role=tablist/tab/tabpanel`，FAQ 使用按钮和 `aria-expanded`。
- 菜单、外链、下载按钮和图标按钮具备语义化名称。
- 键盘可以访问所有链接、按钮、Tab 和 FAQ；ESC 关闭移动菜单后焦点回到触发按钮。
- 移动端最小触控区域不低于 44px，正文、平台卡片和按钮不横向溢出。
- 正式站点加入 `robots.txt`、sitemap、favicon、OG 图和 404 页面。

## 9. 验收标准

### P0 内容验收

- [ ] 首屏说明 harndock、Desktop / Mobile / Gateway 三端和主要行动入口。
- [ ] 首屏存在 `下载 Mobile`，并能到达 iOS / Android 状态按钮。
- [ ] Gateway 的职责被定义为认证、同步和管理，不被描述为 Runtime 执行源。
- [ ] 已完成、开发中、计划中和暂不可用能力有明确区分。
- [ ] GitHub、文档、下载、许可证和免责声明入口齐全。
- [ ] 没有伪造下载量、用户量、评价、性能或真实可用性数据。

### P0 交互验收

- [ ] Desktop / Mobile / Gateway 预览 Tab 可切换，并同步 `aria-selected` / `tabpanel`。
- [ ] 工作流 Tab、FAQ 和移动菜单可用，支持键盘与触摸。
- [ ] 移动端菜单支持 ESC 关闭，焦点回到菜单按钮。
- [ ] 未接入下载时不会发起错误请求，按钮提供明确状态反馈。
- [ ] 页面在 320px、390px、768px、1280px 宽度下不重叠、不横向溢出。

### P1 发布验收

- [ ] 真实 Desktop / Mobile / Gateway 截图、Logo 和社交分享图已替换原型资产。
- [ ] 四个桌面平台和 iOS / Android 的版本、下载包、校验和及安装说明分别接入。
- [ ] 下载页、Release 数据源、OG metadata、sitemap、robots 和 404 已接入。
- [ ] Lighthouse、键盘导航、移动端截图和主流浏览器检查通过。
- [ ] Tailcast MIT License 与第三方资产归属处理完毕。

## 10. 待决策事项

1. 产品名已确认：harndock；Logo 和品牌关系声明待确认。
2. 官网域名已确认：harndock.com；部署方式和 GitHub / 文档 / Release 的真实地址待确认。
3. Desktop 四个平台最低系统版本、发行格式与签名策略。
4. Mobile 的首发平台（TestFlight、Android APK、应用商店）与最低系统版本。
5. Gateway 管理页的公开入口文案和登录引导方式。
6. 双语首发的英文术语、审核人和法律表述；正式应用固定在同级 `harndock-website` 独立工程中实现。

## 11. 国际化需求

- 首期 locale 为 `zh-CN` 和 `en`；现有中文 URL 保持不变，英文页面使用 `/en/` 路径前缀。
- 根路径固定展示中文，不根据浏览器语言自动跳转；用户通过语言切换入口显式切换，并保持当前页面语义。
- 首页、Download、Releases、About、404、导航、FAQ、平台状态、Release 摘要和所有 SEO metadata 均必须双语覆盖。
- Desktop、Mobile、Gateway、Harness、Runtime、Session、pairing 等专有名词使用冻结术语表，英文内容须经过人工审核。
- 技术字段（版本、架构、下载 URL、SHA-256、状态）保持单一来源；仅展示文案、日期、状态标签和安装说明本地化。
- 每种语言生成独立 `lang`、canonical、Open Graph、JSON-LD、hreflang 和 sitemap URL；缺失翻译、路由或对应 anchor 时构建失败。

国际化专项任务、依赖和验收见 [i18n-plan.md](i18n-plan.md)。
