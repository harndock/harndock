# T7-01 至 T7-04 BlueStacks Mobile 认证与凭据测试记录

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 任务 ID | T7-01、T7-02、T7-03、T7-04 |
| 执行时间 | 2026-08-21 15:43–16:10，Asia/Shanghai |
| dsh-gui commit | 测试开始 `72f2f8a`；最终文档基线 `593bb0d`（移动端源码未变化） |
| dsh-sync-server commit | `ecc1f37` |
| Gateway origin | `http://127.0.0.1:8081` |
| Gateway 镜像 digest | `sha256:15c49036cec64ec2ad5c6da2eb443c5cf7a7279e1aac442f3c4b848d07805a22` |
| Mobile | `ai.deepseek.dshgui.mobile` 0.1.0，versionCode 1 |
| BlueStacks/Android | BlueStacks 5.21.780.7504；SM-G998B；Android 13/API 33 |

## 前置条件

- PostgreSQL、Redis、Gateway 和 Worker 运行；Gateway live/ready HTTP 200。
- 固定 ADB target 为 `127.0.0.1:5555`。
- `tcp:8081` 与 `tcp:8082` 已通过 ADB reverse 转发。
- E2E 凭据只从 macOS Keychain 读取；输出和记录不包含邮箱、密码或原始 token。

## 执行结果

| 任务 | 操作 | 实际结果 | 状态 |
| --- | --- | --- | --- |
| T7-01 | 安装并启动 Development Build，加载 Metro bundle，采集应用 PID 日志 | APK 0.1.0 安装成功；Pairing 页面正常；应用 PID 无 fatal/bundle error | 通过 |
| T7-02 | 验证 HTTPS origin | origin 被接受；不可达测试域进入重连并显示同步失败 | 通过 |
| T7-02 | 验证 loopback HTTP | `http://127.0.0.1:8081` 在 BlueStacks 中显示 Gateway 已连接 | 通过 |
| T7-02 | 验证非法 origin | 带 `/v1` path 的地址被 UI 拒绝并显示 origin 校验提示 | 通过 |
| T7-02 | 验证不可达地址 | `http://127.0.0.1:65535` 进入重连并显示同步失败 | 通过 |
| T7-03 | 注册、登录、refresh、logout | 201/200/200/204；旧 access、旧 refresh 和 logout 后凭据均为 401 | 通过 |
| T7-04 | Device 复用、token 摘要、撤销、重新登录 | `dev_…5438` 稳定复用；列表无原始 token；撤销后 401；重新登录和 APK 连接成功 | 通过 |

## 测试统计

```text
任务通过：4
任务失败：0
任务跳过：0
Mobile 单元测试：24 通过，0 失败
TypeScript 类型检查：通过
```

## 清理确认

- 临时账号 `acct_…5ffa` 已按精确 ID 删除。
- 专用 token `token_…ed4c` 已撤销。
- E2E 账号 active Auth sessions：0；active access tokens：0。
- BlueStacks SecureStore access token 已清除。
- E2E 账号与 Mobile Device `dev_…5438` 保留给后续 PC pairing 测试。
- 仓库证据不包含密码、refresh token、原始 access token、Authorization header 或邮箱。

## 备注

- APK 是 Expo Development Build，业务 bundle 由 Metro 8082 提供；仅安装原生 APK 不能证明业务界面已运行。
- 一条 `uiautomator` dump 辅助进程异常与应用无关；应用 PID 保持前台且日志检查无 fatal。
- 本轮不保留截图，UI 结果通过脱敏后的 accessibility 文本记录，避免 secure input 周边证据泄露。
