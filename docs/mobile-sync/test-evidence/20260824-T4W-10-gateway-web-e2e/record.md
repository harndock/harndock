# T4W-10 Gateway Web + Desktop 真实 E2E 记录

执行时间：2026-08-24 14:40–15:31（Asia/Shanghai）

证据等级：本机真实 Docker Compose、真实浏览器、真实 Tauri Release Desktop、真实 PostgreSQL。所有密码、refresh/access token、pairing code、Ed25519 私钥和 cookie 原文均未写入本记录。

## 环境

| 组件 | 地址/版本 | 结果 |
| --- | --- | --- |
| Gateway Admin Web | `http://127.0.0.1:7018` | healthy；SPA、Web Auth、REST 代理正常 |
| Gateway API/WS | `http://127.0.0.1:7019` / `ws://127.0.0.1:7019/v1/ws` | healthy；Admin 不代理 WS |
| PostgreSQL / Redis | Compose 服务 | healthy |
| Desktop | `DeepSeek Harness Desktop` Release 0.1.0 | 原生菜单入口、配对、Runtime 重启和重连通过 |

## 真实 UI 与数据结果

| 场景 | 结果 |
| --- | --- |
| 管理员登录 | `admin` 登录成功；管理页无注册入口 |
| Web refresh | 容器重建、页面 reload 和新标签页后通过 HttpOnly refresh cookie 恢复；access token 未进入页面持久存储 |
| origin 隔离 | Overview 显示 Admin origin `7018`；Desktop origin 与 PC WebSocket 显示 `7019` |
| 账号与隐私 | 当前管理员、账号状态、当前设备、scope 和 access token 到期元数据正确 |
| Desktop 配置入口 | 应用菜单存在 `Remote Sync Settings...`，`Cmd/Ctrl+,` 可作为快捷入口 |
| Desktop 重新配对 | 解除旧本地身份后使用一次性 code 连接 `7019`；新设备 `Admin Mac Desktop` 绑定成功 |
| pairing | `pairing_efa73e4f79f748d494c61dc2f86fe107` 只显示一次原文；列表状态为“已消费”，绑定 `dev_7816b36d9136400eac4eaa785c5422e4` |
| Runtime | `runtime_7a95fbf2c6684a5cb4e70d07f089f54e` 显示 online；管理页为 `1/1 在线` |
| heartbeat / 重连 | Gateway 重启后 Desktop 自动重连；`connected_at` 更新，`last_heartbeat_at` 随后按 30 秒周期推进 |
| Token | 创建 15 分钟 `session.read` 的 `T4W-10 browser smoke`；原文关闭后 DOM 不可恢复；列表只保留 hint/ID；随后撤销成功 |
| 诊断 | live、ready 均正常；Runtime `1/1 在线`；WebSocket 地址为 `7019` |
| logout | “退出当前会话”成功返回登录页，refresh session 被撤销；Desktop Runtime 不受 Web logout 影响 |

## 执行中修正

- Admin 新增只读 `/admin-config`，由 `PUBLIC_GATEWAY_ORIGIN` 提供浏览器/Desktop 可访问的 Gateway origin；避免把 Admin `7018` 错当成 WebSocket 入口。
- Desktop 解除配对后同时清空旧 Gateway URL，避免从历史 `8081` 配置继续误连；新配对明确使用 `7019`。
- Debug Desktop 默认走开发 Runtime，不注入生产 Remote Sync 配置；真实 online/heartbeat 验收使用 Release Desktop，避免把 Debug 壳启动成功误报为生产闭环。

## 自动化质量门

| 验证 | 结果 |
| --- | --- |
| `dsh-sync-server pnpm test` | Console 15/15；服务端 32 通过、0 失败，4 项因该命令未注入独立 `TEST_DATABASE_URL` 跳过 |
| Compose PostgreSQL integration | 35 通过、0 失败；管理员初始化项因长期测试库已存在唯一管理员按设计跳过 |
| `dsh-gui pnpm check` | 协议、Remote Sync、插件、真实 Desktop profile、Runtime bridge、安全边界、TypeScript、Rust 全部通过；Rust 17 通过、1 个需本地 Runtime artifact 的测试按设计忽略 |
| Tauri Release build | app 与 DMG 构建成功 |
| PostgreSQL 真实查询 | pairing consumed、临时 Token revoked、Desktop device active、Runtime online、heartbeat 推进 |

## 最终收口：隔离浏览器当前设备撤销

执行时间：2026-08-24 16:21–16:23（Asia/Shanghai）

- 使用 `http://localhost:7018` 的隔离 installation 撤销当前设备 `dev_30a…9fa4`，未操作 `127.0.0.1:7018` 常用入口或 Desktop 设备。
- 撤销确认后 Console 立即返回登录页并显示当前设备已撤销；页面 reload 后 HttpOnly refresh cookie 无法恢复会话。
- PostgreSQL 确认目标设备为 revoked、活动 access token 为 0，并存在对应 `device.revoked` 审计；未撤销的 refresh session 因设备 revoked 条件无法轮换。
- Desktop 设备仍为 active，Runtime `runtime_7a95…f54e` 保持 online，复核时最近心跳年龄约 0.2 秒；其他管理设备状态未改变。
- Admin `7018` 与 Gateway `7019` ready 均返回 `ok`。至此 `T4W-04`、`T4W-10` 和 UX3 全部关闭。
