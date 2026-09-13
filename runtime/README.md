# Runtime artifact contract v1

本目录定义 harndock Shell 与生产 Harness Runtime artifact 之间的稳定边界。`manifest.schema.json` 是机器契约，`manifest.example.json` 是当前 macOS arm64 构建应生成的基准形状；`sources.lock.json` 固定 Node 与 pnpm 的下载字节；`branding.json` 是产品名与当前技术底座的共享构建配置。它们不代表一个已经发布的 Runtime。

## Archive

每个平台输出一个 `harndock-runtime-<runtimeVersion>-<target>.tar.zst` 和相邻的 `.sha256` 文件。archive 必须只有一个 `harndock-runtime/` 根目录，内部路径使用 `/`，并保留 Node 可执行位和依赖中的相对符号链接。

构建器必须按路径排序，固定 uid/gid、mode 和 mtime，不写入本机绝对路径。安装器在解压前验证整个 archive 的 SHA-256，并拒绝绝对路径、`..`、反斜杠、重复路径、硬链接、设备、FIFO，以及指向根目录外部的符号链接。P4 的签名发布清单负责认证 archive 哈希；单独的 `.sha256` 只检测损坏，不能建立发布者信任。

```text
harndock-runtime/
├── runtime-manifest.json
├── manifest.schema.json
├── control-protocol.schema.json
├── sources.lock.json
├── bin/
│   └── node
├── tools/
│   └── pnpm/bin/pnpm.cjs
├── app/
│   └── node_modules/@deepseek-ai/dsh/lib/bin.js
├── plugins/
│   ├── desktop-bundle/
│   ├── client-desktop/
│   └── runtime-bridge/
└── licenses/
```

Runtime 必须内置 Node 和 pnpm。Node 启动构建后的 Harness `lib/bin.js`；pnpm 由同一个 Node 执行，用于首次准备 desktop profile 和后续 Harness 插件管理。用户设备不需要系统 Node、pnpm、tsx 或 Harness 源码。

## Build and reproducibility

在 macOS arm64 主机上，从仓库根目录执行：

```sh
pnpm build:runtime
```

构建器从 `vendor/deepseek-harness` 的 clean Git commit 导出源码，按 `@deepseek-ai/dsh` 的 workspace 依赖闭包选择 195 个 Harness 包，使用 `runtime/sources.lock.json` 中固定字节的 Node 22.22.3 和 pnpm 11.9.0，完成 Harness build 后通过 `pnpm deploy --prod` 生成独立 app。导出后会对桌面 WebView 的浏览器会话 Cookie 应用一个确定性的 `SameSite=Lax` 兼容补丁，使 token URL 的顶层 303 重定向可以在 WKWebView 中完成会话交换。目标平台过滤掉不适用的 OS/CPU 包；devDependencies、workspace 元数据和构建缓存不会进入 artifact。随后仅复制 `desktop-bundle`、`client-desktop`、`runtime-bridge` 三个产品包及契约、锁文件和许可证。

归档前的固定裁剪规则包括：删除 `app/node_modules/.modules.yaml` 和 `app/node_modules/.pnpm-workspace-state-v1.json`；对 Rolldown 生成的 CSS module string map 按属性名排序并重新生成逗号；拒绝绝对路径、越界符号链接和未支持的文件类型。staging 使用系统临时目录下固定名称 `harndock-runtime-build`，同时运行的构建会被拒绝。目录项按 POSIX 路径排序，归档写入器只写固定 uid/gid、owner、mode、mtime、path/linkpath 和文件内容，不写本机 atime/ctime。

可复现性验证（2026-08-17，Harness commit `47f943859bef60e4160492346772ded9b24f765a`）：相同输入连续构建两次，两个 `dsh-runtime-2026.08.17.4-darwin-aarch64.tar.zst` 均为 `64,692,879` 字节，SHA-256 均为 `1b1cf1e83ef1a82ce019e3744d66d19c3092c4dd95f982aba2aa6364e73e21ef`，并通过目录级和归档级 Runtime verifier。版本参数和输出目录可直接传给 builder，例如：

```sh
node scripts/build-harness-runtime.mjs \
  --runtime-version 2026.08.17.4 \
  --output /tmp/harndock-runtime
```

## Compatibility

Shell 依次检查：manifest schema、`target`、Shell 版本区间、`runtimeApi`、所有声明路径、Node/dsh 自检，再执行临时 `DSH_HOME` 启动探测。v1 Shell 只接受 `manifestVersion: 1`、`runtimeApi: 1`，并使用半开 Shell 版本区间 `[minVersion, maxVersionExclusive)`。未知 manifest 或 Runtime API 必须明确拒绝，不能尝试兼容启动。

Runtime 版本采用 `YYYY.MM.DD.N`。它标识一份可安装 artifact，不等于 Harness 或 Shell 版本。Harness commit、Node 和 pnpm 版本分别记录，便于复现和诊断。

## Control protocol

生产就绪信号不解析 `dsh web:` 人类日志。Shell 在应用数据目录的私有 `runtime/control/` 下创建随机 Unix socket，并通过环境变量向 `@harndock/runtime-bridge` 传递：

```text
HARNDOCK_CONTROL_ENDPOINT=unix:/absolute/path/to/<nonce>.sock
HARNDOCK_CONTROL_NONCE=<64 lowercase hex characters>
HARNDOCK_RUNTIME_VERSION=<runtimeVersion>
HARNDOCK_RUNTIME_API=1
HARNDOCK_HARNESS_COMMIT=<40 lowercase hex characters>
```

父目录权限必须为 `0700`。bridge 注入 `webServer` 和 `connection`，等待整个 Harness Loader 树成功 settlement，再连接 socket 并发送一条 UTF-8 NDJSON `ready` 帧，格式由 `control-protocol.schema.json` 定义。Shell 每次连接最多读取 8 KiB，验证 nonce、版本、profile、commit、干净的 `http://127.0.0.1:<port>/` URL 和同源一次性认证 URL；Runtime ready 后保持私有 listener，唯一额外动作是 metadata 相同且不带任意参数的 `showSettings` 帧。桌面 Runtime 使用认证 URL 在内嵌 WebView 中建立 Harness Web 会话，不再自动打开系统浏览器。

启动前的超时、EOF、多帧、schema 错误或 metadata 不匹配都属于启动失败。就绪后的无效控制帧只记录脱敏错误，不得中止健康 Runtime；listener 在 Runtime 停止时关闭并删除 socket。Harness 浏览器端不直接获得 nonce 或 Tauri IPC，只能通过 host bridge 注册的同源固定 POST 触发 `showSettings`。开发源码模式继续使用现有 stdout 探测；生产 artifact 不允许回退到人类日志。Windows named pipe 属于后续 manifest/protocol 版本，不在 v1 范围内。
