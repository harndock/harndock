# 插件中心产品设计

版本：0.2
状态：V1 GitHub 分发方案已确认，V2 商业化预研
更新时间：2026-09-02

## 1. 产品目标

插件中心为 DeepSeek Harness 提供一条可审核、可发现、可安装的插件发布链路：内容管理员在独立的 `dsh-center-plugin` 中维护插件目录和 GitHub Release 元数据，公共 Marketplace 展示已发布插件，Harness Desktop 从 Center API 获取可信安装声明后，直接从 GitHub Releases 下载并在本地完成校验与安装。

V1 的核心决策是：GitHub Releases 承载插件安装包，插件中心不建设对象存储、不代理安装包下载、不接入账号和交易系统。Center 是目录与发布状态的可信来源，Desktop Local Installer 是安装与安全校验的可信执行面。

## 2. 工程与产品边界

```text
内容管理端 ──维护目录、GitHub Release、审核、发布、下架──> dsh-center-plugin
                                                               │
                         公共目录与安装声明 <──────────────────┘
                                                               │
Marketplace Web ──浏览公开内容                         dsh-gui Desktop
                                                        └─直连 GitHub 下载
                                                        └─本地验签/验哈希/安装
```

| 范围 | V1 结论 |
|---|---|
| 插件目录 | Center 维护名称、分类、介绍、图标、版本和兼容性 |
| 插件工件 | 由公开 GitHub Releases Asset 承载，Center 不保存工件 |
| 公共前端 | 浏览已发布插件、详情、版本、权限和安装说明 |
| Desktop | 从 Center 拉取目录，从 GitHub 下载，完成本地安装 |
| 管理端 | 创建插件、绑定 GitHub Release、校验 Manifest、提交审核、发布、下架 |
| 登录授权 | V1 不需要 Marketplace 账号；管理端使用独立开发密钥，生产替换为管理员会话 |
| 商业化 | V2 再做账号、购买、订单、订阅、许可证和组织席位 |
| Gateway/Mobile | V1 不接入；Gateway 不承担插件中心入口或远程安装任务 |

工程目录固定为 `<dsh-center-plugin-repo>`，沿用 `dsh-sync-server` 的 pnpm workspace、Fastify、React/Vite、PostgreSQL/Redis、迁移和 Compose 组织方式，但不共用数据库、账号、Session 或密钥。

## 3. V1 用户与角色

| 角色 | 主要能力 | V1 限制 |
|---|---|---|
| 访客 | 浏览 Marketplace 公开目录和详情 | 不进入订单、许可证或组织页面 |
| Desktop 用户 | 查看兼容性、权限，确认并安装插件 | 只有本机用户可以批准本地安装 |
| 内容管理员 | 维护插件条目、登记 GitHub Release、审核、发布、下架 | 不能直接绕过状态机发布未经校验的版本 |
| 平台审核员 | 审查来源、Manifest、权限和版本内容 | 不读取用户本地项目和运行数据 |

开发者在 V1 可以通过管理员流程提交 GitHub Release；开发者账号、自动上传、定价和结算留到 V2。

## 4. 信息架构

### 4.1 Desktop 插件中心

Desktop 继续使用当前 Harness 浅色窗口和 Workspace/Session 侧栏，在左侧全局区域增加“插件中心”一级入口。

```text
插件中心
├── 发现
│   ├── 精选插件
│   ├── 分类与搜索
│   └── 插件详情
├── 已安装
│   ├── 已启用
│   ├── 已禁用
│   └── 可更新
└── 设置
    ├── 插件来源（V1 显示 GitHub 公共来源）
    ├── 更新策略
    └── 安装日志
```

详情页必须展示：插件类型（Host/Client）、版本、GitHub 来源、支持平台、最低 Harness 版本、Runtime API、权限、变更说明、工件哈希和签名状态。

### 4.2 Marketplace 公共前端

公共前端只展示 Center 中 `published` 的内容：

- 首页：精选、新增、分类和搜索。
- 详情：介绍、截图、版本、权限、兼容性、GitHub 来源。
- 安装入口：提示“在 Harness Desktop 中安装”，不在浏览器执行本地命令。
- 错误页：插件已下架、GitHub Release 不可用、客户端版本不兼容。

