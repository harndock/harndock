# T3-08 Desktop 远端连接状态验收记录

日期：2026-08-24（Asia/Shanghai）

范围：Release Desktop 的本地 Runtime、Gateway 连接、远端 Runtime online、最近心跳和生产 Runtime/profile 升级。

## 产物

- Desktop app：`apps/desktop/src-tauri/target/release/bundle/macos/DeepSeek Harness Desktop.app`
- Runtime：`dist/runtime/dsh-runtime-2026.08.24.1-darwin-aarch64.tar.zst`
- SHA-256：`01bf9f397b20aff640703f217b3f5fda4a92f40256a96c782e3ee7ad5ddd5825`
- 大小：64,832,744 bytes
- Gateway：`http://127.0.0.1:7019`
- Admin Web：`http://127.0.0.1:7018`

## 自动验证

```text
pnpm --filter @dsh-gui/remote-sync test
12 passed, 0 failed

node scripts/test-runtime-bridge.mjs
Runtime bridge verified over a real Unix socket

pnpm check
exit 0

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
21 passed, 0 failed, 1 ignored (requires explicit artifact test environment)

pnpm --filter @dsh-gui/desktop tauri build --bundles app
Finished 1 bundle
```

## 真实 Release Desktop

1. 新 `.app` 检测到 bundled Runtime `2026.08.24.1` 高于当前 `2026.08.17.1`，安装并激活新版本；`current.json` 为 `healthy`。
2. 持久 `desktop` profile 的四个产品包刷新到新 Runtime 副本；版本标记为 `2026.08.24.1`，不依赖系统 Node/pnpm。
3. Harness 页面通过 “Open Gateway and Remote Sync settings” 常驻入口返回 Tauri 配置页。
4. 页面可访问性树显示：

```text
Local Runtime     Ready
Gateway           Connected
Remote Runtime    Online
Latest heartbeat  2026年8月24日 17:16:40
```

5. 页面保持打开后，Latest heartbeat 更新为 `2026年8月24日 17:18:40`，证明不是一次性静态快照。
6. PostgreSQL 交叉查询：`runtime_7a95fbf2c6684a5cb4e70d07f089f54e | online`，查询时 `heartbeat_age_seconds = 0`；Gateway `/health/ready` 返回 `{"status":"ok"}`。

## 安全与解除配对说明

- Harness 浏览器端未新增 Tauri remote IPC、Shell 或文件权限；状态继续使用带 256-bit nonce 的私有 Unix socket。
- 心跳帧不携带 access/refresh token、私钥、pairing code 或 Session payload。
- 未在真实验收中确认解除配对，因为该动作会永久删除本机身份并需要新配对码恢复。现有 UI 路径会先停止 Runtime，再清理 Keychain 身份、配置和 outbox，并读取 stopped snapshot；状态归零、旧观测拒绝与终止行为由 Rust 单测覆盖。
