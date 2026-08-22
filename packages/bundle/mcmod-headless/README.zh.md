# dsh-mcmod-headless-bundle

[English](README.md) | 中文

随包 Minecraft 模组开发 agent 的 headless profile 组合包。它设计为叠在 [`dsh-base`](../base/README.zh.md) 与 [`dsh-headless`](../headless/README.zh.md) 之后，因此 `dsh --profile mcmod "task"` 会用既有的一次性 headless runner 运行，并带上 Fabric-first Minecraft 提示词、Java LSP 与收窄后的工具集。

该包是 patch-list carrier。它的 manifest 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；profile composer 通过该 manifest 解析这份 patch，并把它应用在该 profile 更早的 bundle 层之上。

## Patch 内容

这份 patch 保留 `dsh-headless` 的 `headless-runner`，以及 base 中负责文件系统访问、平台 shell 执行、skill 加载、压缩、权限、凭据、模型路由和 session persistence 的服务。它新增：

| 行 | 包 | 作用 |
|---|---|---|
| `mcmod-agent` | `@deepseek-ai/dsh-mcmod-agent` | 在全局 headless agent scope 上注册 Minecraft 模组开发提示词段落。 |
| `tool-mc-project` | `@deepseek-ai/dsh-tool-mc-project` | 向模型暴露 Minecraft 项目检测、静态资源校验与基于 shell 的检查编排工具。 |
| `lsp` | `@deepseek-ai/dsh-lsp` | 提供 `ctx.lsp` 注册表。 |
| `lsp-stdio` | `@deepseek-ai/dsh-lsp-stdio` | 为 `.java` 文件注册 Java provider，命令为 `jdtls`，language id 为 `java`。 |
| `tool-lsp` | `@deepseek-ai/dsh-tool-lsp` | 向模型暴露只读 `lsp` 工具。 |
| `skill-filesystem` | 既有 base 行 | 添加随包 Minecraft skill 目录，同时保留普通项目与用户 skill 根。 |

Java 命令刻意保持为普通的 `jdtls`。如果 JDTLS 位于机器特定路径或需要参数，profile 可以在自己的 `cordis.patch.yml` 中替换完整的 `lsp-stdio` 行。

这份 patch 禁用 web retrieval、workflow orchestration、Ralph、通用 subagent、jobs、goals、todos、plan mode 与旧的 str-replace editor 行。这些行继承自 `dsh-base`；其他 profile 以及用户自定义副本仍可选择重新启用。第一版只保留 file/search 工具、Minecraft 项目检测工具、平台 shell 工具、`lsp`、`skill`、压缩、权限与 session persistence。

## 模型体验

### Headless Minecraft Mod agent

#### 模型会看到什么

模型会看到 headless persona、`@deepseek-ai/dsh-mcmod-agent` 提供的五个 Fabric-first Minecraft 模组开发提示词段落、skill catalog 中的四个随包 Minecraft skills（`fabric-mod-dev`、`minecraft-resources`、`minecraft-datagen` 和 `mixin-debugging`），以及剩余的模型可见工具 schema：文件系统 read/write/edit/search、`detect_mc_project`、`validate_mc_resources`、`run_mc_check`、一个平台 shell 工具、`lsp` 与 `skill`。

#### Token 影响

请求前缀会增加 Minecraft 模组开发提示词段落、LSP 工具指引与 skill catalog 概述。只有当模型针对某个 skill 调用 skill 工具时，该随包 skill 的正文才会加载。

#### KV Cache 影响

对同一份已安装 patch 与 skill catalog，该 profile 拥有稳定前缀。修改 bundle patch、Minecraft 模组开发提示词包或随包 skill catalog，会改变该 profile 后续请求的前缀。

## 已知限制与暂缓事项

- **仅限 headless** — 该 bundle 不挂载 Web Host 行，也不挂载 Web agent-preset roster。Web profile 层使用 [`mcmod/`](../mcmod/README.zh.md)。
- **JDTLS 由部署拥有** — 默认命令名必须能在宿主 PATH 中解析。项目或机器特定的 JDTLS 启动细节属于 profile 自己的 overlay。
- **v1 不提供后台 jobs** — 长时间运行的 Gradle 命令通过普通 shell 工具执行，因此调用方应优先选择有界检查；需要后台进程控制时，可在 profile overlay 中重新启用 jobs。
