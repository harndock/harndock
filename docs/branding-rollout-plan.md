# harndock 跨端品牌与主题改造计划

版本：0.1  
状态：代码改造完成（P0–P4 核心检查通过，透明 SVG 资源已补齐，真机视觉验收待执行）  
范围：harndock 官网、Gateway、Desktop、Mobile

## 目标

将已经确认的 harndock Logo 和 Indigo 色卡统一应用到官网、Gateway 管理端、Desktop 客户端和 Mobile 客户端，建立一致的品牌识别、主题切换和资源使用方式。

本计划只调整 harndock 自有界面和品牌插槽，不修改 `vendor/deepseek-harness` 上游源码，也不改变 Harness、Gateway 或同步协议的业务行为。

## 当前现状

| 端 | 工程位置 | 当前问题 |
| --- | --- | --- |
| 官网 | `../dsh-website` | `Theme.css` 和页面组件仍使用绿色主色、深绿色背景，favicon 和 `BrandMark` 仍是旧 H 图形 |
| Gateway | `../dsh-sync-server/apps/gateway-console` | `styles.css` 中大量硬编码绿色、青色和蓝色，没有统一主题变量 |
| Desktop | `apps/desktop`、`packages/client-desktop` | Bootstrap 页面使用旧的 CSS 绘制标记；Tauri 图标仍需替换；Harness 主 UI 由上游主题管理 |
| Mobile | `apps/mobile` | 已有集中式 `mobileTheme`，但只有浅色 token；Expo 已配置 `userInterfaceStyle: automatic`，还没有完整的动态主题实现 |

`docs/branding-assets` 中仍有历史 Logo 草稿和旧版本。执行品牌基础层时清理历史文件，只保留色卡、确认稿和生产资源。

## 品牌与主题原则

1. Logo 结构以已确认的参考图为准，保持图形比例、圆角、中央连接结构和右侧上升结构不变。
2. 现有两张 Logo PNG 是视觉确认稿。产品界面使用同一结构的 SVG 和透明底资源，避免把带背景的预览图直接放进导航栏。
3. Indigo 是 harndock 的主色。DeepSeek Harness、Codex Harness 等适配器只使用标签、图标或小面积识别色，不改变 harndock 的主视觉。
4. 状态色独立于品牌色：绿色表示在线或成功，黄色表示等待或警告，红色表示错误或危险。
5. 组件不直接散落使用十六进制颜色，所有颜色通过语义化 token 使用。
6. 浅色和深色主题保持同一 Logo 结构，只切换填充色、表面色、文字色和边框色。
7. 不使用高亮青色、荧光色、霓虹色或无必要的渐变。
8. 保持现有 Inter 与系统中文字体组合、8px 间距基线、清晰边框和适中的圆角；品牌改造不改变已冻结的业务信息架构。

## 主题 token 方向

最终数值以已确认色卡为唯一来源，下面是实现层级，不新增独立品牌色。

| Token 层级 | 浅色主题 | 深色主题 | 用途 |
| --- | --- | --- | --- |
| `brand.primary` | 深靛蓝 | 明靛蓝 | 主按钮、激活项、品牌强调 |
| `brand.connector` | 雾靛白 | 暖白靛色 | Logo 中央连接结构 |
| `surface.canvas` | 低饱和冷白 | 近黑深靛 | 页面背景 |
| `surface.panel` | 白色 | 深靛面板 | 卡片、侧栏、输入区域 |
| `text.primary` | 深蓝黑 | 近白 | 标题和主要内容 |
| `text.secondary` | 灰蓝 | 淡灰蓝 | 辅助说明 |
| `border.default` | 淡蓝灰 | 深靛灰 | 分隔线和边框 |
| `state.success` | 语义绿 | 语义绿 | 在线、成功 |
| `state.warning` | 语义黄 | 语义黄 | 等待、警告 |
| `state.danger` | 语义红 | 语义红 | 错误、危险 |

主题切换优先采用系统主题，允许用户手动覆盖并持久化选择。用户选择的主题不能影响 Logo 的图形结构。

## 分阶段计划

### P0：品牌资源与 Design Tokens

- 确认色卡、两张 Logo 确认稿和资源命名。
- 按确认参考图制作透明底 SVG 生产资源，几何结构不重新设计；网页、Desktop、Gateway 使用 SVG，Mobile 保留 PNG 以兼容 React Native。
- 输出网页 Logo、深色 Logo、浅色 Logo、App Icon、favicon 和启动图资源。
- 建立跨端可读取的 token 约定，记录颜色、字体、间距、圆角、边框和状态色。
- 清理 `docs/branding-assets` 中的历史 concept、旧颜色稿和重复预览文件。
- 保留两张确认 PNG，作为设计评审和视觉回归参考。

### P1：Desktop 与 Gateway 主题统一

#### Desktop

涉及：

