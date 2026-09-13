# Harndock Mobile

首发 React Native 客户端，使用 Expo Development Build 管理原生模块；本目录不提供 PWA 构建。

当前骨架包含：

- `app/navigation`、`screens`、`features`、`components`、`theme`、`services` 六层 UI 边界；`App.tsx` 只保留应用入口。
- React Navigation 的连接、Session 列表和 Session 页面边界；screen 只消费 feature controller，不直接操作 SQLite、Viewer stream 或 Gateway command API。
- Harness 同源的首版 design token，以及 AppHeader、Button/IconButton、Banner、Card、StatusDot、EmptyState 和导航占位组件；正式页面不再使用平台默认 `Button`。
- BottomSheet、Composer 和 ApprovalPanel 已固定 props 契约，业务实现分别留给 Session、控制和审批纵切。
- `expo-sqlite` 的本地 Session 投影数据库初始化。
- `expo-secure-store` 的版本化 Gateway origin 和 Mobile Auth 会话边界；access/refresh token 分槽保存，双槽位 active pointer 提供崩溃安全轮换和完整清理。
- MP-01 正式管理员登录：提交 Gateway origin、账号、内存密码和 SecureStore 中的稳定 Mobile installation ID；不提供注册，登录成功后才激活受保护导航。
- 导航前的受控 AuthGate：启动校验 `/v1/me`，access 过期或 401 时单次调用 `/v1/auth/refresh` 并保存旋转会话，logout、REST 认证失败和 Viewer 设备撤销统一退出受保护导航。
- 基于公开 `@harndock/sync-protocol` 的 WebSocket 客户端，支持订阅和游标恢复；`event.ack` 只由 Gateway 在持久化后发给 PC，Mobile Viewer 不发送该帧。
- 通过 Gateway REST 读取 Session 分页和 `afterSeq` 历史，在实时流出现缺口时先补发再恢复订阅。
- Session 页面已接入 prompt、cancel 和一次性 approval 命令提交，并轮询命令状态；命令完成不等同于真实 Session 事件完成。
- Session 页面展示最近事件时间线；消息显示截断摘要，工具参数/结果和未知事件 payload 不在 UI 中展开。
- WebSocket 断线后按指数退避自动重连，并使用最新 Session 游标恢复订阅。
- 未终态命令的最小状态字段持久化到 SQLite；重新进入 Session 时只恢复状态查询，不自动重放命令，也不保存 prompt/approval payload。
- 快照/事件按 `sessionId + seq` 去重、检测缺口，并持久化到 SQLite；access token 只进入 SecureStore。
- Node 单元测试覆盖投影连续序列、重复/缺口、审批状态、离线状态、状态标签、事件安全摘要、批量渲染、SQLite 存储 codec、命令终态/恢复策略、Gateway REST 的 HTTPS/分页/命令/error 契约、ViewerSync 的本地恢复/分页 hydrate/缺口补发/坏历史恢复，以及 Gateway WebSocket 的游标恢复、重连、单向 `event.ack` 契约和错误态。
- UI 架构测试固定主题 token、44×44 最小触控目标、路由、目录边界、小入口和 screen 不直接依赖 transport/storage 的约束。
- Mobile 会话与 AuthGate 测试覆盖服务端 Auth 响应校验、metadata 不含 token、access/refresh 过期分类、双槽轮换、提交指针失败回退、坏代清理、启动校验、refresh 轮换、瞬时故障阻断和设备撤销。

MP-01 管理员登录/AuthGate/refresh/logout 已接入。密码不进入 SecureStore、SQLite、日志或导航状态；生产构建不显示且不会恢复手工 token。PC 配对仍由桌面端 Tauri 流程负责。

### Gateway 地址和协议配置

这里有两个完全不同的端口：Expo Development Client 的 `Development servers` 页面显示的是 Metro JavaScript bundle（通常为 `10.0.2.2:8081`），这个地址必须保持为 `8081`；移动端登录页面的 `Gateway origin` 才填写 Gateway（本地 Docker 为 `http://10.0.2.2:7019` 或使用 ADB reverse 时的 `http://127.0.0.1:7019`）。不要把 `7019` 填入 Expo 的 Development Server URL。

本地配置放在 `apps/mobile/.env.local`（模板见 `.env.example`），Expo 会在启动 Metro 时自动读取。修改后必须重启 Metro；这些变量只写入 JavaScript bundle，不包含账号密码或 token。

移动端通过 Expo 构建时环境变量配置 Gateway 默认地址和允许的协议。默认配置只允许 HTTPS：

```bash
EXPO_PUBLIC_GATEWAY_DEFAULT_URL=https://sync.example.test \
EXPO_PUBLIC_GATEWAY_PROTOCOLS=https \
pnpm --filter @harndock/mobile exec expo start --dev-client --lan --port 8082
```

本地 Docker/BlueStacks 测试可以显式开启 HTTP：

```bash
EXPO_PUBLIC_GATEWAY_DEFAULT_URL=http://127.0.0.1:7019 \
EXPO_PUBLIC_GATEWAY_PROTOCOLS=http \
pnpm --filter @harndock/mobile exec expo start --dev-client --lan --port 8082
```

在 Android 模拟器中也可以直接使用宿主别名：

```bash
EXPO_PUBLIC_GATEWAY_DEFAULT_URL=http://10.0.2.2:7019 \
EXPO_PUBLIC_GATEWAY_PROTOCOLS=http \
pnpm --filter @harndock/mobile exec expo start --dev-client --lan --port 8081
```

如果 Gateway 通过宿主机 `127.0.0.1:7019` 暴露，并使用 BlueStacks 的 ADB 设备，还需要把宿主机端口反向转发到模拟器：

```bash
adb -s 127.0.0.1:5555 reverse tcp:7019 tcp:7019
```

此时 MP-01 登录页面可以填写 `http://127.0.0.1:7019`。这只适合本地开发测试；生产构建应将 `EXPO_PUBLIC_GATEWAY_PROTOCOLS` 固定为 `https`。`7018` 是浏览器 Admin Web 入口，不用于 Mobile 同步连接。

也可以同时允许两种协议：`EXPO_PUBLIC_GATEWAY_PROTOCOLS=http,https`。即使显式启用 HTTP，也只接受 `localhost`、`*.localhost`、`127.x`、`::1` 以及 Android 模拟器宿主别名 `10.0.2.2`/`10.0.3.2`；公网或局域网 HTTP 会被拒绝。变量会在 JS bundle 构建时写入，修改后需要重启 Expo/Metro 并重新加载 bundle；生产环境必须只允许 HTTPS。

正式登录页面默认不包含手工 token。只有 Development Build 同时显式设置以下变量时，才会渲染并恢复旧 debug token；即使生产构建误设该变量，`__DEV__` 门禁仍保持关闭：

```bash
EXPO_PUBLIC_MOBILE_DEBUG_TOKEN=true
```

Gateway URL 必须是 origin，不能包含用户名/密码、`/v1`、查询参数或 hash。HTTP Gateway 的 WebSocket 会自动使用 `ws://`，HTTPS Gateway 会使用 `wss://`。连接成功后规范化 origin 会保存到 SecureStore；修改已保存的 origin 会先清除旧 access token，避免把旧 Gateway 的凭据静默发送给新地址。

## 开发

```bash
pnpm install
pnpm --filter @harndock/mobile test
pnpm --filter @harndock/mobile typecheck
pnpm --filter @harndock/mobile prebuild
pnpm --filter @harndock/mobile ios
```

首次运行需要 Xcode 或 Android Studio；正式运行使用 Development Build，不依赖 Expo Go。
