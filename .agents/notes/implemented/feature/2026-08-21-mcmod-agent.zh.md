# Agent Note: Minecraft 模组开发 agent preset

Status: implemented

[English](2026-08-21-mcmod-agent.md) | 中文

## 问题

Minecraft 模组开发需要领域专用行为，但既有 harness 已经以插件形式拥有通用 agent loop、文件工具、shell 工具、LSP 能力、skill 加载、压缩、权限和会话持久化。为了一个模组开发领域 fork `agent-loop`，会重复这些扩展点，并制造第二处可能与模型可见工具和提示词组装漂移的实现。

该领域强依赖 loader。Fabric、Forge、NeoForge 和 Architectury 使用不同的 Gradle 插件、元数据文件、mapping、registry API 和生成数据约定。第一版提示词如果把所有 loader 当作可互换对象，会诱导模型混用不同生态和 Minecraft 版本的 API。

## 决策

Minecraft 支持以 Web preset 组合与 headless profile 组合发布：

- `@deepseek-ai/dsh-mcmod-agent` 只贡献五个提示词段落：`minecraft:identity`、`minecraft:scope`、`minecraft:workflow`、`minecraft:resources` 和 `minecraft:version-discipline`。
- `@deepseek-ai/dsh-mcmod-bundle` 是 profile patch 层，选择 `mcmod` 作为默认 preset，并插入 host-plane `ctx.lsp` 和 stdio Java 提供方行。
- 随包 `mcmod` preset 挂载提示词包，以及既有的文件、搜索、平台 shell、jobs、`lsp`、skill、ask-user 和压缩行。它携带的 `minecraft-modding` skill 通过从 preset `baseUrl` 解析的 `customSkillDirs` 条目随 preset 一起移动。
- `@deepseek-ai/dsh-mcmod-headless-bundle` 是在 `dsh-base` 和 `dsh-headless` 之后应用的 profile patch 层。随包 `mcmod` profile 模板使用这三个 bundle，让既有一次性 headless runner 带着 Fabric-first Minecraft 模组开发提示词段落、随包 `minecraft-modding` skill、Java LSP 与第一版代码开发工具集运行。

当项目尚未决定 loader 或版本时，v1 默认使用 Fabric + Java + Minecraft 1.21.x。提示词要求模型先从 Gradle、元数据、依赖坐标、主 mod 类与 mixin 配置检测已有 loader 事实，再选择 API，并避免混用 Fabric、Forge、NeoForge、Architectury 或跨版本 Minecraft API。preset 刻意省略 web search、workflow、Ralph、通用 subagent、todo 和 goal 工具。这些能力仍可供其他 preset 使用，也可由选择添加它们的用户自定义副本使用。

Java LSP 由部署拥有。两个 bundle 默认都使用 stdio 命令 `jdtls`，将 `.java` 映射到 language id `java`；当机器需要绝对 JDTLS 路径或参数时，profile overlay 可以替换完整的 `lsp-stdio` 行。

## 曾考虑的替代方案

**Fork `agent-loop`。** 已拒绝，因为所需行为是提示词与组合策略，而不是 loop 语义。既有插件架构已经提供所需扩展点；loop fork 则需要自行集成工具、提示词、会话和压缩。

**没有默认目标的不区分 loader Minecraft preset。** v1 中已拒绝，因为空白或未决项目需要一个具体原型。Fabric + Java + Minecraft 1.21.x 是默认目标；已有 loader 事实仍覆盖猜测。

**默认启用 web search。** v1 中已拒绝，因为 Minecraft loader API 事实强依赖版本。首版 preset 优先使用本地项目事实、依赖、源码和用户明确提供的文档，而不是通用 web 结果。

**添加 Minecraft 专用工具。** v1 中已拒绝，因为既有文件／搜索／shell／LSP／skill 工具覆盖首个工作流。若后续功能需要模型可见的持久状态或结构化 Minecraft 操作，可以再添加新工具。

## 后果

随包 preset 与 headless profile 都是窄领域 agent，仍停留在普通 harness 组合模型内。模型可见行为完全可由既有提示词段落和工具 schema 重建，因此不需要新的会话事件。Web profile 表层可以通过它的 bundle 选择该 preset；`dsh --profile mcmod "task"` 使用 headless bundle 栈。

该实现依赖 profile 启用 bundle 时宿主存在 Java language server。缺失或配置错误的 JDTLS 只影响 LSP 查询；文件、搜索、shell、skill、jobs、ask-user、权限、压缩和会话持久化仍来自它们既有的包。
