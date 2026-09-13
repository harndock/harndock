# harndock 官网国际化任务计划

版本：0.1  
状态：第二轮数据契约与 SEO 验证已完成，内容审核与浏览器回归待执行
适用工程：`<dsh-website-repo>`

## 1. 目标与范围

首期支持简体中文和英文，覆盖首页、Download、Releases、About、404、导航、Footer、FAQ、平台状态、Release 数据、metadata、sitemap 和分享信息。国际化只服务官网静态内容，不扩展到 Desktop、Mobile 或 Gateway Runtime 的运行时语言设置。

首期验收目标：

- 中文既有 URL 继续可访问，不因国际化破坏现有分享链接；
- 英文页面拥有完整、自然、经过产品术语审核的内容，不是逐字机器翻译；
- 语言切换保持当前页面和锚点语义，例如 `/download/` ↔ `/en/download/`；
- 每种语言均有独立 title、description、canonical、Open Graph、JSON-LD 和 hreflang；
- 两种语言的页面结构和关键行动入口一致，语言差异只体现在文案、日期格式和必要的本地化表达；
- 缺少翻译、路由、metadata 或链接时构建失败，不允许静默回退成另一种语言。

## 2. 首期决策

| 项目           | 首期决定                                               | 说明                                                                              |
| -------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Locale         | `zh-CN`、`en`                                          | `zh-CN` 为现有默认语言，`en` 为第二语言                                           |
| 中文 URL       | `/`、`/download/`、`/releases/`、`/about/`             | 保持现有 URL，不做一次性迁移                                                      |
| 英文 URL       | `/en/`、`/en/download/`、`/en/releases/`、`/en/about/` | 使用稳定的路径前缀，便于分享、缓存和搜索引擎识别                                  |
| 根路径行为     | 固定展示中文，不按浏览器语言自动跳转                   | 避免 SEO、缓存和无障碍焦点被隐式重定向影响                                        |
| 语言切换       | 页面内提供当前路由的另一语言链接                       | 切换时保留页面语义；有 hash 时映射到对应语言的同名 anchor                         |
| 默认日期与数字 | 中文使用 `zh-CN`，英文使用 `en-US`                     | 通过 `Intl.DateTimeFormat` / `Intl.NumberFormat` 等 API 格式化，不手写字符串拼接  |
| 翻译策略       | 产品术语表 + 人工审核                                  | Desktop、Mobile、Gateway、Harness、Runtime、Session、pairing 等专有名词先冻结译法 |
| 缺失策略       | 构建期报错                                             | 不在生产页面静默使用中文或英文兜底，避免混合语言                                  |

如果后续要增加日文等语言，沿用 locale 前缀和同一字典契约，不在首期引入自动检测、CMS 或运行时翻译服务。

## 3. 推荐实现架构

### 3.1 路由与页面

保留现有中文页面作为默认 locale，并为英文建立同构页面或统一的 locale page factory：

```text
src/pages/
├── index.astro                 # zh-CN /
├── download.astro              # zh-CN /download/
├── releases.astro              # zh-CN /releases/
├── about.astro                 # zh-CN /about/
└── en/
    ├── index.astro             # en /en/
    ├── download.astro          # en /en/download/
    ├── releases.astro          # en /en/releases/
    └── about.astro             # en /en/about/
```

实现时优先把页面内容抽成接收 `locale` 和已解析文案的共享组件，避免中英文模板分叉。404 也需要根据路径识别语言并输出对应内容。

### 3.2 文案与数据

建议新增 `src/i18n/`：

```text
src/i18n/
├── config.ts                   # Locale、默认语言、路由和语言标签
├── zh-CN.ts                    # UI、页面、metadata 文案
├── en.ts                       # 英文文案
├── glossary.ts                 # Desktop / Mobile / Gateway 等术语
├── routes.ts                   # locale <-> URL 映射
└── validate.ts                 # key、路由和必填字段校验
```

平台和 Release 数据不再只保存一份展示字符串：

```ts
type LocalizedText = { "zh-CN": string; en: string };

type LocalizedPlatform = Platform & {
  detail: LocalizedText;
  channel?: LocalizedText;
};
```

技术标识、版本号、架构、格式、SHA-256、下载 URL 和状态值保持语言无关；标题、说明、安装提示、Release 摘要和状态标签进入字典或本地化字段。`available` 平台的 URL 必须在两种语言页面复用同一个已验证地址。

### 3.3 SEO 与分享

- `<html lang>` 按当前 locale 输出：`zh-CN` 或 `en`；
- 每个 locale 生成自己的 canonical；
- 同一内容组互相输出 `hreflang="zh-CN"`、`hreflang="en"` 和 `hreflang="x-default"`；`x-default` 指向固定中文根路径对应的页面；
- `og:locale`、title、description、JSON-LD 的 `inLanguage` 与页面语言一致；
- `sitemap` 同时列出中文和英文 URL；
- `robots.txt` 仍只引用正式域名 sitemap，不按语言拆分；
- 不因浏览器 `Accept-Language` 自动重定向，不把 Preview 域名写入 canonical 或 hreflang。

## 4. 任务分解

### I18N-P0：语言与术语冻结

