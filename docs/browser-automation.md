# 浏览器自动化与图片识别

## 当前支持范围

桌面 profile 已预置一个名为 `mcp-playwright` 的 MCP 客户端条目，但默认禁用。这样启动 harndock 不会自动下载或启动外部浏览器服务。

启用后，DeepSeek Harness 通过 `@deepseek-ai/dsh-mcp-client` 连接 Microsoft Playwright MCP，模型可以使用浏览器工具完成导航、点击、输入、读取页面结构和截图等操作。

图片识别使用 Harness 已有的附件链路：

- `@deepseek-ai/dsh-attachment-local` 保存图片；
- `@deepseek-ai/dsh-tool-fs` 提供 `read_image`；
- `@deepseek-ai/dsh-client-ui-attachment` 提供上传、预览和灯箱；
- 当前 LLM 路由必须声明支持 `image` 输入。

## 开发环境安装

先确认 Node.js 22 和 pnpm 已按项目 README 安装。MCP 包会在首次启动时由 `npx` 下载；先安装 Chromium 浏览器运行时：

```sh
pnpm dlx playwright install chromium
```

也可以提前验证 MCP 包可以被解析：

```sh
pnpm dlx @playwright/mcp@latest --help
```

`dsh-mcp-client` 已随 Harness CLI 依赖闭包提供，不需要修改 `vendor/deepseek-harness` 子模块。

## 启用 Playwright MCP

编辑当前 Harness home 下的文件：

```text
$DSH_HOME/profiles/desktop/cordis.patch.yml
```

加入下面的 patch。patch 按 id 替换整行配置，因此启用时需要把完整 `config` 一起写出：

```yaml
- id: mcp-playwright
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: false
  config:
    transport: stdio
    serverName: playwright
    command: npx
    args: ['-y', '@playwright/mcp@latest']
    env: {}
    cwd: ''
    toolCallTimeoutMs: 120000
    failOnStartupError: true
```

然后启动桌面应用，或直接验证 profile 配置：

```sh
dsh --profile desktop --dump-config
```

输出中应出现 `mcp-playwright` 和 `@deepseek-ai/dsh-mcp-client`。连接成功后，工具名称会带有 `mcp__playwright__` 前缀。

## 生产环境建议

不要在正式发布配置中使用 `@playwright/mcp@latest`。应在 Runtime 构建阶段固定 Playwright MCP 版本，并把浏览器运行时作为安装包的一部分，避免用户机器联网下载。浏览器自动化还应配合审批策略：导航和只读操作可以自动执行，提交表单、发送消息、购买、删除和下载敏感文件等动作应要求用户确认。

当前 Harness MCP bridge 对 MCP 返回的图片、音频和资源内容只做占位文本投影。要实现“截图交给视觉模型，再根据像素位置操作”的完整链路，还需要把截图转换为 Harness `ImageBlock`，这属于后续原生 Browser Host plugin 工作，不是本次 MCP 接入的一部分。
