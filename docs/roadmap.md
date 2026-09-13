# harndock 实施路线

## 总体原则

每个阶段产生一个可独立验证的结果。先证明“可靠托管现有 Harness”，再增加桌面定制、Runtime 发布和插件管理。任何阶段都不以修改上游 Harness 源码作为完成条件。

## P0：工程基线

目标：建立可重复开发的独立 harndock 仓库。

状态：已完成（2026-08-17）。工程、依赖锁、Harness 版本锁和 CI 基线均已落盘，并通过本地 P0 检查。

交付物：

- 初始化 harndock Git 仓库；
- 把现有上游 checkout 迁移为 `vendor/deepseek-harness` submodule；
- 创建 pnpm workspace；
- 创建 Tauri 2 + React + Vite 最小应用；
- 固定 Node、pnpm、Rust 和 Tauri 版本；
- 加入 `runtime/harness.lock.json`；
- CI 执行 TypeScript、Rust 和文档基础检查。

验收标准：

- 新 checkout 按文档可以完成依赖安装；
- `pnpm dev` 能打开 Bootstrap UI；
- 上游 submodule 状态和 lock commit 不一致时检查失败；
- harndock 的提交不包含 Harness `node_modules`、构建输出或 `.codegraph` 数据库。

## P1：开发态 Runtime 托管

目标：Tauri 在开发环境中可靠启动现有 Harness Web GUI。

状态：实现完成（2026-08-17）。真实 Harness 已通过随机端口启动与 HTTP/plugin manifest 探测；连续十次启动关闭、宿主强制退出清理和 Runtime 崩溃回收均无残留进程或端口。桌面窗口的浏览器级对话与 WebSocket 自动化仍需在具备窗口控制能力的环境补跑。

交付物：

- Rust Runtime 状态机；
- 从 submodule 启动 Harness 的开发适配器；
- `--profile web --port 0` 启动；
- stdout/stderr 异步采集；
- 就绪 URL 识别与 WebView 导航；
- 正常退出、启动超时和崩溃恢复页。

验收标准：

- 应用启动后进入真实 Harness Web GUI；
- 对话、WebSocket 流和现有 Client plugin 正常工作；
- 连续启动和关闭十次不残留 Runtime 进程或监听端口；
- 启动命令不存在、profile 失败和端口启动失败都有不同诊断；
- Web 页面无法调用未授权的 Tauri command。

## P2：desktop profile 与外部插件

目标：桌面产品通过 Harness 扩展点进行定制。

状态：已完成（2026-08-17）。Runtime Manager 已切换到 `desktop` profile；外部 bundle 和 Client plugin 经 Harness CLI、profile 组合器与浏览器模块服务加载。真实 Runtime 集成测试覆盖配置 dump、boot manifest、Client bundle HTTP、禁用产品层、保留第三方 bundle 和卸载产品包后的基础 Web 回退。

交付物：

- `packages/desktop-bundle`；
- desktop profile 初始化；
- 可选 `packages/client-desktop` Client plugin；
- desktop bundle 的启动和卸载测试；
- profile 中安装第三方 bundle 的开发说明。

验收标准：

- Runtime Manager 启动 `desktop` profile；
- desktop bundle 不复制上游 base/web-app 配置；
- Client plugin 通过 Harness 插件图加载，不进入 Tauri Bootstrap bundle；
- 禁用 desktop plugin 后基础 Web GUI 仍可启动；
- 第三方插件失败时恢复页能定位到 Harness 日志。

## P3：生产 Runtime artifact

目标：桌面应用不依赖用户预装 Node、pnpm 或 Harness 源码。

状态：进行中。P3-1 Runtime 契约、P3-2 可复现 artifact 构建器、P3-3 独立目录/归档 verifier、Runtime bridge、Runtime Store、生产启动握手后端、artifact 安装器、Tauri resource 内置和首次启动自动发现已于 2026-08-18 完成第一轮。当前剩余签名、正式安装包和 packaged app 启动观察 smoke。

交付物：

- 平台 Runtime 构建脚本；
- 固定 Node runtime；
- artifact manifest 与 SHA-256 校验；
- 临时 `DSH_HOME` 启动探测；
- Tauri bundle 内置首个 Runtime；
- macOS arm64 签名和安装包。

验收标准：

- 干净机器可直接启动；
- 发布包不包含上游 `.git`、测试、源码缓存和开发依赖；
- Runtime artifact 可独立通过启动探测；
- 应用路径包含空格时仍能启动；
- 应用升级不覆盖用户 `DSH_HOME`。