- [ ] 确认首期 locale 为 `zh-CN` + `en`，并确认英文默认使用美式日期和拼写。
- [ ] 冻结产品名、品牌名、Desktop / Mobile / Gateway / Harness / Runtime / Session / pairing 等术语表。
- [ ] 确认免责声明、开源许可、安全边界和 Gateway 公开入口的英文法律/产品表述。
- [ ] 指定中文内容维护人、英文审核人和发布前签核人。

交付物：locale 决策表、双语术语表、页面文案审核责任表。

### I18N-P1：类型与路由基础

- [x] 建立 `Locale`、locale 配置和路由映射 helper。
- [x] 接入 Navbar、Footer、Hero、FAQ、工作流、平台状态、下载目录和 404 的语言感知文案。
- [x] 英文页面复用共享组件，避免复制整套页面结构。
- [x] 构建期校验必需的中英文页面、anchor、链接和 `<html lang>`。
- [x] 设计中文旧 URL 与英文 `/en/` URL 的同构页面生成方式。

验收：单语言构建结果不变；locale 类型检查通过；中英文路由缺失能让构建失败。完整字典 key 校验仍待 I18N-P0 术语冻结后补齐。

### I18N-P2：英文内容与本地化数据

- [x] 翻译首页、Download、Releases、About、404、FAQ 和主要按钮/状态文案初稿。
- [x] 为平台 detail、channel 和状态标签建立本地化字段；minimum OS、安装说明待真实发布数据接入。
- [x] 为 Release summary 建立双语字段；变更摘要和版本 metadata 随真实 Release 数据接入。
- [x] 使用 `Intl.DateTimeFormat` 格式化发布时间；长英文布局仍需浏览器回归。
- [ ] 保持下载 URL、版本、架构、格式、SHA-256 和状态在两种语言之间一致。

验收：英文页面主要可见内容已本地化；专有名词最终译法和法律表述仍需 I18N-P0 审核；可下载平台双语入口共用同一真实产物的校验待真实 Release 接入后完成。

### I18N-P3：双语路由与 SEO

- [x] 实现 `/en/`、`/en/download/`、`/en/releases/`、`/en/about/` 和英文 404。
- [x] 增加页面内语言切换入口，切换后保持当前页面；anchor 映射和焦点回归待浏览器验收。
- [x] 扩展 Layout 输出 locale-specific `lang`、Open Graph locale 和双语路由 metadata 基础。
- [x] 输出双语 hreflang、x-default、sitemap，并扩展 `check-build` 验证路由、语言属性和必需产物。
- [x] 验证根路径固定中文，无隐式语言重定向和重复 canonical。

验收：每个页面已有双语对应 URL；内部链接、canonical、hreflang、sitemap 和配置 `SITE_URL` 的构建均已通过脚本验证。

### I18N-P4：质量与发布

- [x] 在 320、390、768、1280px 检查中文和英文的溢出、遮挡、按钮宽度和 Tab 布局；已完成四档视口无溢出回归，英文 390px、中文 1280px 已留存截图。
- [x] 检查语言切换、移动菜单、ESC、FAQ、Workflow Tab、跳过链接和 `lang` 属性；四档视口下导航标签、Tab/FAQ 数量和关键 ARIA 属性均通过检查。
- [x] 对两种语言运行 `npm run check` 和链接产物检查；Production `SITE_URL` 默认使用 https://harndock.com。
- [ ] 对中文和英文首页分别运行 Lighthouse Accessibility、Best Practices、SEO。
- [ ] 更新发布清单，要求双语 metadata、sitemap、截图和文案审核均通过。
- [ ] 在目标托管平台确认 `/en/*` 静态路径、404、缓存和回滚行为。

## 5. 依赖关系

```text
I18N-P0 语言/术语冻结
       │
       ▼
I18N-P1 类型、字典、路由基础 ────── P2 英文内容与本地化数据
       │                                  │
       └──────────────┬───────────────────┘
                      ▼
              I18N-P3 双语路由与 SEO
                      │
                      ▼
              I18N-P4 质量与发布
```

## 6. 风险与边界

| 风险                | 触发条件                                  | 应对                                     |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| 翻译语义漂移        | 英文文案自行改写产品边界                  | 术语表、双人审核、需求变更同步           |
| 英文文本变长        | CTA、Tab、FAQ 在窄屏换行或遮挡            | 固定最小尺寸；四档视口回归；允许自然换行 |
| 路由重复内容        | 中英文页面 canonical 或 hreflang 指向错误 | 构建期路由对称性和 metadata 检查         |
| 数据不一致          | 两种语言的版本、SHA-256 或下载 URL 不同   | 技术字段单一来源，只有展示字段本地化     |
| 自动跳转副作用      | 按浏览器语言改变根路径                    | 首期固定中文根路径，语言由用户显式切换   |
| 法律/安全表述不准确 | 免责声明或 Gateway 边界翻译失真           | 发布前由产品和安全责任人审核             |

## 7. 完成定义

只有同时满足以下条件，国际化阶段才可标记完成：

- 双语页面、路由、切换、metadata、hreflang、sitemap 和 404 全部存在；
- 构建期无缺失翻译 key、断链、重复 ID 或语言混用；
- 两种语言在四档视口、键盘和主要交互上均通过验收；
- 双语 Lighthouse 三类指标无新增失败；
- 发布清单、术语表和维护责任人已归档。
