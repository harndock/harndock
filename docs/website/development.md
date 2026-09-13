# harndock 官网功能开发文档

工程名称为 `harndock-website`，本机检出目录仍为 `../dsh-website`；实际路径与 file 依赖不随品牌名自动迁移。

版本：0.6
状态：Tailcast 正式工程已迁移至 Astro 7，三端页面、静态质量门禁和迁移后浏览器回归已完成；国际化路由、共享组件、双语数据契约和 SEO 构建校验已接入，内容审核与浏览器回归待完成

## 1. 技术目标

正式官网使用 [Tailcast](https://github.com/matt765/Tailcast) 作为基础工程，并已从上游 Astro 6 基线迁移至 Astro 7.2.9、Vite 8 和 Tailwind CSS 4。工程继续使用 TypeScript、ESLint、Prettier、SEO、View Transitions、响应式布局和 CI；官网在同级目录 `harndock-website` 独立开发和发布，不加入 `harndock` 的 pnpm workspace。官网与现有 Tauri Desktop、React Native Mobile、Gateway 服务端保持构建和权限隔离；官网只展示产品信息和发布数据，不直接连接 Runtime 或 Gateway API。

当前 `docs/website/prototype.html` 是无依赖的交互原型，可直接打开评审。正式实现从 Tailcast 模板初始化，保留其许可、构建、SEO 和无障碍基础；将原型中的三端叙事、交互语义和状态边界迁移为 Astro 组件和数据文件。`harndock-website` 使用 Tailcast 自己的 npm / package-lock 流程，不修改 `dsh-gui/pnpm-workspace.yaml`。

工程边界：

```text
<workspace-root>/
├── harndock/                    # Desktop、Mobile、Gateway 需求与实现
│   └── docs/website/            # 官网需求、开发说明、原型和任务计划
└── harndock-website/                # 独立 Tailcast/Astro 官网工程
    ├── src/pages/
    ├── src/components/
    ├── src/data/
    ├── src/assets/
    ├── public/
    ├── astro.config.mjs
    ├── package.json
    └── package-lock.json
```

首版网站采用静态输出。下载、版本和平台状态在构建时由本地数据文件或发布流程生成；不在浏览器运行时请求私有 Gateway、账号、设备或 Session 数据。

## 2. 页面与组件映射

### 2.1 页面

- `src/pages/index.astro`：首页，按 Hero、三端、连接方式、工作流、发布状态、FAQ、CTA 顺序组合。
- `src/pages/download.astro`：Desktop 四平台和 Mobile iOS / Android 下载详情。
- `src/pages/releases.astro`：版本记录与变更摘要，后续接入 GitHub Release 或构建产物清单。
- `src/pages/about.astro`：项目关系、开源协议、插件信任和数据边界。
- `src/pages/404.astro`：产品风格错误页。
- `src/pages/robots.txt.ts`：根据 `SITE_URL` 条件输出 sitemap 地址。

### 2.2 组件

```text
src/components/
├── Navbar.astro
├── Hero.astro
├── SurfaceShowcase.astro       # Desktop / Mobile / Gateway Tab
├── ProductOverview.astro       # Surface cards + connection flow
├── WorkflowTabs.astro          # ready / recovery / control
├── PlatformStatus.astro        # Desktop + Mobile 状态
├── DownloadCatalog.astro
├── ProductFAQ.astro
└── Footer.astro
```

Tailcast 原有的 Navbar、Layout、SEO、View Transition、主题样式和通用页面组件优先复用；虚构产品的 Services、Careers、Contact、Blog 等页面和文案删除或改造成 harndock 需要的路由。组件只接收数据和状态，不在模板中硬编码真实下载 URL。原型中的 CSS 产品界面可以先作为 `SurfaceShowcase` 的 fallback，真实截图准备好后替换为固定宽高比的图片或视频首帧。

## 3. 内容与数据模型

产品文案、平台和版本数据分别集中在 `src/data/product.ts`、`src/data/platforms.ts` 和
`src/data/releases.ts`：

```ts
type ReleaseState = "available" | "building" | "planned" | "unavailable";

type Platform = {
  id: string;
  family: "desktop" | "mobile";
  name: string;
  architecture?: string;
  format?: string;
  minimumOs?: string;
  version?: string;
  state: ReleaseState;
  downloadUrl?: string;
  sha256?: string;
  installNotesUrl?: string;
};

export const product = {
  name: "harndock",
  tagline: "一个入口，连接你的工作流。",
  githubUrl: "",
  docsUrl: "",
  platforms: [
    {
      id: "macos-arm64",
      family: "desktop",
      name: "macOS",
      architecture: "arm64",
      state: "planned",
    },
    {
      id: "macos-x64",
      family: "desktop",
      name: "macOS",
      architecture: "x64",
      state: "planned",
    },
    {
      id: "windows-x64",
      family: "desktop",
      name: "Windows",
      architecture: "x64",
      state: "planned",
    },
    {
      id: "linux-x64",
      family: "desktop",
      name: "Linux",
      architecture: "x64",
      state: "planned",
    },
    {
      id: "ios",
      family: "mobile",
      name: "iOS",
      format: "TestFlight",
      state: "planned",
    },
    {
      id: "android",
      family: "mobile",
      name: "Android",
      format: "APK",
      state: "planned",
    },
  ] satisfies Platform[],
};
```

约束：

- `downloadUrl` 为空时只能渲染状态按钮或 disabled link，不生成失效请求。
- `state=available` 必须同时有版本、下载 URL、安装说明和 SHA-256（Mobile 商店链接可免 SHA-256，但需保留发布渠道）。
- `family=mobile` 单独分组显示，不与 Desktop 四平台混成一个无差别列表。
- 官网使用 https://harndock.com；真实 GitHub、文档、Release 地址接入前继续使用空值或明确的占位状态。

## 4. 交互规格

### 导航

- 滚动超过 24–48px 增加背景、模糊和边框。
- 移动菜单由按钮控制 `aria-expanded`，点击锚点后关闭。
- ESC 关闭菜单并将焦点返回菜单按钮。
- 菜单、外链和下载按钮均有可见文字或语义化 aria-label。

### SurfaceShowcase

- `Desktop`、`Mobile`、`Gateway` 为互斥 Tab，默认激活 Desktop。
- 使用 `role=tablist`、`role=tab`、`role=tabpanel` 和 `aria-controls` / `aria-selected`。
- 点击、Enter、Space 均可切换；不自动轮播，避免产品信息跳动。
- 每个面板使用稳定的最小高度和固定比例，切换时不造成页面布局位移。

### WorkflowTabs

- 三个状态：`feature-ready`、`feature-recover`、`feature-control`。
- 切换时同时更新激活样式、`aria-selected` 和右侧状态面板内容。
- 面板中的 Open / Retry / Review 按钮在原型阶段用 toast 说明“正式应用将在此接入”，正式站点不调用真实 Runtime。

### FAQ

- 每一项使用 button 和 `aria-expanded`，默认展开第一项。
- 允许多个答案同时展开；答案文本不通过 hover 才可见。

### 下载

- Desktop 下载展示 macOS arm64、macOS x64、Windows x64、Linux x64。
- Mobile 下载展示 iOS / TestFlight 和 Android / APK，并在首页 Hero 通过 `下载 Mobile` 锚点可达。
- available 状态为真实链接；building / planned / unavailable 状态为不可下载按钮或解释性反馈。
- 版本、架构、最低系统、发行格式、安装说明和 SHA-256 由统一数据组件渲染。

## 5. 视觉实现

```css
:root {
  --bg: #0a0d0c;
  --panel: #101513;
  --text: #eef4ed;
  --muted: #9aa79c;
  --accent-green: #a5f26d;
  --accent-blue: #8fc8ff; /* Mobile */
  --accent-orange: #ffb774; /* Gateway / release state */
  --border-subtle: rgba(230, 245, 229, 0.12);
}
```

- 中文优先使用系统字体，英文使用 Inter 或系统无衬线字体。
- 宽幅容器 1120–1200px，移动端左右留白 18–20px。
- 面板圆角控制在 9–18px；避免卡片嵌套卡片。
- Desktop 使用绿色强调，Mobile 使用蓝色标签，Gateway 和发布状态使用橙色辅助识别。
- 使用边框、实色、阴影和网格纹理表达层次，避免大面积紫色或渐变背景。
- 产品截图设置 `aspect-ratio`、`object-fit` 和加载占位，避免 CLS。
- 所有按钮触控区域不低于 44px；文本在 320px 窄屏不溢出。

## 6. Tailcast 迁移与许可

- 初始化前记录 Tailcast commit、版本、许可证和原始目录结构；正式工程保留 MIT License 和必要署名。
- 只复用 Tailcast 的通用结构、样式和工程配置，不复制其虚构产品名、品牌资产、图片、评价、职位和营销数据。
- 首轮迁移顺序：Layout / Theme → Navbar → Home sections → 404 → SEO / sitemap → 下载、Release、About 页面。
- Tailcast 示例页面每删一个，都要检查导航、import、静态资源和构建路由，避免遗留虚构链接。

## 7. SEO、分享和发布

- Layout 提供唯一 title、description、canonical、Open Graph / X metadata。
- 首页 H1 固定为一个；下载、FAQ 和产品章节使用 H2/H3 层级。
- `SITE_URL` 默认使用 `https://harndock.com`，生成 canonical、JSON-LD、sitemap 和带 sitemap 地址的 robots.txt；独立 Preview 可显式覆盖。
- 国际化按 [i18n-plan.md](i18n-plan.md) 实施：首期 `zh-CN` 保留现有根路径，英文使用 `/en/` 前缀；每种语言独立生成 `lang`、metadata、canonical、hreflang 和 sitemap。
- 若品牌或首屏内容发生正式变更，生成一张包含 harndock 标题和三端产品关系的 `public/og.png`；未确认品牌前不生成虚构宣传图。
- 发布构建不包含 Desktop Runtime、Mobile 凭据、Gateway access token、Session 内容或私有服务端地址。
- Release 数据应从版本清单或 CI 产物生成，避免官网手工版本落后。

## 8. 测试与验证

### 静态检查

- `cd <dsh-website-repo> && npm run check`
- `npm run check` 串行执行 format、lint、Astro 类型检查、build 和 `scripts/check-build.mjs`。
- 构建检查使用 HTML parser 验证必需路由、重复 ID、内部链接、锚点、robots 和 sitemap 产物。
- Lighthouse SEO / Accessibility / Best Practices

### 浏览器检查

- 1280px、768px、390px、320px 四种宽度。
- Desktop / Mobile / Gateway Tab 切换和 `aria-selected` 状态。
- Hero 的 `下载 Mobile` 是否到达 iOS / Android 状态按钮。
- 移动菜单点击、ESC、焦点回收；FAQ 多项展开；Workflow Tab 键盘操作。
- `prefers-reduced-motion`、长中文文案、下载未接入和图片失败状态。
- 中文和英文均需检查长文本、日期格式、语言切换、双语路由对称性和缺失翻译 key。

### 内容检查

- Desktop / Mobile / Gateway 的职责与 [requirements.md](requirements.md)、[docs/mobile-sync/README.md](../mobile-sync/README.md)、[docs/architecture.md](../architecture.md) 一致。
- Gateway 不被描述为模型或工具执行源。
- 未发布平台无真实下载请求，无虚构数字、评价或官方关系。
- Mobile 下载入口明确区分 iOS 与 Android，不隐藏在 Footer。

## 9. 实施顺序

详见 [task-plan.md](task-plan.md) 和 [i18n-plan.md](i18n-plan.md)。实现原则是先冻结内容和数据契约，再从 Tailcast 初始化 `harndock-website`、完成首页第一屏、接入下载状态，随后按国际化专项拆分双语内容、路由、SEO 和回归验证。

发布前按 [release-checklist.md](release-checklist.md) 逐项签核；构建、Preview、Production smoke 和回滚步骤见 [release-runbook.md](release-runbook.md)。托管平台未确定前只维护平台无关的 `dist/` 构建契约，不提交未经验证的 provider 配置。

## 10. 风险与边界

- 产品名 harndock 和域名 harndock.com 已确认并用于 SEO metadata；未确认的下载与源码链接继续保持空值。
- Host plugin 是本机可执行代码，官网提到插件时必须保留来源和信任边界说明。
- Mobile 的发布渠道取决于 React Native 构建和签名结果，官网不得先于产物承诺商店可用。
- Gateway 是当前账号的管理入口，不扩展为跨账号运维后台。
- 官网构建和部署不应依赖运行中的 Desktop、Mobile 或 Gateway 服务。
- Astro 已迁移到 7.2.9、Vite 8.2.2，锁文件可复现安装且 `npm audit` 为 0；迁移后静态构建、生产域名产物、浏览器回归和 Lighthouse 三项 100 均已通过。
