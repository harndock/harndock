# T5-06 offline、refresh、Runtime offline 和 unknown UI 验收记录

执行时间：2026-08-22（Asia/Shanghai）

## 环境

| 项目 | 值 |
| --- | --- |
| Mobile | BlueStacks，`127.0.0.1:5555`，Development Build |
| Android | SM-G998B，Android 13/API 33 |
| Gateway | `http://127.0.0.1:8081`，Docker Compose，loopback |
| Metro | `127.0.0.1:8082`，仅本地开发 |

## 变更验收

| 场景 | 结果 |
| --- | --- |
| Gateway/WS 重连 | 断开 reverse 后显示“正在重连”，保留本地 Session/设备/Runtime 缓存 |
| 手动刷新 | “刷新同步”触发 REST hydrate、缺口重试和立即 WS 重连，沿用最新 Session cursor |
| 历史补发 | 缺口显示“正在补发历史”，恢复后显示实时同步已恢复；失败可再次刷新 |
| Runtime offline | 设备与 Runtime 显示“离线”；Session 进入“PC 离线”时控制输入、prompt、cancel 和 approval 均禁用 |
| command unknown | 显示“状态未知”，不会自动重放，并提示先查看 Session 事件 |
| 无权限/失效凭据 | 显示稳定中文提示，不直接展示服务端内部错误枚举 |

## 自动化验证

- `pnpm --filter @dsh-gui/mobile typecheck`：通过。
- `pnpm --filter @dsh-gui/mobile test`：28/28 通过，无跳过。
- `git diff --check`：通过。
- 本轮 BlueStacks 使用独立 E2E 账号；测试结束后 Auth logout 返回 HTTP 204，临时凭据未写入仓库或证据文件。

## 清理

- BlueStacks Gateway reverse 已恢复为 `tcp:8081 -> tcp:8081`，Metro 已停止。
- 本轮临时 Auth refresh session 已注销；模拟器本地凭据已清理。
- codegraph 在当前会话不可用，使用本地源码、自动化测试、Compose Gateway 和 ADB/截图验收替代。
