# Gateway Web 与 Mobile 国际化发布清单

版本：1.0  
适用范围：`harndock` 与 `dsh-sync-server/apps/gateway-console`
状态：首发前清单

## 词典与代码

- [ ] [术语表](i18n-glossary.md) 已由产品和英文审核人确认。
- [ ] Mobile 与 Gateway 的 `zh` / `en` key parity 检查通过。
- [ ] `pnpm check:i18n` 通过；没有新增 UI 中文裸字符串。
- [ ] 未把用户数据、Scope、设备名、Session 名、Runtime profile、ID 或模型输出送入翻译日志。
- [ ] 未把服务端原始错误 message 直接作为固定 UI 文案。

## 自动化验证

- [ ] Mobile typecheck 通过。
- [ ] Mobile 测试全量通过，并记录测试数量。
- [ ] i18n-core 测试全量通过。
- [ ] Gateway Console typecheck、Vitest 和 production build 通过，并记录测试数量。
- [ ] `node scripts/verify-docs.mjs` 与 `git diff --check` 通过。

## 双语功能验收

- [ ] 新安装中文系统默认显示中文，英文系统默认显示英文。
- [ ] 手动切换语言后 Web 刷新、Mobile 重启仍保持选择。
- [ ] 切换语言不改变路由、Session、游标、命令或审批状态。
- [ ] Gateway `html lang`、Mobile accessibility label/hint/placeholder 随语言变化。
- [ ] 日期、时间、数量和 seq 使用当前 locale 的 Intl 格式。
- [ ] Gateway 登录、导航、页面、状态、错误、权限提示、创建/撤销弹窗均完成 zh/en smoke。
- [ ] Mobile 登录、Session 首页、Conversation、审批、Settings、Session 抽屉均完成 zh/en smoke。

## 设备与视觉证据

- [ ] Gateway 桌面和窄屏（<620px）无截断、横向溢出或按钮遮挡。
- [ ] Mobile 320/375/390/768 宽度英文文案无溢出。
- [ ] Mobile Android Emulator/真机键盘、安全区和返回行为通过。
- [ ] 屏幕阅读器可聚焦主要按钮、输入框、状态和可展开活动行。
- [ ] 中文/英文各保存一张首页、一张 Conversation、一张 Settings 截图及视口信息。

## 发布与回滚

- [ ] 候选 commit、测试结果、截图、审校人和发布日期已记录。
- [ ] 发布前确认旧版 locale key 可回退；缺失 key 只在开发环境告警，生产不显示空白。
- [ ] 发现严重翻译或布局问题时，回滚到上一稳定 commit，不在生产静态文件上手工热修。
- [ ] 回滚后重新运行 `check:i18n`、Gateway smoke 和 Mobile 关键路径。
- [ ] 遗留问题、未执行的设备矩阵和下一步责任人已写入发布记录。
