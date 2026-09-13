# Harndock 品牌与兼容性约定

2026-08-31 确认产品名称为 **Harndock**，官网为 **https://harndock.com**。产品显示名称统一使用 Harndock，不再使用 dsh-gui、DSH 或 DeepSeek Harness 作为本产品的显示名称。

## 命名

- 产品端：Harndock Desktop、Harndock Mobile、Harndock Gateway、Harndock 插件中心。
- 自有 npm 包统一使用 `@harndock/*`；桌面宿主环境变量使用 `HARNDOCK_*`。
- Desktop 应用标识为 `com.harndock.desktop`；iOS / Android 标识为 `com.harndock.mobile`，移动端 URL scheme 为 `harndock`。
- Runtime 归档使用 `harndock-runtime-<version>-<target>.tar.zst`；本次品牌切换使用独立版本 `2026.08.31.1`，旧归档不覆盖、不伪造校验和。
- 官网 canonical、hreflang、Open Graph、JSON-LD、sitemap 和 robots 默认使用 `https://harndock.com`。Gateway 可由用户自行部署，不将官网地址当作认证或同步 API，不推测未确认的子域名。

## 有意保留的旧标识

- `vendor/deepseek-harness`、`@deepseek-ai/*`、`dsh` CLI、`dsh.profile` / `dsh.client` / `dsh.bundle`、`DSH_HOME`、`DSH_CLIENT_TITLE` 等属于上游协议或构建接口，保留原名与许可署名。Harndock 通过产品层品牌插槽和构建参数设置名称，不修改 vendor。
- 已有浏览器 / Mobile 存储键、Gateway cookie、数据库名、认证锁、签名消息域 `dsh-sync-pc-register-v1` 和 Keychain service 保持不变，避免丢失凭据、会话或破坏跨版本协议。
- 已执行的 SQL 迁移文件名、历史测试证据和历史归档校验记录保持原样。
- 本机已有检出目录仍是 `dsh-gui`、`dsh-sync-server`、`dsh-website`、`dsh-center-plugin`，因此相对 file 依赖、Docker build context 与本地文档链接沿用实际路径；这些不是产品显示名称。不要只改路径字符串而不迁移检出目录。

## 升级与发布边界

新的原生应用标识会被操作系统视为独立应用，不会自动接管旧标识的应用沙盒。旧安装和数据不删除；需要旧数据时先备份、导出，再通过独立迁移流程导入。重新配对 Desktop / Mobile 后再验证同步。

本次修改只更新本地源码、构建配置与产物，不包含 DNS 修改、TLS 证书、托管发布、GitHub 仓库改名、npm scope 注册或商店上架。真实下载、源码与服务端公网地址仍需发布时确认。
