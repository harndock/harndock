# 移动端多端同步与远程控制功能需求

版本：0.7（Mobile 产品与 UI 基线重排）
状态：协议、Mobile 信息架构与交互原型已冻结；进入 Mobile 优先实施，Gateway Web/Desktop 仅处理阻断性缺陷
更新时间：2026-08-24

## 1. 产品定义

本产品让用户离开电脑后仍能安全地查看 PC Harness Runtime 的 Session，并在授权范围内发送消息、停止任务和处理一次性工具审批。它由 Desktop Connector、React Native Mobile Viewer/Controller、独立 Web Gateway 管理页和可选的浏览器 Viewer 组成；不是云端 Agent，也不是桌面 Harness Web GUI 的逐像素重写。Mobile 必须延续 DeepSeek Harness 的 Session、Conversation、Composer、工具事件与审批心智模型，并用原生移动导航适配小屏、触控、键盘和安全区。

### 1.1 核心原则

1. **PC 是唯一执行源**：模型、Agent、Tool、文件、审批和 Session 生命周期均在 PC 完成。
2. **云端是协调层**：Gateway 负责身份适配、设备、连接、事件镜像、命令队列、广播和审计，不执行模型、Shell、文件或插件。
3. **事件是真相**：客户端由 Session event stream 投影状态；命令状态只能说明控制请求处于什么阶段。
4. **至少一次投递**：事件通过游标、持久化、ack 和去重实现恢复，不假设网络 exactly-once。
5. **V1 先解决可信查看和基础控制**，不把团队协作、商业化和复杂编辑混入首发。
6. **产品心智同源、布局原生适配**：Mobile 与 Harness 使用一致的对象名称、状态语义、视觉层级和控制反馈；不把桌面三栏压缩到手机，也不以 WebView 包装桌面页面。

### 1.2 统一连接模型

Gateway 地址是部署级连接入口，所有客户端使用同一个 Gateway origin，但不同客户端使用不同的身份凭据：

| 客户端 | Gateway 配置 | 建立连接的凭据 | 主要通道 |
| --- | --- | --- | --- |
| harndock Desktop | 用户在 Remote Sync 设置中填写 origin | PC Device 的 Ed25519 私钥和公钥 | `POST /v1/pairings/exchange`、`/v1/ws` |
| Mobile Viewer/Controller | 配对/连接页填写或读取 origin | harndock Auth 签发的短期 access token | REST、`/v1/stream` |
| Gateway Web Console | 独立 Admin origin | HttpOnly refresh cookie + 内存 access token | 同源代理后的 REST、诊断接口 |

Desktop 不使用 Viewer access token；一次性配对码只用于首次创建 PC Device，不能当作长期凭据。Mobile access token 也不能用于 PC Connector 的签名注册。

Gateway URL 必须是 origin，不包含 `/v1`、查询参数或 hash。生产环境使用 HTTPS；本地开发可以通过显式配置允许 loopback HTTP，例如 `http://127.0.0.1:7019`。Gateway Admin 本地使用 `http://127.0.0.1:7018` 并同源代理 HTTP API；任何公网 HTTP 都不在 V1 支持范围内。

### 1.3 管理员初始化与登录生命周期

Gateway 只维护由私有部署初始化的唯一管理员账号，不开放客户端注册，且不把密码或 refresh token 暴露给客户端：

1. Gateway 首次启动从环境变量初始化管理员账号；默认本地账号为 `admin`，默认密码为 `admin123`。
2. harndock Auth 完成管理员登录和 refresh session 管理；Web 页面不提供注册入口。
3. 客户端获得短期 access token 或等价身份会话，并调用 Gateway 的当前身份接口。
4. Gateway 根据 harndock Auth principal 创建或更新本地 `accounts` 记录，返回脱敏账号摘要；客户端不能自报 `accountId`。
5. 用户首次连接 PC 时生成一次性 pairing code；Desktop 兑换后创建 PC Device 和 Runtime。
6. 用户首次使用 Mobile 时注册当前安装实例并获得绑定到该 Device 的 access token。