- `apps/desktop/src/App.css`
- `apps/desktop/src/App.tsx`
- `packages/client-desktop/src/client.js`
- `apps/desktop/src-tauri/icons/*`

工作内容：

- Bootstrap 页面接入 harndock Indigo token。
- 替换当前 CSS 绘制的旧品牌标记。
- Client Plugin 的品牌插槽使用正式 Logo。
- 替换 Tauri 应用图标、启动资源和相关窗口品牌信息。
- 支持浅色、深色和跟随系统主题。
- Harness 主页面继续使用上游主题切换，不修改 `vendor/deepseek-harness`。

#### Gateway

涉及：

- `../dsh-sync-server/apps/gateway-console/src/styles.css`
- `../dsh-sync-server/apps/gateway-console/src/App.tsx`
- Gateway 静态品牌资源目录

工作内容：

- 将硬编码颜色收敛为 CSS variables。
- 登录页、侧边栏、顶部栏、卡片、表格、按钮和弹窗统一使用 Indigo 体系。
- 默认跟随系统主题，保留手动切换。
- 保持在线、警告、危险状态的语义色和可识别度。
- Gateway 维持管理工具的克制风格，避免大面积高饱和色。

### P2：Mobile Light/Dark 主题

涉及：

- `apps/mobile/src/theme/tokens.ts`
- `apps/mobile/src/theme/*`
- `apps/mobile/src/components/*`
- `apps/mobile/src/screens/*`
- `apps/mobile/app.json`
- Android 原生颜色、启动图和图标资源

工作内容：

- 将静态 `mobileTheme` 拆分为 Light / Dark 两套 token。
- 增加 `ThemeProvider` 或 `useTheme`，让主题切换能够即时更新。
- 将 AppHeader、按钮、消息卡片、Composer、审批面板和状态点接入动态 token。
- 避免 `StyleSheet.create` 在模块加载时固定颜色。
- 使用正式 Logo 资源更新 App Icon、启动图和原生主题颜色。
- 保持 Mobile 的 Viewer / Controller 信息架构，不复制 Desktop 三栏布局。

### P3：官网品牌替换与主题切换

涉及：

- `../dsh-website/src/styles/Theme.css`
- `../dsh-website/src/components/BrandMark.astro`
- `Navbar.astro`、`Footer.astro`
- `SurfaceShowcase.astro`、`ProductOverview.astro`、`PlatformStatus.astro`
- `../dsh-website/public/favicon.svg`

工作内容：

- 清除绿色主色和旧 H 图形。
- 将页面背景、文字、边框、按钮和强调色替换为 Indigo token。
- 支持浅色、深色和系统主题切换。
- Desktop、Mobile、Gateway 的展示使用同一套品牌语言。
- Harness 差异仅通过小型适配器标签表达。
- 更新 favicon、Open Graph 视觉资源和下载页 Logo。

### P4：四端视觉回归与发布检查

- 在浅色、深色和系统主题下检查所有主要页面。
- 检查 320、390、768、1280 宽度和 Desktop 窗口缩放。
- 检查导航栏、登录页、启动页、App Icon、空状态、错误状态和审批状态中的 Logo 识别度。
- 检查文字、按钮、边框和焦点状态的对比度。
- 确认旧绿色、青色主按钮和历史 H 图形不再出现在产品界面。
- 执行各仓库现有的构建、类型检查、单元测试和官网视觉截图回归。
- 确认所有端显示名称统一为小写 `harndock`。

## 执行顺序

```text
P0 品牌资源与 Design Tokens
        ↓
P1 Desktop + Gateway 主题统一
        ↓
P2 Mobile Light/Dark 主题
        ↓
P3 官网品牌替换与主题切换
        ↓
P4 四端视觉回归与旧资源清理
```

## 验收标准

- 四端使用同一套 harndock Logo 结构和 Indigo 品牌 token。
- 浅色、深色和跟随系统主题均有明确视觉表现。
- Logo 在浅色表面、深色表面、透明背景、导航栏、启动图和 App Icon 中都清晰可辨。
- 产品主色不再使用绿色或高亮青色；状态色仍能独立表达状态。
- Desktop 不修改上游 Harness 源码，Gateway 和 Mobile 不改变现有协议与业务行为。
- 官网、Gateway、Desktop、Mobile 的品牌名称和资源命名一致。
- 现有构建、类型检查、测试和发布检查通过。

## 相关资源

- [Indigo 色卡](branding-assets/harndock-color-card-indigo.png)
- [浅靛蓝 Logo 确认稿](harndock-logo-indigo-light.png)
- [深色高对比 Logo 确认稿](harndock-logo-dark-high-contrast.png)
- [浅靛蓝透明 SVG](branding-assets/harndock-logo-indigo-light.svg)
- [深色高对比透明 SVG](branding-assets/harndock-logo-dark-high-contrast.svg)
- [品牌与兼容性约定](branding.md)
- [官网设计包](website/README.md)
- [移动端同步与远程控制](mobile-sync/README.md)
