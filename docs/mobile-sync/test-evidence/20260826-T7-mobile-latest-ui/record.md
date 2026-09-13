# T7 最新 Mobile UI E2E 环境恢复记录

执行时间：2026-08-26，Asia/Shanghai

## 环境

| 项目 | 结果 |
| --- | --- |
| dsh-gui | `feat-msyc-1.0.1` / `514a2db`，存在当前 T4-09/T4-10 未提交改动 |
| dsh-sync-server | `feat-msyc-1.0.1` / `1eef71f`，工作区干净 |
| Gateway | `http://127.0.0.1:7019`，live/ready 均为 `ok` |
| Admin Web | `http://127.0.0.1:7018`，ready 为 `ok` |
| Metro | `http://127.0.0.1:8082`，packager running |
| BlueStacks | Tiramisu64 / Android 13，`127.0.0.1:5555` 与 `emulator-5554` 指向同一实例 |

## 已完成验证

- Compose 数据库迁移为最新，Gateway、Admin、Worker、PostgreSQL 和 Redis 启动成功。
- Gateway `7019` 原生登录成功；`/v1/me` 返回账号、Device 和 scope 结构；当前账号设备列表可读取 6 项，Runtime 列表可读取 1 项；logout 返回 HTTP `204`。
- 原生 Auth smoke 的 access/refresh 原文只存在于执行进程内存，证据仅记录结构布尔值、数量和状态码。
- Android Hermes bundle 在上一轮已由当前源码生成，Development Build APK 文件存在。

## 阻塞证据

- 两个 ADB target 反复出现 `abb_exec: closed`、device offline 和 `file_sync_client.cpp:477 protocol fault: failed to read stat response`。
- streamed 与 `--no-streaming` APK 安装均无法完成；BlueStacks 自身一度显示“系统界面没有响应”，选择等待后 Home 页面恢复，但 APK 安装入口仍未进入文件选择器。
- BlueStacks 配置已经启用本机 ADB access；未开启远程 ADB 网络访问，也未修改安全相关网络设置。

## 结果

结论：阻塞。

- T7-03/T7-04 的 Gateway API 前置 smoke 通过。
- 最新 RN UI 未安装到设备，因此 Settings、登录恢复、Session/Runtime、断网补发、approval、设备撤销和多尺寸截图不能判定通过或失败。
- 下一次执行前先确认 `adb shell echo ready`、`adb push` 和 `adb install` 连续稳定，再继续业务 E2E。

## 清理

- Gateway smoke 会话已 logout。
- 未创建 pairing code，未撤销设备，未修改管理员凭据。
- 仓库证据不包含密码、access token、refresh token、私钥或完整敏感响应。
