# T7 Android Emulator 最新 Mobile UI E2E 记录

执行时间：2026-08-26，Asia/Shanghai

## 环境

| 项目 | 结果 |
| --- | --- |
| Android | Android Studio `Medium_Tablet` AVD，Android 13 / API 33，serial `emulator-5554` |
| Gateway | `http://127.0.0.1:7019`，ready `ok` |
| Admin Web | `http://127.0.0.1:7018`，ready `ok` |
| Metro | `http://127.0.0.1:8082`，loopback HTTP 已显式允许 |
| 端口映射 | `adb reverse tcp:7019 tcp:7019`、`adb reverse tcp:8082 tcp:8082` |

## 通过项

- Development Build 安装、dev-client 启动和当前 JS bundle 加载成功。
- MP-01 无注册入口；管理员登录、冷启动会话恢复、logout 回登录页和重新登录通过。
- MP-02 读取真实 Runtime/Session；MP-05 账号、脱敏 Device、scope、Gateway、Runtime、stream、游标/补发、本机数据边界和退出入口可见。
- Settings 入口、Android 系统返回和登录软键盘通过；accessibility tree 包含稳定表单、设置、刷新和退出标签。
- 320dp、390dp、768dp 内容态无横向溢出或控件重叠。
- 旧 Mobile Device 撤销后 token/stream 失效并回登录页；修复 revoked installation 重登记后，重新登录创建全新 active Device，旧 Device 保持 revoked。
- 强制当前 access token 在服务端过期后冷启动，AuthGate 通过正式 refresh 接口完成 access/refresh 轮换且未返回登录页；旧 access/auth session 被撤销，轮换前后均仅有 1 组有效会话。
- Gateway 显式停止期间首页保留 7 个 Session 并显示重连中；Gateway 恢复后 Viewer 自动回到已连接，仍为 7 个 Session、`seq 135`，现有投影无重复或丢失。
- Mobile force-stop 期间，真实 PC Harness 在 `DESKTOP_SYNC_OK` Session 产生 `T7_OFFLINE_REPLAY_OK`；恢复 Connector 后 Gateway 从 seq 41 连续接收 seq 42–92 共 51 条事件，数据库主键保证 51 个唯一 seq，Mobile 冷启动显示完整回复。

## 修复

- Mobile：明确 `device_revoked` 时清除旧 installation ID，普通 logout 保持稳定 installation。
- Gateway：正确管理员凭据可把 revoked installation 重新登记为全新 Device；不会复活旧 Device 或旧 token。
- PostgreSQL 隔离集成用例已验证新旧 Device/token 边界；专用临时数据库在测试后已删除。

## 未关闭项

- T7-07 真实 approval 竞争尚未执行；当前 Desktop Harness 重启后窗口出现空白，需先恢复可操作 UI，再产生真实 approval/requested 事件。
- TalkBack/VoiceOver 实际焦点遍历未执行。
- 动态切换 AVD 分辨率会触发 Expo dev-client SQLite/React Context 原生错误；每档改为冷启动后通过。

## 截图

- `login-tablet.png`
- `home-tablet.png`
- `settings-tablet.png`
- `settings-management-tablet.png`
- `session-restored-tablet.png`
- `home-phone-320dp.png`
- `home-phone-390dp.png`
- `home-tablet-768dp.png`
- `logout-returned-login.png`
- `device-revoked-returned-login.png`
- `device-reenrolled-home.png`
- `refresh-rotation-home.png`
- `stream-disconnected-home.png`
- `stream-reconnected-settings.png`
- `offline-replay-home.png`
- `offline-replay-conversation.png`

## 安全与清理

- 证据不包含密码、access token、refresh token、私钥或完整敏感响应。
- 临时 CLI 控制 Device 均已自撤销；最终仅保留 1 个 active Android Mobile Device。
- AVD 已恢复默认 2560x1600 / 320 dpi；Gateway 保持 `7019`，Admin 保持 `7018`。