公共前端不展示价格、购买、许可证、组织席位和远程安装任务。

### 4.3 Center Admin

管理端以内容运营为中心：

1. 创建插件条目。
2. 绑定 GitHub 仓库和 Release Tag。
3. 选择平台 Asset，读取或粘贴 `plugin-manifest.json`。
4. 校验仓库、Tag、Asset、版本、平台、SHA-256 和签名信息。
5. 保存草稿，提交审核。
6. 发布或下架版本。
7. 查看变更审计和 GitHub 来源状态。

管理端不上传文件到 Center；插件包应先由发布者上传到 GitHub Release。

## 5. V1 核心流程

### 5.1 GitHub Release 发布

1. 发布者在允许的公开 GitHub 仓库创建 Release。
2. Release 使用不可变版本 Tag，例如 `v1.2.0`。
3. 上传各平台插件包、`plugin-manifest.json` 和 `SHA256SUMS`。
4. 内容管理员在 Center Admin 登记仓库、Tag 和 Asset。
5. Center 读取 GitHub Release 元数据，验证 Manifest 和版本一致性。
6. 管理员提交审核，审核通过后发布。
7. 公共 API 只返回已发布版本。

### 5.2 Desktop 安装

1. Desktop 从 Center API 获取插件目录。
2. 用户打开详情，确认来源、权限和兼容性。
3. Desktop 请求指定版本的安装声明。
4. 根据当前平台选择 GitHub Release Asset。
5. 下载到本地 staging 目录。
6. 校验 Asset SHA-256、Manifest、签名、平台和版本。
7. 展示最终权限确认。
8. Plugin Manager 原子写入版本目录并启用插件。
9. 失败时删除 staging，保留原有 active 版本。

### 5.3 下架

管理员下架版本后：

- Center 公共目录和版本接口不再返回该版本。
- Desktop 不再把该版本作为新安装或更新候选。
- 已安装插件不被远程删除或静默禁用。
- 本地用户可以继续查看安装记录，并根据安全策略手动卸载。

## 6. GitHub Release 约定

V1 只支持公开 GitHub Repository 和 GitHub Releases Asset，不支持任意下载 URL、私有仓库和直接读取 `main` 分支。

建议 Asset 结构：

```text
com.example.docs-1.2.0-darwin-aarch64.tar.zst
com.example.docs-1.2.0-darwin-x64.tar.zst
plugin-manifest.json
SHA256SUMS
```

Center 至少保存：

- `owner/repository`
- Release Tag
- Release ID（可选）
- Release commit SHA
- Asset Name
- Manifest Asset Name
- SHA-256 和文件大小
- 签名 Key ID 和签名值

GitHub URL 只作为可解析来源，不作为唯一信任依据。客户端必须重新计算下载文件哈希。

## 7. V2 预研，不进入 V1

以下内容保留在原型和后续设计中，但不阻塞 V1：

- DeepSeek Account、OAuth、设备绑定。
- 免费授权、买断、订阅、许可证和离线宽限期。
- 订单、支付、退款、发票和开发者结算。
- Gateway 组织策略、成员席位和远程安装任务。
- Mobile 设备、许可证查看和任务审批。
- 私有 GitHub 仓库、企业插件源、对象存储和 CDN 镜像。

V2 仍应复用 V1 的 `ArtifactProvider` 抽象，不改变 Desktop 的本地验签和用户确认边界。

## 8. 产品决策记录

| 决策 | 结论 | 原因 |
|---|---|---|
| V1 工件位置 | GitHub Releases Asset | 降低服务端建设成本，适合内容平台首版 |
| Center 是否代理下载 | 否 | 不承受工件流量，不成为安装链路的带宽瓶颈 |
| Desktop 下载来源 | Center 提供声明，GitHub 提供文件 | Center 负责审核状态，客户端负责最终校验 |
| V1 是否支持任意 URL | 否 | 避免 SSRF、来源漂移和供应链不可控 |
| V1 是否支持私有仓库 | 否 | 避免提前引入 GitHub OAuth、Token 和商业授权 |
| 是否嵌入 Gateway | 否 | V1 是公共内容平台，Gateway 的组织治理属于 V2 |
| 是否建设对象存储 | 否 | 通过 Provider 抽象为未来 CDN/对象存储留扩展点 |
