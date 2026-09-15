# 端到端测试证据目录

本目录只保存可提交的脱敏测试证据和索引。运行日志、截图、HTTP 响应和诊断输出必须先脱敏，再决定是否进入 Git。

## 目录与命名

单次执行使用以下结构：

```text
test-evidence/
└── YYYYMMDD-HHMM-任务ID-简短名称/
    ├── record.md
    ├── commands.txt
    ├── result.txt
    └── screenshots/
```

示例：`20260821-1130-T7-03-auth-lifecycle/`。

## 可以保存

- 软件版本、commit、容器镜像 digest 和测试命令。
- HTTP 状态码、公开错误码、脱敏后的 requestId。
- 脱敏账号、Device、Runtime、Session 和 command ID。
- 不包含个人信息、token 或业务正文的截图。
- 测试通过/失败统计、延迟和资源指标。

## 禁止保存

- 密码、refresh token、原始 access token 和 Authorization header。
- pairing code、PC 私钥、Keychain 内容和完整公钥材料。
- 完整 prompt、工具参数/结果、工作区绝对路径和环境变量转储。
- 邮箱、真实姓名、个人账号标识和未经脱敏的数据库导出。
- Docker `.env`、Android keystore 或其他部署密钥。

敏感原始证据应保存在仓库外的临时目录，验证完成后按项目数据策略清理。Git 内只保留脱敏结果和可复现步骤。

## ID 脱敏

保留类型前缀和末尾四位，例如：

```text
acct_…12ab
dev_…34cd
runtime_…56ef
req_…7890
```

token 只允许记录服务端提供的 `tokenHint`；如果没有 hint，则记录“已签发/已撤销”，不自行截取原始 token。
