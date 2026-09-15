# 移动端多端同步与远程控制

版本：0.5（Mobile 产品 UI 重排）
状态：Gateway Web 与 Desktop 已完成；Mobile 原型评审通过，执行主线切换到 React Native 产品化
更新时间：2026-08-24

## 文档索引

- [功能需求文档](requirements.md)：用户、角色、页面、功能范围、状态、权限、非功能指标和验收标准。
- [功能开发详细文档](development.md)：架构、协议、数据模型、状态机、API、客户端投影、测试和运维边界。
- [实施计划](implementation-plan.md)：当前实现状态、前端/服务端任务、依赖关系、里程碑和完成定义。
- [任务计划](task-plan.md)：逐任务执行顺序、依赖、产物、验证命令和端到端测试批次。
- [执行记录](execution-log.md)：各轮任务环境、结果、阻塞项和下一步结论。
- [测试记录模板](test-record-template.md)：端到端测试的环境、步骤、证据和清理模板。
- [Web/Desktop 综合 HTML 原型](prototype.html)：Gateway 管理、Desktop 连接与同步工作台的历史综合交互资料。
- [Mobile HTML 原型](mobile-prototype.html)：React Native Viewer/Controller 的 MP-01–MP-05 产品基线，覆盖登录、Session 首页、Conversation、审批接管、设置和 online/offline/approval 状态。
- [Mobile 交互体验升级计划](interaction-upgrade-plan.md)：按钮、消息复制、Composer、审批反馈、离线恢复和无障碍交互的原型评审与实施任务。
- [Mobile 交互验收矩阵](mobile-qa-matrix.md)：UXI-10/UXI-11 的无障碍焦点、多尺寸、键盘、安全区和网络切换验收项。

## 本次重规划结论

两份原型现在按载体分开管理：`prototype.html` 保留 Gateway Web/Desktop 综合流程，`mobile-prototype.html` 才是 React Native 产品 UI 的评审依据。两者都不是代码完成或真实 API 验收证据。Gateway 管理页面向当前登录账号，只管理该账号的设备、Runtime、Token、pairing、连接诊断和隐私设置；RN 只承载移动端 Viewer/Controller 的认证、Session 查看与控制。

Mobile 本轮固定为以下页面集合：

1. MP-01 登录与连接：Gateway origin、管理员登录、AuthGate 和安全会话；不提供注册，生产构建不显示手工 token。
2. MP-02 Session 首页：需要处理、最近 Session、PC 紧凑状态、加载/空/离线；完整设备库存不占据主流程。
3. MP-03 Conversation：Harness 同源消息/工具时间线、历史补发、固定 Composer、prompt/cancel 和命令状态。
4. MP-04 审批接管：等待审批时替换 Composer，提供允许一次/拒绝、提交锁和 first-wins 反馈。
5. MP-05 设置与诊断：当前账号/Device、Gateway、PC Runtime、stream/游标摘要和退出；完整设备/Token/pairing 管理继续由 Gateway Web 承担。

页面载体固定为：独立 Web Gateway 管理页承载 P-01、P-04、P-05、P-06；React Native 承载 MP-01–MP-05/P-01–P-03；Desktop 保留本机 Remote Sync 设置。Mobile 延续 Harness 的 Session、Conversation、Composer、工具和审批心智，但不复制桌面三栏、不使用 WebView 包装桌面 UI，也不建设跨账号运维后台。

## 当前 Mobile 优先主线

原型评审门 `T4D-05` 已于 2026-08-24 通过。后续按以下单向顺序执行：

1. `T4-00`：拆分 RN UI 架构、主题和基础组件。
2. `T4-03` → `T4-04` → `T4-01` → `T4-02`：Gateway origin、安全会话、AuthGate 和 MP-01。
3. `T4-05`：MP-02 Session 首页。
4. `T4-06`：MP-03 Conversation。
5. `T4-07` → `T4-08`：固定 Composer、命令状态和 MP-04 审批。
6. `T4-09` → `T4-10`：MP-05、响应式、键盘/安全区和可访问性。
7. `T5/T7`：同步/控制验证和 BlueStacks 最新代码 E2E。

Mobile P0 关闭前，Gateway Web、Desktop、发布和新功能不得插队；仅允许处理直接阻断 Mobile 的既定契约缺陷、安全/越权、凭据泄漏或数据损坏问题。