执行轮次：

1. 已完成：Runtime manifest、archive、兼容性和控制协议契约。
2. 已完成：可复现 artifact 构建器与内容裁剪；相同输入连续构建得到相同 SHA-256。
3. 已完成：目录/归档独立 verifier、固定 Node/pnpm 和 Runtime bridge 测试。
4. 已完成第一轮：Runtime Store 版本目录、`current.json` 原子指针、manifest 启动配置、artifact 内置 Node/入口和 Unix socket ready 握手；开发态 stdout 就绪路径保持不变。
5. 已完成第一轮：Rust 安装器校验相邻 SHA-256，安全解析并解压 `tar.zst` 到 staging，执行内置 Node/pnpm/dsh 自检后原子安装；真实 artifact 和带空格路径 smoke 已通过。
6. 已完成第一轮：首个 Runtime archive、checksum、bundled descriptor 和 schema 映射到 Tauri `$RESOURCES/runtime/`；release 首次启动无 current pointer 时自动安装并保留用户数据目录。
7. 进行中：macOS arm64 签名、正式安装包和 packaged app 启动观察 smoke；debug `.app` resource bundle 已通过无签名验证。

## P4：独立 Runtime 更新

目标：Tauri 壳不发版也能安全升级 Harness Runtime。

交付物：

- stable、beta、nightly 更新通道；
- 签名清单下载与验证；
- staging 安装、原子激活和版本保留；
- 更新前数据备份；
- 自动回滚与恢复 UI；
- CI 上游跟踪和候选 Runtime 发布流程。

验收标准：

- 下载中断不影响当前 Runtime；
- 哈希或签名错误的 artifact 永不执行；
- 候选版本启动失败后恢复到上一个健康版本；
- 回滚不会修改或删除 profile；
- 未声明数据兼容性的更新不会静默安装到 stable 用户。

## P5：桌面产品能力

目标：在稳定 Runtime 基础上增加用户价值，而不是扩大宿主权限面。

候选范围：

- 托盘与后台运行；
- 系统通知；
- 单实例与深链接；
- Runtime 和插件诊断页；
- 经过签名与权限设计的插件安装 UI；
- 多平台构建与自动更新。

每个原生能力先判断能否由现有 Harness Host API 实现；只有不能实现时才增加窄 Tauri command。

## 测试结构

| 层级 | 重点 |
|---|---|
| Rust unit | Runtime 状态转换、manifest 校验、原子指针和错误分类 |
| TypeScript unit | Bootstrap UI 状态、恢复操作和版本展示 |
| Runtime integration | 启动真实 Harness、识别就绪、终止和日志 |
| Browser integration | 页面加载、RPC、WebSocket 和 Client plugin |
| Packaging smoke | 干净用户目录、带空格路径、无开发工具环境 |
| Update integration | 中断、坏签名、探测失败、切换和回滚 |

测试不得依赖固定端口或开发者真实 `DSH_HOME`。每个集成测试使用临时目录，并在失败路径上同样清理子进程。

## 首轮任务拆分

1. 整理父仓库和 submodule，不改上游内容。
2. 创建 Tauri Bootstrap UI 和最小 Rust command。
3. 定义 Runtime 状态枚举、事件和错误类型。
4. 实现开发态 Harness 命令解析与进程托管。
5. 实现 `--port 0` 就绪识别和窗口导航。
6. 增加退出、超时、崩溃和重复启动测试。
7. 在 P1 通过后设计 desktop bundle 的首个配置。

## 待决事项

以下事项不阻塞 P0 和 P1，但必须在对应阶段开始前决定：

| 事项 | 最晚决策阶段 | 当前建议 |
|---|---|---|
| 产品名、bundle id、更新域名 | P3 | 在签名和安装包前固定 |
| 首发平台范围 | P0 | macOS arm64 |
| Runtime artifact 格式 | P3 | 已定：单根目录 `tar.zst`，archive SHA-256；P4 外加签名清单 |
| 结构化就绪通道 | P3 | 已定：nonce 绑定的私有 Unix socket + NDJSON ready 帧 |
| 数据兼容声明格式 | P4 | 清单字段 + 升级前备份 |
| 插件信任和签名模型 | P5 | 默认只允许明确确认的来源 |
| Tauri 自动更新与 Runtime 更新的关系 | P4 | 壳和 Runtime 两条独立通道 |
