# harndock 官网部署与回滚手册

版本：0.1  
适用工程：`<dsh-website-repo>`  
产物类型：Astro 静态站点 `dist/`

## 1. 发布前决策门

以下输入未确认时，可以生成本地或 Preview 产物，但不得执行 Production 发布：

- 目标托管平台、生产项目和维护人；
- 正式 HTTPS 域名 https://harndock.com 已确认；DNS 管理人与解析配置待确认；
- GitHub、文档、Issue、Release 的公开地址；
- Desktop / Mobile 的真实版本、下载渠道、安装说明和校验信息；
- 正式产品名 harndock 已确认；Logo、品牌关系声明、真实产品截图和 OG 图待确认。

待确认字段保持空值或 `planned` / `building`，不得使用猜测 URL 通过检查。

## 2. 构建契约

- Node.js 版本：22.12.0 或更高版本。
- 包管理器：npm；CI 和发布必须使用 `npm ci`，不得忽略 `package-lock.json`。
- 生产环境变量：`SITE_URL`，值为完整 HTTP(S) 根地址，不带页面路径。
- 发布目录：仅部署 `dist/`；不上传源码、`.env`、`node_modules` 或本地日志。
- 官网为纯静态站点，不需要 Runtime、Gateway、Session 或账号服务参与构建和运行。

```bash
cd <dsh-website-repo>
npm ci
npm run check
SITE_URL=https://harndock.com npm run build
SITE_URL=https://harndock.com npm run check:dist
```

最后两条命令必须使用同一个 `SITE_URL`。构建成功后，`dist/` 应至少包含首页、404、About、Download、Releases、robots 和 sitemap 产物。

## 3. 环境与缓存

| 项目       | Preview                                  | Production                         |
| ---------- | ---------------------------------------- | ---------------------------------- |
| 来源       | Pull Request 或候选提交                  | 已评审的固定 commit                |
| `SITE_URL` | Preview 自身的公开 HTTPS 根地址          | `https://harndock.com`              |
| 下载数据   | 仅允许已验证的真实链接或不可点击状态     | 必须与发布清单一致                 |
| 搜索索引   | 默认不对外推广；由托管平台限制访问或索引 | robots 与 sitemap 必须指向正式域名 |

建议缓存策略：

- `/_astro/*`：文件名含内容指纹，可使用一年缓存和 `immutable`；
- HTML、`robots.txt`、sitemap：不缓存或短缓存，必须支持发布后及时刷新；
- 全站强制 HTTPS，不配置 SPA fallback；未知路径使用构建产物 `404.html`。

具体配置文件、Header 语法和 DNS 步骤必须在托管平台确定后补充，不能用某个平台的默认行为代替验收。

## 4. 发布步骤

1. 冻结候选 commit，确认工作区无未纳入发布的改动。
2. 按 `release-checklist.md` 核对平台产物、版本数据、内容、许可和安全边界。
3. 执行构建契约中的四条命令并保存 CI 结果。
4. 将同一 commit 部署到 Preview，完成四种宽度和关键交互 smoke。
5. 使用 Preview 的实际下载入口核对文件名、平台、架构、版本、SHA-256 和安装说明。
6. 将同一 commit 和锁文件部署到 Production，不在托管端手工修改产物。
7. 完成生产 smoke 后记录部署 ID、commit、发布时间、发布人和上一稳定部署 ID。

## 5. Production Smoke

至少检查：

- `/`、`/download/`、`/releases/`、`/about/` 返回 200，未知路径返回自定义 404；
- `/en/`、`/en/download/`、`/en/releases/`、`/en/about/` 返回 200，英文未知路径返回英文 404；
- `/robots.txt` 和 `/sitemap-index.xml` 返回 200，内容只引用正式域名；
- 中英文页面的 `lang`、canonical、hreflang、Open Graph URL 和 JSON-LD 不出现 Preview 或占位域名；
- 语言切换保持当前页面和对应 anchor，根路径不按浏览器语言自动重定向；
- Desktop / Mobile / Gateway Tab、Workflow Tab、FAQ、移动菜单和 ESC 可用；
- 320、390、768、1280px 无横向溢出或内容遮挡；
- `available` 下载入口实际可达，`planned` / `building` 不发起下载；
- 浏览器控制台无运行错误，HTTPS 与静态资源加载正常。

## 6. 回滚

触发条件包括核心路由不可访问、错误域名进入 metadata、下载链接错配、安全边界泄露或关键交互失效。

1. 暂停继续推广和后续发布，不直接编辑线上静态文件。
2. 在托管平台将流量切回记录中的上一稳定部署 ID；若平台不支持原子切换，则重新部署上一稳定 commit 的锁定产物。
3. 重跑 Production Smoke，尤其核对下载链接、robots、sitemap 和 canonical。
4. 记录故障版本、影响、回滚部署 ID 和修复任务；修复后重新走 Preview，不在已回滚部署上热修。

DNS 变更不作为常规回滚手段。若必须回滚 DNS，需要同时记录 TTL 和传播窗口。

## 7. 安全与审计

- `dist/` 不得包含 Gateway 私有地址、access token、Session 内容、用户数据或签名凭据。
- `SITE_URL` 不是密钥；托管平台凭据和签名密钥只能保存在受控的 CI Secret 中。
- Tailcast 的 MIT `license` 和 `UPSTREAM.md` 必须随源码保留。
- 每轮依赖升级运行 `npm audit`。当前 Astro 7.2.9 / Vite 8.2.2 锁文件审计为 0；未来主版本升级仍需独立评审，禁止用 `npm audit fix --force` 跳过兼容性验证。
