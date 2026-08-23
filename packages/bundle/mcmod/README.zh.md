# dsh-mcmod-bundle

[English](README.md) | 中文

面向随包 Minecraft 模组开发 Web agent 的 profile bundle。该 bundle 是一个 patch 列表载体：其 manifest 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，profile composer 在 `@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-web-app` 之后应用这个 patch。

## Patch 内容

该 patch 将默认 agent preset 选择为 `mcmod`，并插入该 preset 使用的 host-plane LSP 行：

| 行 | 包 | 用途 |
|---|---|---|
| `agent-presets` | 既有 Web 行 | 将组合默认值设为 `mcmod`。 |
| `lsp` | `@deepseek-ai/dsh-lsp` | 提供 `ctx.lsp` 注册表。 |
| `lsp-stdio` | `@deepseek-ai/dsh-lsp-stdio` | 为 `.java` 文件注册 Java 提供方，命令为 `jdtls`，language id 为 `java`。 |

Java 命令刻意使用普通的 `jdtls`。安装该 bundle 的 profile 可以在自己的 `cordis.patch.yml` 中覆盖完整 `lsp-stdio` 行，以适配位于机器专用路径或需要参数的 JDTLS。

## 模型体验

### Minecraft Mod profile 选择

#### What the model sees

间接可见：此 profile 中的新会话默认从随包 `mcmod` preset 组装。模型会看到该 preset 的 Fabric 与 NeoForge Minecraft 模组开发提示词段落、六个 scoped Minecraft skills，以及剩余工具 schema：文件系统 read/write/edit/search、`detect_mc_project`、`validate_mc_resources`、`run_mc_check`、一个只前台执行的平台 shell 工具、`lsp`、`skill` 和 `ask_user_question`。bundle 本身不贡献提示词文本、skill 正文或工具 schema。

#### Token effect

没有直接 token 成本。token 变化来自被选中的 preset、它的 skill catalog 以及该 preset 挂载的工具。

#### KV Cache effect

不直接贡献请求前缀。被选中的 preset 决定会话的提示词前缀。

## 已知限制与暂缓事项

- **Web profile 表层** —— 本 bundle 预期使用 `@deepseek-ai/dsh-web-app` 提供的 Web agent-preset roster；它不是 headless 任务表层。
- **JDTLS 由部署拥有** —— 默认命令名必须能在宿主 PATH 上解析。项目或机器专用的 JDTLS 启动细节应放在 profile 自己的 overlay 中。
- **不扩展可选工具** —— 该 patch 不启用 web search、workflow、Ralph、subagent、后台 job 控制、todo 或 goal 工具。
