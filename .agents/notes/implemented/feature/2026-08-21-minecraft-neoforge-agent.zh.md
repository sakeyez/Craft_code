# Agent Note: Minecraft NeoForge agent preset

Status: implemented

[English](2026-08-21-minecraft-neoforge-agent.md) | 中文

## 问题

Minecraft 模组开发需要领域专用行为，但既有 harness 已经以插件形式拥有通用 agent loop、文件工具、shell 工具、LSP 能力、skill 加载、压缩、权限和会话持久化。为了一个模组开发领域 fork `agent-loop`，会重复这些扩展点，并制造第二处可能与模型可见工具和提示词组装漂移的实现。

该领域也强依赖 loader。NeoForge、Fabric、Forge 和 Architectury 使用不同的 Gradle 插件、元数据文件、mapping、registry API 和生成数据约定。一个覆盖全部 loader 的第一版提示词，会诱导模型混用不同生态和 Minecraft 版本的 API。

## 决策

Minecraft 支持以 Web profile 和 agent-preset 组合发布：

- `@deepseek-ai/dsh-minecraft-neoforge-agent` 只贡献五个提示词段落：`minecraft:identity`、`minecraft:scope`、`minecraft:workflow`、`minecraft:resources` 和 `minecraft:version-discipline`。
- `@deepseek-ai/dsh-minecraft-neoforge-bundle` 是 profile patch 层，选择 `minecraft-neoforge` 作为默认 preset，并插入 host-plane `ctx.lsp` 和 stdio Java 提供方行。
- 随包 `minecraft-neoforge` preset 挂载提示词包，以及既有的文件、搜索、平台 shell、jobs、`lsp`、skill、ask-user 和压缩行。它携带的 `neoforge-modding` skill 通过从 preset `baseUrl` 解析的 `customSkillDirs` 条目随 preset 一起移动。

v1 范围是 NeoForge Java 模组。提示词要求模型从 Gradle 和模组元数据检测 NeoForge，将非 NeoForge 项目报告为不在 v1 实现范围内，并避免混用不同版本 API 的猜测。preset 刻意省略 web search、workflow、Ralph、通用 subagent、todo 和 goal 工具。这些能力仍可供其他 preset 使用，也可由选择添加它们的用户自定义副本使用。

Java LSP 由部署拥有。bundle 默认 stdio 命令为 `jdtls`，将 `.java` 映射到 language id `java`；当机器需要绝对 JDTLS 路径或参数时，profile overlay 可以替换完整的 `lsp-stdio` 行。

## 曾考虑的替代方案

**Fork `agent-loop`。** 已拒绝，因为所需行为是提示词与组合策略，而不是 loop 语义。既有插件架构已经提供所需扩展点；loop fork 则需要自行集成工具、提示词、会话和压缩。

**一个不区分 loader 的 Minecraft preset。** v1 中已拒绝，因为 loader API 和元数据差异足够大，宽泛指导不如单一 NeoForge 目标可靠。

**默认启用 web search。** v1 中已拒绝，因为 Minecraft 与 NeoForge API 事实强依赖版本。首版 preset 优先使用本地项目事实、依赖、源码和用户明确提供的文档，而不是通用 web 结果。

**添加 Minecraft 专用工具。** v1 中已拒绝，因为既有文件／搜索／shell／LSP／skill 工具覆盖首个工作流。若后续功能需要模型可见的持久状态或结构化 Minecraft 操作，可以再添加新工具。

## 后果

随包 preset 是一个窄领域 agent，仍停留在普通 harness 组合模型内。模型可见行为完全可由既有提示词段落和工具 schema 重建，因此不需要新的会话事件。Web profile 表层可以通过 bundle 选择该 preset；headless 仍是单独的组合决策。

该实现依赖 profile 启用 bundle 时宿主存在 Java language server。缺失或配置错误的 JDTLS 只影响 LSP 查询；文件、搜索、shell、skill、jobs、ask-user、权限、压缩和会话持久化仍来自它们既有的包。
