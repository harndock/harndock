# Harndock GitHub 仓库迁移任务计划

版本：1.0  
状态：执行中（M0-M3 完成，M4 进行中）  
更新时间：2026-09-13

## 1. 目标与边界

将当前 `dsh-gui` 工程迁移为独立的公开 `harndock` GitHub 仓库，并在首次公开前完成目录整理、依赖可复现、敏感文件清理和基础 CI 验收。

本计划的目标是交付一个可干净克隆、可安装依赖、可执行源码检查的公开源码仓库；不把正式桌面/移动端安装包发布作为本轮完成条件。

本轮不做：

- 不迁移 `dsh-gui` 的旧 Git 提交历史，采用干净初始历史。
- 不把 `tmp-plugins/dsh-at-file` 和 `tmp-plugins/dsh-univer-office` 发布到公开仓库；它们仅作为本地测试材料。
- 不提交 Android、macOS、Windows 的正式签名文件、证书或私钥。
- 不在没有凭据和发布策略的情况下启用正式 GitHub Release workflow。
- 不修改 `vendor/deepseek-harness` 上游源码；只维护固定 commit 的 Git submodule。

## 2. 已确认决策

| 事项 | 决策 |
|---|---|
| Git 历史 | 以当前工程快照创建新的初始提交，不保留旧历史 |
| 本地测试插件 | `tmp-plugins/*` 不进入公开仓库，保留在本地测试环境 |
| 正式签名 | Android/Desktop 签名材料尚未准备，本轮只做源码和 CI 基础设施 |
| 迁移基线 | `feat-update-1.0.0`，commit `4879966fdeace62175e5461150ec1a35c09cdf0c`，源工作区干净 |
| 目标仓库 | 公开的 `harndock/harndock`，先推送预览分支，再决定是否切换 `main` |

## 3. 当前基线与主要风险

### 3.1 Git 与目录边界

- 当前源工程包含一个嵌套的 `harndock` Git 仓库；迁移后它不能作为项目自身的子目录保留。
- `vendor/deepseek-harness` 是正式上游 submodule，应继续保留并修复公开克隆所需的配置。
- `tmp-plugins/*` 当前是 Gitlink，但它们属于本地测试材料，不应成为公开仓库的依赖边界。
- `.gitmodules` 目前没有为所有 Gitlink 提供完整映射，当前 `git submodule status` 已会失败。

### 3.2 可复现性

- `runtime/harness.lock.json` 锁定的 Harness commit 与当前 submodule Gitlink 不一致；迁移前必须以锁文件或经确认的新版本为唯一基准，并同步更新 Gitlink。
- Tauri 配置引用了本机生成的 macOS ARM Runtime 归档；该文件不能依赖开发者工作区，应在 CI/Release 阶段生成或作为受校验的构建输入提供。
- 当前 CI 主要执行 Ubuntu 源码检查和 Web 构建，尚未覆盖真正的桌面安装包发布。

### 3.3 公开仓库清理

- `apps/desktop/.env` 被历史和当前工作树跟踪，迁移快照只允许保留 `.env.example`。
- `apps/mobile/android/app/debug.keystore` 不能作为正式公开发布凭据，Release 配置需在发布阶段改为外部签名输入。
- 旧历史包含约 133 MiB 的 `vendor/codex.zip`，虽然不应进入新快照，也不能通过保留旧历史的方式带入新仓库。
- 文档中仍有 `dsh-gui` 本机路径；公开文档应改为仓库相对路径或明确的外部工程名称。

## 4. 迁移后的仓库边界

### 4.1 纳入公开仓库