管理员通过携带当前凭据的 curl 调用修改接口更新账号密码；成功后所有旧登录会话立即撤销。环境变量只参与首次初始化，不覆盖数据库中的后续修改。

### 1.4 用户目标

- 在手机上快速知道 PC 是否在线、哪个 Session 正在运行、是否等待审批。
- 打开 Session 后先看到可靠快照，再持续接收有序实时事件。
- 在网络短暂中断、刷新或重新登录后，不丢事件、不重复渲染、不重复执行命令。
- 在授权范围内发送 prompt、停止任务和处理一次性审批，并能看到明确的命令状态。
- 管理已配对设备，发现异常设备后立即撤销其读取和控制能力。
- 从 Harness Desktop 切换到 Mobile 时，不需要重新理解 Session、对话、工具和审批的含义；主要差异只来自移动端导航和能力边界。

## 2. 角色、设备与权限

| 主体 | 能力 | 约束 |
| --- | --- | --- |
| Account owner | 管理账号下的设备、PC Runtime 和授权 Session | 权限由服务端 principal 推导，不接受客户端自报账号 |
| Controller | 查看授权 Session，发送 prompt、cancel、approval | 每个命令仍须通过设备、Runtime、Session 和当前状态校验 |
| Viewer | 查看授权 Session、历史和实时事件 | 不能改变运行状态 |
| PC connector | 代表本机 Runtime 上行事件、接收命令 | 不是登录用户；必须使用设备私钥签名注册 |

V1 默认模型是：一个账号、一个活动 PC Runtime、多个 Viewer/Controller 设备。Session 级角色继承账号授权，但接口必须保留 `accountId + deviceId + sessionId` 三层校验位，后续才可接入更细的授权策略。

### 2.1 对象与凭据边界

| 对象 | 责任 | 可展示字段 | 不应展示/保存的内容 |
| --- | --- | --- | --- |
| Account | harndock Auth 确定的账号/租户边界 | 脱敏账号标识、状态、设备数 | 密码、refresh token、完整认证响应 |
| Device | 一个客户端安装实例；保存公钥、平台、名称和撤销状态 | Device ID、名称、平台、在线状态、最近在线 | PC 私钥、完整 token |
| Runtime | PC Harness 的执行实例；绑定一个 PC Device | Runtime ID、状态、心跳、版本 | 本地 Harness 私有配置 |
| Access token | 绑定到 Device 的短期能力凭据 | token hint、scope、创建/过期/最近使用时间 | 原始 token 只能创建成功时显示一次 |
| Pairing code | 创建 PC Device 的一次性短期凭据 | 有效期、是否已使用 | 不写入日志，不作为长期登录凭据 |

设备类型和权限必须分开：Mobile、PC、Browser 是设备类型；`session.read`、`session.control` 是 token scope。Viewer/Controller 是当前会话能力，不应永久写死为设备角色。

### 2.2 权限矩阵

| 操作 | Owner | Controller | Viewer | Connector |
| --- | --- | --- | --- | --- |
| 查看设备和 Runtime | 是 | 否/按授权 | 否 | 否 |
| 查看 token 元数据 | 是 | 仅当前设备 | 否 | 否 |
| 签发/撤销 access token | 是 | 仅当前设备的开发 token | 否 | 否 |
| 撤销设备 | 是 | 否 | 否 | 否 |
| 查看 Session 目录/历史/实时事件 | 是 | 是 | 是 | 上行源 |
| 发送 prompt | 是 | 是 | 否 | 执行前二次校验 |
| cancel 当前任务 | 是 | 是 | 否 | 执行 |
| approval respond | 是 | 是 | 否 | 执行前二次校验 |
| 修改账号/商业设置 | V1 不提供 | 否 | 否 | 否 |

## 3. 版本范围

### 3.1 V1 必须交付

