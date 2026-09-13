# T3-01 至 T3-07 与 T7-05 PC Runtime 测试记录

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 任务 ID | T3-01、T3-02、T3-03、T3-04、T3-05、T3-06、T3-07、T7-05 |
| 执行时间 | 2026-08-21 16:33–17:46，Asia/Shanghai |
| dsh-gui commit | `b9a2a44` 加本轮工作区变更 |
| dsh-sync-server commit | `ecc1f37` |
| Gateway origin | `http://127.0.0.1:8081` |
| 固定 ADB target | `127.0.0.1:5555` |
| Runtime artifact | `2026.08.17.1`，darwin-aarch64，64825232 bytes |
| Runtime SHA-256 | `4a0d3354e03cd13613e74cb5598e6380070a1887dac905af6ccb1cbc31dced2b` |

## 执行结果

| 任务 | 操作 | 实际结果 | 状态 |
| --- | --- | --- | --- |
| T3-01 | 检查配对配置字段与权限 | `0600`；仅元数据/公钥；敏感字段数为 0 | 通过 |
| T3-02 | 单次码 pairing exchange、PC register | Device/Runtime 创建成功；Connector 使用 Ed25519 身份连接 | 通过 |
| T3-03 | 检查 macOS Keychain 与解除配对 | 配对后私钥项存在；解除后配置、outbox、Keychain 项均不存在 | 通过 |
| T3-04 | 检查 WS、Runtime 状态和心跳 | Runtime online；6 秒窗口内心跳前进；重连/backoff 与 control ready 自动测试通过 | 通过 |
| T3-05 | 运行 snapshot/event/ack/outbox/cursor 测试 | Remote Sync 测试组通过 | 通过 |
| T3-06 | 运行 Harness control adapter 测试 | prompt/cancel/approval adapter 路径通过自动测试 | 通过 |
| T3-07 | 正式 Desktop `.app` 配对、设置、解除配对 | 原生设置菜单可达；配对可见；页面内二次确认解除成功 | 通过 |
| T7-05 | BlueStacks 读取 PC Device/Runtime | Gateway 已连接；Mac Desktop T3 与 desktop Runtime 在线；心跳可见 | 通过 |

## 现场观察

- ADB 同时列出 `127.0.0.1:5555` 和 `emulator-5554`；本轮只操作固定 target。
- BlueStacks 模拟键盘快速输入 43 位测试令牌会丢字符；逐字符节流输入后长度与非可逆校验值一致，连接成功。此问题属于测试输入自动化，不是 SecureStore 或 Gateway 改写。
- 配对和解除配对后的 Runtime 重启曾复现 `os error 35`；日志显示 Runtime 已输出 URL，根因是 nonblocking Unix listener 接受的 stream 在 ready 帧读取时返回 `EAGAIN`。显式恢复 blocking 模式后，正式包连续两次启动均完成 ready 握手。
- Tauri `window.confirm()` 在正式 WebView 中未出现可操作弹窗，改为页面内两步确认后完成实际清理。

## 清理确认

- 临时 Auth session 已 logout。
- 临时账号已按精确 ID 删除，账号剩余行数为 0。
- BlueStacks SecureStore access token 已清除。
- Desktop 配置、outbox 和 macOS Keychain 私钥已清除。
- 仓库证据不包含密码、refresh token、原始 access token、配对码、Authorization header 或私钥。

## 验证统计

```text
仓库 pnpm check：通过
Remote Sync：10 通过，0 失败
Mobile：24 通过，0 失败
Rust：17 通过，0 失败，1 个 Runtime artifact 测试按设计忽略
Bundled Runtime：合同校验通过
git diff --check：通过
```
