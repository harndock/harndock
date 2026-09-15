# 端到端测试记录

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 任务 ID | T?-?? |
| 执行时间 | YYYY-MM-DD HH:mm，Asia/Shanghai |
| 执行人 |  |
| harndock 分支/commit |  |
| harndock-sync-server 分支/commit |  |
| Gateway origin | 脱敏 origin，不含 token/path/query/hash |
| Docker 镜像 digest |  |
| Mobile 版本 |  |
| BlueStacks/Android |  |

## 前置条件

- [ ] PostgreSQL、Redis、Gateway 和 Worker 健康。
- [ ] 使用独立 E2E 账号，不使用个人账号。
- [ ] ADB target 固定为本轮记录中的单一 serial；Android Studio AVD 与 BlueStacks 不混用。
- [ ] `7019` Gateway 和 `8082` Metro 反向端口已配置；Admin Web 使用宿主机 `7018`。
- [ ] `adb shell echo ready`、临时文件 `adb push` 和 APK 安装均通过，避免把 BlueStacks file-sync transport 故障误判为应用失败。
- [ ] 日志、截图和响应内容已启用脱敏。

## 执行步骤

| 序号 | 操作 | 预期结果 | 实际结果 | 状态 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  | 待执行 |

## 验证命令

```bash
# 在这里记录不包含敏感值的命令。
```

## 结果

结论：通过 / 失败 / 阻塞

测试统计：

```text
通过：
失败：
跳过：
```

## 证据

- 日志：
- requestId：
- 截图：
- 测试报告：

## 缺陷与风险

| 编号 | 严重级别 | 描述 | 复现条件 | 后续任务 |
| --- | --- | --- | --- | --- |

## 清理确认

- [ ] 测试 token、refresh session 和 pairing code 已撤销或过期。
- [ ] 临时账号和设备已按策略保留或删除。
- [ ] 仓库内没有密码、token、私钥或未脱敏日志。