- harndock Auth 管理员登录/refresh/logout、短期 access token、凭据修改和设备会话失效；不开放注册。
- 独立 Web Gateway 管理页：管理员登录、账号摘要、设备、Runtime、access token、连接诊断和隐私设置。
- Desktop Remote Sync 设置：Gateway origin、一次性配对码、设备名、配对状态、重新配对和解除配对。
- Mobile 连接设置：Gateway origin、正式身份登录边界、开发环境短期 token 输入、当前账号/设备/scope/过期时间摘要。
- Mobile 原生产品壳：登录后以 Session 为主入口，Conversation 为核心工作面，设置页承载 Gateway、账号、当前设备、Runtime 摘要和同步诊断。
- Mobile Harness 同源交互：消息与工具事件按对话时间线展示，Composer 固定在键盘安全区上方，等待审批时由一次性审批面板接管输入区。
- 账号、设备、Runtime 和 access token 的可视化管理边界；原始 token 不进入列表和日志。
- 登录、退出登录和首次账号初始化有明确状态；未登录时不能直接进入 Session 工作台。
- PC 一次性配对、Ed25519 设备密钥、设备列表和单设备撤销。
- PC Runtime 在线状态、最后心跳、延迟和断线原因。
- Session 目录：标题、工作目录安全摘要、运行状态、最近活动、未读/待审批标记。
- Session 快照、按 `afterSeq` 的历史补发、实时事件订阅和未知事件占位。
- 多设备订阅同一 Session，事件按 `sessionId + seq` 去重和按序投影。
- `session.prompt`、`session.cancel`、`approval.respond` 三类命令。
- 命令状态：received、authorized、queued、executing、completed、rejected、expired、unknown。
- 普通命令串行；cancel/审批按明确优先级处理；审批 first-wins。
- 连接诊断、游标缺口、重连、补发、设备撤销和错误恢复提示。
- 本地安全缓存、最小命令状态恢复和脱敏事件摘要。

### 3.2 V1 明确不做

- 云端执行模型、Shell、文件系统或 Harness plugin。
- 将 PC 本地 HTTP 端口暴露到公网。
- 通过客户端自报 `accountId` 或 `deviceId` 取得权限。
- 在普通设备列表中显示完整 access token、PC 私钥或 pairing code 原文。
- 在移动端重写完整桌面 Web GUI。
- 将桌面三栏布局直接缩放到 Mobile，或使用 WebView/iframe 包装 Harness Desktop UI 作为正式客户端。
- 在 Mobile 首页优先展示完整设备、Runtime、Token 或 pairing 管理表格；这些能力继续由 Gateway Web 管理页承担。
- steer/inject、retry、rename、fork、跨 PC 迁移和控制权租约。
- 附件、图片、产出文件对象存储、推送通知和 PC 后台托盘。
- 团队空间、多人共享 Session、组织管理、套餐、订阅、计费和付费配额。
- 跨账号查询、角色授权、全局设备搜索和运维管理员后台。

### 3.3 后续版本

- V1.1：控制权租约、复杂动作、Session fork/rename、丰富的子 Agent 展示。
- V1.2：推送通知、附件/产出文件、PC 后台运行。
- V2：多 PC、跨 PC 迁移、端到端加密和细粒度策略管理。

## 4. 页面与交互范围

原型页面编号是产品验收的最小 UI 覆盖范围。综合 Web/Desktop 原型继续使用 `prototype.html`；Mobile 产品基线单独使用 `mobile-prototype.html`，避免把响应式 Web 工作台误认为 React Native 页面已设计或已实现。