## 连接与凭据共识

- Desktop 和 Mobile 使用同一个 Gateway origin，但 Desktop 使用 Ed25519 设备签名，Mobile 使用短期 access token。
- Desktop 客户端配置页负责本机 Runtime 自动连接、设备身份、Keychain 和配对；Gateway origin 配置页只负责连接入口。
- Gateway 不开放注册，只维护由部署环境首次初始化的唯一管理员账号；登录、refresh 和 logout 由私有部署内的 harndock Auth 负责。原生客户端直连 Gateway，Web 通过 Admin 同源代理访问；凭据修改使用受保护的管理接口并撤销旧会话。
- Gateway URL 只填写 origin，例如 `https://sync.example.test` 或本地开发的 `http://127.0.0.1:7019`；客户端自行派生 `/v1/ws`、`/v1/stream` 和 REST 路径。Gateway Admin 本地入口固定为 `http://127.0.0.1:7018`。
- 生产只允许 HTTPS；HTTP 仅用于显式开启的 loopback 开发环境，不得用于公网或共享网络。
- 原始 access token 只在签发成功时展示一次；服务端只保存摘要和元数据，设备撤销会级联失效该设备 token。
- Pairing code 只用于创建 PC Device，不是 access token，也不是 Desktop 长期凭据。

## 当前决策

1. 移动端支持同一账号多设备同时登录。
2. V1 只支持一个账号绑定一个活动 PC Runtime；多 PC、迁移和冲突合并后置。
3. 多个设备可以同时查看同一 Session；同一 Session 的普通控制命令由服务端串行排队。
4. PC Harness Runtime 是模型、工具、文件和 Session 的唯一执行源；云端只负责认证适配、转发、存储和协调。
5. PC 生产环境通过出站 TLS WebSocket 连接云端，不要求用户开放家庭网络端口；本地开发允许显式配置的 loopback HTTP。
6. 云端服务端使用 Node.js + TypeScript，保持在私有仓库；客户端、Connector 和同步协议可以开源。
7. 同步协议独立版本化，客户端不依赖私有服务端实现细节。
8. 首版包含实时查看、历史补发、发送消息、停止任务和一次性工具审批；复杂编辑、跨 PC 迁移、附件和端到端加密后置。
9. 云端服务端必须使用 Docker 镜像部署，生产环境不依赖宿主机 Node.js 或源码目录。
10. 当前不规划套餐、订阅、计费、订单、付费配额等商业化能力。
11. 移动端 Viewer/Controller 使用 React Native；账号、设备、Runtime、Token、诊断和隐私管理使用独立 Web Gateway 管理页，不放入 React Native；V1 不建设运维管理员后台。
12. V1 不启用“控制权租约”。客户端展示命令排队和串行状态；租约交互保留为 V1.1 设计，不应出现在 V1 的主操作路径中。

## 现有代码边界

- Tauri Bootstrap 只管理桌面 Runtime 生命周期，不承载 Session 业务。
- Harness 通过 `session/event` 发布有序事件，每个事件有 Session 内递增 `seq`。
- Session persistence 提供按游标读取的 `readFrom()` 和轻量 `listSnapshots()`，用于历史同步和断线补偿。
- 新能力通过外部 Host plugin 接入，不修改 `vendor/deepseek-harness` 上游源码。
- `harndock-sync-server` 当前已提供 Docker Compose、PostgreSQL/Redis、harndock Auth、Gateway、Worker、账号初始化、配对兑换、设备/Runtime/token 管理、Session 读取、Viewer stream、命令队列和健康检查。

## 阅读和验收顺序

先读需求文档确认页面和行为，再读开发文档确认协议与边界，最后打开原型逐条走页面流程。实施计划中的任务必须能回指需求编号或原型页面编号；如果实现与原型冲突，以已批准的需求和协议为准，并在变更记录中说明原因。

## 发布配置与后续评审

- 事件正文默认保留 30 天是否满足隐私要求，以及用户可见的保留设置入口。
- 独立 Web Gateway 管理页的部署入口、同源策略和发布门。
- React Native 原生构建、推送通知和后台连接能力的发布门；浏览器 Viewer 是否作为独立能力仍另行评审。
