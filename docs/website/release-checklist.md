# harndock 官网发布清单

版本：0.1

## 发布信息

- [ ] 候选 commit、CI 地址、发布人和发布时间已记录。
- [ ] Production 域名、托管项目、部署 ID 和上一稳定部署 ID 已确认。
- [ ] Desktop / Mobile 的版本、平台、架构、格式和最低系统要求已核对。
- [ ] 每个 `available` 产物的下载 URL、文件名、大小和 SHA-256 已核对。
- [ ] 安装说明、Release notes、Harness commit 和 Runtime API 兼容范围已核对。

## 内容与资产

- [x] 产品名 harndock 与官网域名 harndock.com 已确认。
- [ ] Logo、Desktop / Mobile / Gateway 关系和非官方声明已确认。
- [ ] `zh-CN` 与 `en` 的术语表、英文法律/安全表述和审核责任人已确认。
- [ ] 中文既有 URL 与英文 `/en/*` 路由均已逐项验收，语言切换保持当前页面和 anchor。
- [ ] 首页及详情页使用真实截图；图片加载、alt 和失败状态已验证。
- [ ] OG 图文字、品牌、尺寸和分享预览已验证。
- [ ] GitHub、文档、Issue、Release 地址均为正式公开地址。
- [ ] `planned` / `building` 平台不生成下载请求或伪链接。

## 构建与质量

- [ ] Node.js 22.12.0+ 环境执行 `npm ci` 成功。
- [ ] `npm run check` 通过。
- [ ] 使用正式 `SITE_URL` 执行 `npm run build` 和 `npm run check:dist` 通过。
- [ ] 320、390、768、1280px 浏览器回归通过。
- [ ] Lighthouse Accessibility、Best Practices、SEO 无新增失败审计。
- [ ] 依赖审计残留已评估并记录，没有执行未经评审的主版本强制升级。

## 发布与回滚

- [ ] Preview 使用同一候选 commit 完成 smoke。
- [ ] Production HTTPS、404、缓存和静态资源策略已验证。
- [ ] robots、sitemap、canonical、Open Graph URL 和 JSON-LD 只引用正式域名。
- [ ] 中英文页面的 `lang`、title、description、canonical、hreflang、Open Graph、JSON-LD 和 sitemap 均已验证。
- [ ] `/en/`、`/en/download/`、`/en/releases/`、`/en/about/` 及英文 404 无中文残留或静默语言回退。
- [ ] Production 下载链接已逐项点击并与发布产物核对。
- [ ] Tailcast MIT `license`、`UPSTREAM.md` 和免责声明未丢失。
- [ ] 上一稳定部署可恢复，回滚责任人和操作入口明确。
- [ ] 发布记录已补充部署 ID、commit、检查结果和遗留问题。