| 页面 | 编号 | Mobile 原型 | 载体 | 目的 | 关键状态 |
| --- | --- | --- | --- | --- | --- |
| 认证与配对 | P-01 | MP-01 | Web 管理页、RN AuthGate、Desktop 设置 | 建立账号会话、连接 PC | 未登录、登录中、成功、过期、失败 |
| Session 目录 | P-02 | MP-02 | RN Viewer/Controller | 找到活动和历史 Session | 加载、活动中、待审批、已完成、离线、空状态 |
| Session 详情 | P-03 | MP-03、MP-04 | RN Viewer/Controller | 查看事件并执行基础控制 | 快照、实时、流式、审批、缺口、无权限、PC 离线 |
| 设备管理 | P-04 | 不进入 Mobile 主流程 | Web Gateway 管理页 | 查看并撤销设备 | 当前设备、在线、离线、撤销确认、撤销完成 |
| 连接诊断 | P-05 | MP-05 仅显示当前连接摘要 | Web Gateway 管理页；RN 设置摘要 | 解释同步是否可靠 | 在线、重连、补发中、游标缺口、Gateway/PC 错误 |
| 账号与隐私 | P-06 | MP-05 仅显示当前会话摘要 | Web Gateway 管理页；RN 设置摘要 | 呈现会话和数据边界 | 当前账号、保留提示、退出登录；V1 不伪造计费 |

### 4.0 Mobile 产品与视觉基线

#### 4.0.1 信息架构

Mobile 使用四层结构，不复制 Harness Desktop 的 `sidebar | conversation | details` 三栏：

1. **AuthGate**：启动恢复 Gateway origin 和安全会话；无有效会话时进入 MP-01，不能闪现受保护页面。
2. **Session 首页**：MP-02 是登录后的目录入口；最近访问过有效 Session 时可以直接恢复 MP-03，但必须保留返回目录的明确入口。
3. **Conversation**：MP-03 是核心工作面；顶部显示 Session/Runtime/同步摘要，中间显示安全事件投影，底部常驻 Composer 或 MP-04 审批面板。
4. **设置与诊断**：MP-05 只承载当前账号、Gateway origin、当前 Mobile Device、PC Runtime 摘要、同步诊断和退出；完整设备、Token、pairing 管理通过 Gateway Web 完成。

#### 4.0.2 Harness 到 Mobile 的映射

| Harness Desktop 结构 | Mobile 结构 | V1 行为 |
| --- | --- | --- |
| Workspace/Session sidebar | Session 首页；Conversation 左上角抽屉 | 浏览已授权 Session，不新建 Workspace/Session |
| Conversation center | 全屏 Conversation | 消息、工具摘要、状态和历史恢复 |
| Details panel | 底部 sheet 或独立详情页 | 仅展示当前 Session/连接的必要摘要 |
| Resident Composer | 键盘安全区上方固定 Composer | prompt、发送中、停止中、禁用和失败恢复 |
| Tool/command nodes | 对话流内可折叠卡片 | 默认展示安全摘要，不展开敏感 payload |
| Approval composer takeover | MP-04 一次性审批面板 | 接管 Composer，允许一次/拒绝，响应后等待真实事件 |
| Settings/sidebar footer | MP-05 设置页 | 当前会话和连接摘要，不复制 Web 管理后台 |

#### 4.0.3 视觉与组件规则

- 颜色以 Harness `ui-theme` 的 neutral-bluish、DeepSeek blue、green、amber、red 语义为基线；React Native 建立命名 token，不在页面内散落十六进制颜色。
- 字体使用系统字体；正文、元信息、代码、状态和操作建立稳定层级，Session ID、seq、commandId 不是普通用户首要标题。
- 触控目标不小于 44×44；主要卡片圆角、边框、间距和状态色保持一致，不能继续使用平台默认 `Button` 作为正式视觉组件。
- Conversation 只有事件列表滚动；Header、连接 Banner、Composer/审批面板保持可见。键盘出现时不能遮挡输入、发送、停止或审批按钮。
- 320px 宽度不得横向滚动；768px 允许增加内容宽度和边距，但不切换成桌面三栏。
- loading、empty、offline、cursor gap、unauthorized、revoked、command unknown、approval already decided 均使用统一 Banner/Card/EmptyState 组件，不以调试字符串散落展示。
- 深色模式属于设计 token 能力，V1 代码结构必须支持；首个发布是否启用深色主题在 UI 评审门确认。

#### 4.0.4 页面启动与返回规则

