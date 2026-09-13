# Mobile 交互验收矩阵

版本：0.1  
更新时间：2026-08-29  
适用范围：`apps/mobile` UXI-10、UXI-11

本文记录自动化质量门与真机验收的分工。自动化门用于防止结构、语义和状态回退；真机项需要在 Android TalkBack、iOS VoiceOver 或 BlueStacks 环境执行并附截图/录屏。

## 1. 高频流程与无障碍焦点

| 流程 | 预期焦点顺序 | 自动化门 | 真机状态 |
| --- | --- | --- | --- |
| 登录 | Gateway origin → 账号 → 密码 → 登录 | 已覆盖：字段 label、登录 loading/disabled | 待 Android/iOS 执行 |
| 打开 Session | 设置 → 连接摘要 → 需要处理 → 最近 Session | 已覆盖：SessionRow button/selected、分组 header | Android UI 树已验证；TalkBack/iOS 待执行 |
| Conversation | 打开 Session 列表 → 设置 → 状态 → 时间线 → Composer 输入 → 发送/停止 | 已覆盖：IconButton、输入框、发送/停止语义 | Android UI 树与截图已验证；TalkBack/iOS 待执行 |
| 复制消息 | 消息正文 → 复制 → 已复制/复制失败播报 | 已覆盖：inline button、busy、polite live region | 待 Android/iOS 执行 |
| 审批 | 状态 → 工具摘要 → 安全说明 → 拒绝 → 允许一次 | 已覆盖：两个决策按钮和提交锁 | 待 Android/iOS 执行 |
| 返回/设置 | 抽屉关闭 → 系统返回 → 设置返回 | 已覆盖：Modal onRequestClose、返回 IconButton | 待 Android/iOS 执行 |

## 2. 尺寸与环境矩阵

| 场景 | 检查项 | 自动化证据 | 真机证据 |
| --- | --- | --- | --- |
| 320dp 窄屏 | 文案不截断关键状态；按钮保持 44dp；Banner action 不挤压内容 | `t4-10-quality.test.mjs`、`interaction-quality.test.mjs` | 待截图 |
| 390dp 常规屏 | 首页分组、抽屉、Composer 视觉层级稳定 | `screen-styles.ts` 约束 | 待截图 |
| 768dp 宽屏 | 内容保持可读最大宽度，不出现横向溢出 | 现有布局静态门 | 待截图 |
| 软键盘 | Composer 上移，输入与发送/停止仍可触达 | `KeyboardAvoidingView`、`useSafeAreaInsets` | 待录屏 |
| 安全区 | 底部 Composer/Approval 不被 Home Indicator 遮挡 | `paddingBottom` / `marginBottom` 断言 | 待截图 |
| 横竖屏 | 返回、抽屉关闭、滚动位置和操作锁不丢失 | 状态组件无尺寸依赖 | 待录屏 |
| 网络切换 | offline → reconnecting → recovered；不自动重放命令 | Viewer/Composer/Approval 单元测试 | 待录屏 |

## 3. 执行命令

```bash
pnpm --filter @harndock/mobile typecheck
pnpm --filter @harndock/mobile test
pnpm check:docs
git diff --check
```

当前自动化结果：typecheck 通过，Mobile 测试 129/129 通过，文档检查和 diff 校验通过；Android Debug APK 已构建并安装到 `emulator-5554`，Session 首页、Conversation 和抽屉的 UI 树已验证。模拟器当前启用的是 BlueStacks Accessibility 服务，不等同于 TalkBack；iOS VoiceOver 和真机项仍需单独执行。

## 4. 记录模板

执行人：待填写  
设备/系统：待填写  
构建版本：待填写  
屏幕宽度：320 / 390 / 768dp  
辅助功能：TalkBack / VoiceOver  
网络路径：在线 → 断网 → 恢复  
证据：截图或录屏路径待填写  
结论：通过 / 有条件通过 / 阻塞
