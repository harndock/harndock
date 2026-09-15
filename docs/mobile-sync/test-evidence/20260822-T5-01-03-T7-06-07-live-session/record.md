# T5-01 至 T5-03 与 T7-06/T7-07 实时 Session 测试记录

## 环境

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-08-22 Asia/Shanghai |
| Mobile | BlueStacks Air，`127.0.0.1:5555`，Development Build |
| Gateway | `http://127.0.0.1:8081`，Docker Compose |
| Desktop | DeepSeek Harness Desktop，Runtime `runtime_0bcbfe82…` |
| Session | `session-1f8c05d8-5f2f-4906-9db2-ffefffa67d6d` |

## 结果

| 任务 | 验证 | 结果 |
| --- | --- | --- |
| T5-01/T7-06 | Runtime 运行中创建 Session；Gateway 收到快照和 seq 0、1、2；outbox ACK 后 cursor 为 2 | 通过 |
| T5-02/T7-06 | Gateway REST history 从 `afterSeq=-1` 返回零基事件；Connector 重启后按持久 cursor 补发 | 基础链路通过；BlueStacks 断线恢复 UI 需补测 |
| T5-03/T7-07 | `session.prompt` queued → completed；真实 Harness 产生后续事件；`session.cancel` queued → completed，Session 终态 completed | 通过 |
| T5-04/T7-07 | 并发串行与 approval first-wins | 未执行 |
| T5-06 | 失效 token 可识别；新增自动返回 Pairing 逻辑 | 代码已补，实机回归待执行 |

## 关键观测

- 新 Session 的空快照使用 `lastSeq=-1`，首个事件从 `seq=0` 开始；Gateway 数据库迁移 `008_zero_based_session_cursor.sql` 已执行。
- 真实 prompt 使用 `/help` 产生了大量 Harness 事件并触发 Gateway Node OOM；随后 Gateway 重启、Session cancel 成功。后续测试应使用短输出命令或提高受控测试边界，避免长流事件压垮 Gateway。
- 正式 Runtime 的插件文件已在测试后恢复；当前 Desktop Runtime 在线，outbox 无待发帧。
- 一次 Metro `8082` 与 Gateway `8081` 的 ADB reverse 切换导致移动端 hydrate 读到空响应；映射恢复后页面仍保留错误提示，说明 `ViewerSync` 需要可重试 hydrate。

## 未完成项

- T5-04/T7-07 approval first-wins 尚未通过真实 Harness 审批事件验证。
- T5-05/T7-08 设备撤销、旧设备失效和重新配对尚未在本轮执行。
- T5-06/T7-06 的 BlueStacks 断线后 UI 自动恢复和重连后的目录刷新需要单独回归。