1. 冷启动先显示受控 Splash/AuthGate，不直接展示登录或 Session 的错误中间态。
2. 已登录且最近 Session 仍授权时恢复 Conversation；否则进入 Session 首页。
3. Conversation 左上角进入 Session 抽屉，系统返回先关闭 sheet/drawer，再返回 Session 首页。
4. 设置页从 Session 首页或 Conversation 进入；修改 Gateway origin 需要重新验证并重新建立会话，不能静默沿用旧 token。
5. 登录失效、当前设备撤销或 logout 后原子清理安全会话和内存状态，返回 MP-01；不得保留可操作的旧 Conversation。

### 4.1 P-01 认证与客户端连接

1. Web 管理页和 RN AuthGate 未登录时只展示 harndock Auth 管理员登录入口和数据边界说明，不提供注册，不要求客户端自建密码逻辑。
2. 生产环境访问独立 Admin origin（例如 `https://admin.sync.example.com/`，本地为 `7018`）必须直接进入 Web 管理页；Gateway API/WS origin 本地为 `7019` 且不提供管理页面，浏览器刷新 Admin 的 `/login`、`/devices` 等页面不能返回 404。
3. Desktop 未配对首次启动时必须停留在可操作的 Gateway 配置引导，并允许用户明确选择“暂不配置，进入本地 Harness”；进入 Harness 后仍需有常驻可发现的“Gateway 与远程同步”入口，原生应用菜单和 `Cmd/Ctrl+,` 只作为兜底。
4. Desktop 连接流程输入 Gateway origin、一次性配对码、设备名和平台；配对成功后展示 `accountId`、`deviceId`、`runtimeId`、Runtime 状态和最近心跳。
5. Mobile 正式流程在 MP-01 输入 Gateway origin、管理员账号和密码，由 harndock Auth 签发短期 access/refresh 会话；生产构建不显示手工 token 输入。开发 token 入口仅允许在显式 debug 构建中启用，并不得成为验收主路径。
6. 配对码过期、重复使用、格式错误、Gateway 不可达或 token 过期时，展示统一的可操作错误，不泄漏码是否被占用。
7. Desktop 私钥只进入平台安全存储；Mobile token 只进入系统安全存储；原型和诊断页不展示真实密钥或原始 token。
8. 修改 Gateway origin 后必须重新校验协议和 origin；HTTP 仅允许显式开启的 loopback 开发配置。

### 4.2 P-02 Session 目录

- MP-02 登录后优先展示 Session，不在 Session 列表上方展开完整设备/Runtime 清单；PC 状态只占一个紧凑摘要卡或异常 Banner。
- “需要处理”优先展示等待审批或需要用户动作的 Session；其余按最近活动分组，保留 Harness 的 Session 名称和状态语义。
- 活动 Session 默认按 `updatedAt + sessionId` 游标分页。
- 行项目展示标题、工作目录标签、运行状态、最近活动、未读事件和审批标记。
- PC 离线时保留云端已确认的历史，明确标注“PC 离线，不能发送控制命令”。
- 首次加载、分页失败、没有 Session 和筛选无结果必须有独立空状态。
- 点击整行进入 Conversation；不使用每张卡片重复的“查看 Session”平台默认按钮。

### 4.3 P-03 Session 详情

- 打开顺序：本地快照 → REST 历史补发 → WebSocket 实时订阅。
- 顶部显示 Session 标题以及紧凑的 Runtime/同步状态；最后游标进入详情或诊断，不作为主标题占据首屏。
- 事件按安全摘要展示：消息可显示有限文本；工具显示名称、范围和审批状态；工具参数/结果默认不展开；未知事件保留占位。
- 消息时间线复用 Harness 的角色与事件语义；不把所有事件渲染成同一种聊天气泡，也不把“最近事件”作为独立调试列表重复展示。
- Composer 固定在键盘安全区上方；发送、停止、离线禁用、排队和错误恢复使用同一组件状态机，不在正文中堆叠平台默认按钮。
- prompt 发送前显示“将由 PC Harness 执行”；发送后展示命令状态，不直接伪造助手回复。
- cancel 进入“停止中”，直到真实 `turn/end` 或命令失败；不能用本地点击直接把 Session 标记为完成。
- MP-04 等待审批时接管 Composer 区域，展示工具名、脱敏原因/命令摘要和“允许一次/拒绝”；审批一次性 first-wins，其他设备立即显示“已由其他设备处理”。
- 游标出现缺口时暂停新事件折叠，显示补发状态；补发成功后恢复订阅，失败时允许重试。