- `apps/`
- `packages/`
- `runtime/` 中的契约、schema、锁文件和构建脚本
- `scripts/`
- `docs/` 中不含本机路径、秘密或内部环境信息的文档
- `.github/workflows/` 的源码检查 workflow
- `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、Rust/Tauri 配置
- `vendor/deepseek-harness` 的 submodule 声明和锁定 commit

### 4.2 排除公开仓库

- 嵌套 `harndock` 仓库本身
- `tmp-plugins/`
- `apps/desktop/.env`
- `apps/mobile/android/app/debug.keystore`
- `.codegraph/`、`node_modules/`、`dist/`、`target/`、运行时 staging/artifact
- 本机日志、`.DS_Store`、IDE 配置和用户目录
- `vendor/codex.zip` 及其历史对象

测试如果依赖本地插件，应改为测试 fixture、临时目录或独立测试仓库引用，不得通过隐式本机路径恢复。

## 5. 分阶段任务

### M0：冻结基线与备份

状态：已完成，P0（2026-09-13）

任务：

1. 记录源仓库当前分支、HEAD、工作区状态和两份未提交文档的 diff。
2. 确认 `feat-msyc-1.0.2` 为迁移基线。
3. 保留源仓库原目录和远端仓库现状，不在此阶段删除或覆盖任何目录。
4. 为目标 GitHub 仓库当前 `main` 创建可追溯的远端备份标记，具体覆盖操作另行确认。

验收：基线 commit、工作区 patch、远端现状均可恢复和复核。

### M1：清理 Git 边界与锁文件

状态：已完成，P0（2026-09-13）

任务：

1. 将 `vendor/deepseek-harness` 修正为唯一正式 submodule。
2. 处理 `runtime/harness.lock.json` 与实际 Harness commit 不一致的问题。
3. 从公开快照中移除 `harndock` Gitlink 和 `tmp-plugins/*` Gitlink。
4. 更新 `.gitignore`，覆盖 `.env`、签名材料、构建输出和本机 Runtime 产物。
5. 检查所有脚本是否还依赖 `tmp-plugins` 或嵌套仓库路径。

验收：

- `git submodule status` 正常。
- `pnpm check:harness-lock` 通过。
- 干净目录中执行 `git clone --recurse-submodules` 不出现 Gitlink 映射错误。

### M2：公开快照与文档治理

状态：已完成，P0（2026-09-13）

任务：

1. 按第 4 节纳入/排除规则组装迁移快照。
2. 清理公开文档中的本机绝对路径和不应公开的内部环境说明。
3. 增加 `LICENSE`，确认自有代码、Harness、插件和图片资产的许可证边界。
4. 增加 `SECURITY.md`、`CONTRIBUTING.md` 和基础 Issue/PR 模板。
5. 更新 README，说明安装前提、submodule 初始化、源码检查和当前发布边界。
6. 在 `docs/README.md` 增加本任务计划的索引入口。

验收：

- 敏感文件扫描无有效凭据、私钥或本机配置。
- 文档中的路径可在其他开发者机器上理解和执行。
- 许可证和第三方来源可追溯。

执行记录：已完成路径清理、README/安全与贡献指南、Issue/PR 模板、Dependabot 配置、
CI 源码检查，以及本机 Expo 状态和签名材料排除；自有代码许可证采用 MIT。

### M3：创建干净初始仓库

状态：已完成，P0（2026-09-14）

任务：

1. 在独立 staging 目录初始化新的 Git 仓库，不从源仓库复制 `.git`。
2. 将清理后的快照作为唯一初始提交。
3. 配置 `harndock/harndock` 远端，但先推送 `migration-preview` 分支。
4. 在预览分支上完成代码审阅，不直接覆盖远端 `main`。

验收：

- 新仓库只有干净初始历史。
- `git count-objects` 和大文件扫描不包含历史大文件。
- `git ls-files -s` 只有预期的 submodule Gitlink。

### M4：干净克隆与源码 CI

状态：进行中，P0（远端克隆受网络阻断）

任务：

1. 从 `migration-preview` 重新克隆到全新目录。
2. 初始化 Harness submodule 并执行 `pnpm install --frozen-lockfile`。
3. 执行源码检查、TypeScript/Rust 检查、协议测试、Runtime bridge 测试和 Web 构建。
4. 将 CI 明确分为“跨平台源码检查”和“需要 macOS/Runtime artifact 的构建验证”。
5. 不在没有签名凭据时伪造正式 Release job；发布 job 保持延期或显式条件禁用。

最低验收命令：

```sh
git clone --recurse-submodules https://github.com/harndock/harndock.git
pnpm install --frozen-lockfile
pnpm check
pnpm build:web
```

### M5：远端切换与迁移后联动

状态：未开始，P0/P1

任务：

1. 预览分支验收通过后，备份目标仓库当前 `main`。
2. 经明确确认后再切换默认分支或覆盖 `main`；该操作属于远端历史变更，不能自动执行。
3. 更新 `dsh-sync-server` 的本地 file dependency、Docker build context 和 lockfile。
4. 更新 `dsh-center-plugin`、网站和跨仓库文档中的工程路径。
5. 在所有关联工程完成一次干净 checkout 验证。

验收：所有关联工程不再依赖旧的 `dsh-gui` 本机目录名，或已明确保留兼容链接的过渡方案。

### M6：正式发布基础设施（后置）

状态：延期，等待凭据

任务：

- Android release keystore、alias 和密码改为 GitHub Secrets/Environment 管理。
- macOS Developer ID、notarization 和 Tauri 签名配置接入受保护 Environment。
- Windows 代码签名证书和密码接入受保护 Environment。
- 建立 Runtime artifact 生成、SHA-256 校验、Tauri 打包和 GitHub Release 上传流程。
- 增加发布前人工审批、产物清单、签名验证和回滚说明。

本阶段未完成前，仓库可以公开源码，但不宣称已具备可下载的正式安装包。

## 6. 验收门槛

| 门槛 | 通过条件 |
|---|---|
| Git 边界 | 无嵌套自身仓库；submodule 映射完整；本地测试插件不进入公开快照 |
| 安全清理 | 无 `.env`、私钥、正式签名材料、debug keystore 和大历史 blob |
| 可复现 | Harness commit、版本和锁文件一致；依赖可 frozen install |
| 源码检查 | `pnpm check` 通过，或每个失败项有明确的迁移前修复记录 |
| Web 构建 | `pnpm build:web` 在干净克隆通过 |
| 文档治理 | README、LICENSE、SECURITY、CONTRIBUTING 和路径说明完整 |
| 远端切换 | 预览分支先验收，`main` 覆盖前有备份和人工确认 |
| 正式发布 | 签名凭据、Runtime artifact 和 Release workflow 均通过独立验收；本轮不作为源码迁移阻断项 |

## 7. 关联工程改造

迁移会影响以下跨仓库边界：

| 工程 | 影响 | 处理方式 |
|---|---|---|
| `dsh-sync-server` | `@harndock/sync-protocol`、`@harndock/i18n-core` 当前使用相邻 `dsh-gui` 的 file dependency | 短期改为新目录；长期发布公开 npm 包并移除本机路径依赖 |
| `dsh-center-plugin` | 文档引用旧工程目录 | 改为仓库名、相对路径或公开 URL |
| `dsh-website` | 主要通过品牌和公开 Release 协作 | 检查下载链接、Release 命名和文档链接，不引入源码依赖 |
| Harness submodule | Gitlink 和锁定 commit | 保持上游仓库与产品仓库边界，不复制上游源码历史 |

## 8. 风险与回滚

| 风险 | 预防 | 回滚 |
|---|---|---|
| 错把嵌套仓库或本地插件发布 | 使用明确 allowlist，并在预览分支扫描 Gitlink | 丢弃 staging 仓库，不触碰源仓库 |
| 公开历史泄露大文件或本机配置 | 干净初始历史，不复用源 `.git`；执行敏感扫描 | 删除预览远端分支，重新生成快照 |
| submodule 与锁文件不一致 | M1 阶段强制 `check:harness-lock` | 恢复源 checkout，重新确定唯一 commit |
| 远端 `main` 覆盖错误 | 先推送预览分支并备份旧 `main` | 从备份 ref 恢复默认分支 |
| 迁移后关联工程无法安装 | M5 做跨仓库 clean checkout 验证 | 暂时保留兼容路径或回退 file dependency |
| 未准备凭据导致发布流程失败 | 发布能力单独延期，不把 secrets 写入代码 | 保持源码 CI，不执行 Release job |

## 9. 待确认与执行顺序

默认执行顺序为：`M0 → M1 → M2 → M3 → M4 → M5 → M6`。

开始实际迁移前需要再确认两点：

1. 当前工作区两份未提交文档修改是否作为迁移快照的一部分；默认按“纳入”处理。
2. `runtime/harness.lock.json` 是否继续作为权威版本来源；默认按“锁文件优先”处理，将 submodule 对齐到锁定 commit。

在 M4 通过前，不进行目标仓库 `main` 的覆盖；在 M6 凭据准备前，不创建会尝试签名或发布正式安装包的自动化任务。