### 4.4 P-04 设备、Runtime 与 Token 管理

- 展示设备名、平台、当前/其他设备、在线状态、最近在线、最近 Runtime、Device ID 脱敏值和权限摘要。
- 展示当前账号下 token 元数据：名称、绑定设备、scope、创建时间、过期时间、最近使用时间和有效/过期/撤销状态。
- 创建 token 时选择绑定设备、scope 和有效期；原始 token 只在成功结果中显示一次，并提供复制后关闭提示。
- 撤销 token 和撤销设备是两个不同动作；撤销设备会级联失效该设备的所有 token，撤销 token 不影响设备密钥和其他 token。
- 撤销必须二次确认；完成后当前设备的 REST、Viewer stream、PC WS 和命令路径均失效。
- 撤销当前设备时先退出本地会话；不允许通过 UI 恢复已撤销设备，必须重新配对。
- Desktop 配对入口展示 Gateway origin、码有效期、使用次数限制和不要公开分享的安全提示。
- 登录用户可在 Web 管理页为当前账号创建、查看状态和撤销 pairing code；原文仅在创建成功结果中显示一次，列表不得返回原文，普通用户流程不得依赖 Docker/CLI。

### 4.5 P-05 连接诊断

Web 管理页最少展示：Gateway 地址（脱敏）、PC Runtime、WebSocket 状态、最近心跳、延迟、当前 Session 游标、补发状态、最近错误和重试按钮。诊断页不能显示 token、私钥、完整环境变量、完整工具 payload 或本机敏感路径。

### 4.6 P-06 账号与隐私

展示当前账号标识、当前登录设备、token 会话摘要、事件正文保留策略、退出登录和帮助入口。V1 不展示套餐、订阅、订单、余额、付费额度等未规划能力。

## 5. 核心业务流程

### 5.1 PC 配对

1. 用户从 harndock Auth 登录。
2. Gateway/部署侧为已有账号生成短时一次性配对码。
3. 桌面端生成 Ed25519 密钥对并提交配对码、公钥、设备名、平台。
4. Gateway 原子消费配对码，创建 device/runtime，并返回绑定结果。
5. 桌面端把私钥写入平台安全存储，以签名挑战注册 PC Connector。
6. 客户端刷新设备和 Runtime 状态。

### 5.2 多端实时查看

1. 客户端读取本地 Session header/projection。
2. `GET /v1/sessions` 取得目录，`GET /v1/sessions/:id` 取得快照。
3. 以本地 `lastSeq` 调用 events REST 补发，再建立 `/v1/stream` 订阅。
4. Gateway 仅在 PostgreSQL 提交事件后广播。
5. 客户端按 `(sessionId, seq)` 去重；缺口触发补发，未知事件安全占位。

### 5.3 远程控制

1. 用户在当前投影上发起 prompt/cancel/approval。
2. 客户端发送设备级幂等 `commandId` 和 `baseSeq`。
3. Gateway 校验 token scope、设备状态、Session 授权、Runtime 在线状态、期限和陈旧状态。
4. 命令写入 PostgreSQL 队列；在线 PC 收到后再次校验并执行。
5. Connector 回传 authorized/completed/rejected；真实 Session event 决定业务结果。
6. 客户端轮询/接收命令状态并等待事件确认；未知状态不自动重放。

### 5.4 断线恢复

- Viewer 断线：指数退避，带最近游标恢复；若超过广播窗口，走 REST `afterSeq`。
- PC 断线：设备和 Runtime 显示离线，控制输入禁用；云端保留已确认历史。
- Gateway 重启：从 PostgreSQL 恢复 Session/命令状态，Redis 只重建在线协调。
- 命令确认丢失：状态标记 `unknown`，用户可查看 Session 事件后重新提交。

## 6. 功能需求清单

| 编号 | 需求 | 优先级 | 验收 |
| --- | --- | --- | --- |
| FR-01 | harndock Auth 提供唯一管理员初始化、登录、refresh/logout、凭据修改和短期 access token，Gateway 不提供注册 | P0 | 注册路由为 404；未鉴权请求被拒绝；修改凭据后旧会话失效；Web refresh 凭据不落普通 Web Storage |
| FR-02 | 当前账号可自助签发一次性配对码并绑定 PC Ed25519 公钥 | P0 | 创建/list/revoke 仅限当前账号；原文只返回一次；成功、过期、撤销、重放、重复公钥均有测试 |
| FR-03 | 一个账号可绑定多个移动/浏览器设备和一个活动 PC Runtime | P0 | 设备列表与状态正确 |
| FR-04 | 单设备撤销立即失效读取、控制、Viewer WS 和 PC WS | P0 | 撤销集成测试通过 |
| FR-05 | Session 目录按不透明游标分页 | P0 | 首次、下一页、空页、错误态完整 |
| FR-06 | Session 快照与事件历史按 `afterSeq` 读取 | P0 | 不重复、不跳号 |
| FR-07 | Viewer stream 支持 subscribe、resume 和 cursor_gap | P0 | 缺口回 REST 补发 |
| FR-08 | Session 事件至少一次广播并按序投影 | P0 | 多设备内容一致 |
| FR-09 | 事件摘要默认脱敏，未知类型安全占位 | P0 | 工具 payload 不出现在普通 UI |
| FR-10 | prompt 命令设备级幂等、可查状态、基于 `baseSeq` | P0 | 重复提交返回原状态，陈旧返回 stale_state |
| FR-11 | cancel 高优先级下行且 UI 显示停止中 | P0 | 真实结束事件前不提前完成 |
| FR-12 | approval first-wins，重复响应返回 already_decided | P0 | 双设备竞争测试通过 |
| FR-13 | 普通命令按 Session 串行，离线命令不假装执行 | P0 | 队列/重试/unknown 有清晰状态 |
| FR-14 | 连接诊断展示心跳、延迟、游标和补发结果 | P0 | 故障可定位和重试 |
| FR-15 | 所有命令、审批和撤销写入审计 | P0 | actor/device/target/status 可追踪 |
| FR-16 | Controller/Viewer 权限由服务端强制 | P0 | UI 绕过不能越权 |
| FR-17 | 本地缓存只保存安全投影和最小命令状态 | P0 | 崩溃恢复不恢复 payload |
| FR-18 | 320px 宽度核心 Session 查看和控制可用 | P1 | 无横向溢出且焦点可见 |
| FR-19 | 设备撤销、数据删除和事件保留策略有用户可见提示 | P1 | 隐私评审通过 |
| FR-20 | 多 PC、租约、附件、通知、商业化能力不进入 V1 | P0 | schema/UI/部署均无隐式依赖 |
| FR-21 | Mobile 与 Harness 共享 Session/Conversation/Composer/审批心智和命名 | P0 | MP-01–MP-05 设计评审通过；用户不需要理解第二套对象和状态 |
| FR-22 | Mobile 登录后以 Session 为主入口，设备/Runtime 完整管理不进入首页 | P0 | MP-02 首屏可找到活动/待审批 Session；设备库存只在 Web 管理页 |
| FR-23 | Conversation 使用单一事件时间线和常驻 Composer/审批接管区 | P0 | 消息、工具摘要、命令、离线、发送/停止和 MP-04 审批状态可走通；键盘不遮挡控制 |
| FR-24 | Mobile UI 使用可复用 token/组件和分层页面架构 | P1 | 页面不使用散落颜色和平台默认 Button；导航、screen、feature、theme 与 transport/projection 边界可测试 |

## 7. 状态与错误展示

客户端必须把内部状态映射为稳定用户文案，不直接展示未知枚举。

| 内部状态 | UI 文案 | 是否可控制 |
| --- | --- | --- |
| PC online / stream connected | 已连接 | 按角色 |
| reconnecting | 正在重连 | 否，允许重试 |
| cursor replaying | 正在补发历史 | 否，等待恢复 |
| PC offline | PC 离线 | 否 |
| command queued | 已排队 | 是，按操作提供取消/等待 |
| command executing | 执行中 | 取消可用 |
| command unknown | 状态未知 | 否，先查看事件 |
| stale_state | 页面已过期，请刷新 | 重新加载后可用 |
| already_decided | 已由其他设备处理 | 否 |
| revoked | 设备已撤销，请重新配对 | 否 |

## 8. 非功能需求

### 性能与容量

- 在线事件端到端 P95 ≤ 1 秒（不含模型供应商延迟）。
- 最近活跃 Session 首屏 P95 ≤ 5 秒，先显示本地快照再显示连接状态。
- 单个 Session 事件顺序不能被并发设备打乱。
- 首版以单实例 Gateway + PostgreSQL/Redis 验证 10,000 长连接目标；压测不达标时再做无状态水平扩展。

### 可靠性

- 事件至少一次；Gateway 重启不丢已确认事件和命令状态。
- PC、Gateway、Redis、PostgreSQL 分别故障时均有可解释状态。
- Redis 丢失可从 PostgreSQL 和活动连接重建，不是事件真相源。
- 迁移、备份、恢复、镜像回滚和过期数据清理由操作手册覆盖。

### 安全与隐私

- 生产环境 TLS、短期 token、设备密钥轮换/撤销、account/device/session 三层授权；本地 HTTP 仅限显式 loopback 开发配置。
- 不上传 API key、refresh token、工作区文件、完整环境变量或私钥。
- 工具参数/结果默认不在普通 UI 展开；事件正文默认加密存储并按保留策略清理。
- 日志和指标脱敏，不使用完整 prompt、路径或 token 作为 label。
- 撤销、配对和高风险控制具备明确反馈；涉及不可逆删除时必须二次确认。

### 可用性与无障碍

- 320px、768px、1280px 宽度不横向溢出。
- 控件具备键盘焦点、可访问名称、禁用态和进行中态。
- 实时事件区使用 polite live region；审批和错误使用可读的状态提示。
- 颜色不是唯一状态来源，在线/离线/审批/错误均有文字或图标辅助。

## 9. 验收标准与需求追踪

V1 必须全部满足，并通过 MP-01–MP-05 的视觉与交互验收：

1. 两台移动设备和一个协议 Viewer 同时订阅同一 Session，事件内容、顺序和游标一致。
2. 任一 Controller 发送 prompt，其他设备在 1 秒内看到命令状态和真实新事件。
3. 两台设备同时发送普通命令时，只有一个进入 executing，另一个获得 queued 或明确拒绝原因。
4. 两台设备同时处理审批，只有一个决定生效，其他设备立即看到 already_decided。
5. 断网、刷新、Gateway 重启和重新登录后，历史按游标恢复且不重复。
6. 撤销设备后所有读取、控制和 WebSocket 路径失败；重新配对才可恢复。
7. PC 关闭或 Runtime 崩溃后，移动端显示离线，不显示虚假的执行完成。
8. 真实 Harness 上游源码未修改，公开协议包不依赖私有服务端源码。

需求与交互原型的最小对应关系：FR-01/02 → P-01；FR-03/04/14 → P-04/P-05；FR-05–09 → P-02/P-03；FR-10–13 → P-03；FR-15/16/19 → P-04/P-06；FR-18 → 全部页面响应式验收。

## 10. 发布配置与后续评审

- harndock Auth 的账号恢复、账号删除和发布环境策略配置。
- 事件正文保留时长、用户删除确认和可验证清理的最终策略。
- 独立 Web Gateway 管理页的部署入口、同源策略和发布门。
- 首发浏览器 Viewer 是否正式支持，还是只用于协议验收；推送通知、后台连接和原生安全存储的发布门。
