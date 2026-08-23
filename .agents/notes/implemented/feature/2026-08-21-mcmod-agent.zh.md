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
- 随包 `mcmod` preset 挂载提示词包，以及既有的文件、搜索、只前台执行的平台 shell、Minecraft 项目工具、`lsp`、skill、ask-user 和压缩行。它携带的 Minecraft skills（`fabric-mod-dev`、`fabric-datagen`、`minecraft-resources`、`mixin-debugging`、`neoforge-mod-dev` 和 `neoforge-datagen`）通过从 preset `baseUrl` 解析的 `customSkillDirs` 条目随 preset 一起移动。
- `@deepseek-ai/dsh-mcmod-headless-bundle` 是在 `dsh-base` 和 `dsh-headless` 之后应用的 profile patch 层。随包 `mcmod` profile 模板使用这三个 bundle，让既有一次性 headless runner 带着统一的 Fabric 与 NeoForge Minecraft 模组开发提示词段落、同一组六个随包 Minecraft skills、可选 Java LSP 与第一版代码开发工具集运行。

只有真正空白且没有 loader 决策的项目才会临时使用 Fabric + Java + Minecraft 1.21.x。提示词要求模型先从 Gradle、元数据、依赖坐标、主 mod 类与 mixin 配置检测 loader、版本和 mappings 事实；遇到未知或冲突证据必须停下检查，不能猜测 API，并避免混用 Fabric、Forge、NeoForge、Architectury 或跨版本 Minecraft API。preset 刻意省略 web search、workflow、Ralph、通用 subagent、后台 job 控制、todo 和 goal 工具。shell 工具也不暴露 `run_in_background`，因此模型不能启动缺少 `job_*` 收集或停止工具的后台 shell 工作。这些能力仍可供其他 preset 使用，也可由选择添加它们的用户自定义副本使用。

Java LSP 由部署拥有。两个 bundle 默认都使用 stdio 命令 `jdtls`，将 `.java` 映射到 language id `java`；当机器需要绝对 JDTLS 路径或参数时，profile overlay 可以替换完整的 `lsp-stdio` 行。

在预发布阶段，发布身份保持与上游兼容：包名继续使用 `@deepseek-ai/*`，并保留上游 repository 元数据。Craft_code 品牌和 npm scope 迁移留待后续发布决策；本次改动不进行全仓重命名。

## 曾考虑的替代方案

**Fork `agent-loop`。** 已拒绝，因为所需行为是提示词与组合策略，而不是 loop 语义。既有插件架构已经提供所需扩展点；loop fork 则需要自行集成工具、提示词、会话和压缩。

**没有空白项目默认目标的不区分 loader Minecraft preset。** v1 中已拒绝，因为真正空白 workspace 需要一个具体原型。Fabric + Java + Minecraft 1.21.x 只在该条件下临时使用；已有或冲突的 loader 事实会覆盖猜测并要求继续检查。

**默认启用 web search。** v1 中已拒绝，因为 Minecraft loader API 事实强依赖版本。首版 preset 优先使用本地项目事实、依赖、源码和用户明确提供的文档，而不是通用 web 结果。

**单个全用途 Minecraft skill。** 已拒绝，因为它会把代码、资源、datagen 和 mixin 指导一起加载给只需要其中一块的任务。拆分后的 skills 让 catalog 保持可发现，同时只在任务匹配对应工作流时加载详细指令。

**添加宽泛的 Minecraft 专用工具。** v1 中已拒绝，因为首个领域包只应替代容易猜错的项目事实提取与验证路由。已接受的 `@deepseek-ai/dsh-tool-mc-project` 工具只覆盖检测、静态资源校验和前台 shell 支撑的检查；若后续功能需要更宽的结构化 Minecraft 操作，可以再添加。

## 后果

随包 preset 与 headless profile 都是窄领域 agent，仍停留在普通 harness 组合模型内。模型可见行为完全可由既有提示词段落、skill catalog、skill 加载和工具 schema 重建，因此不需要新的会话事件。Web profile 表层可以通过它的 bundle 选择该 preset；`dsh --profile mcmod "task"` 使用 headless bundle 栈。

该实现依赖 profile 启用 bundle 时宿主存在 Java language server。缺失或配置错误的 JDTLS 只影响 LSP 查询；文件、搜索、前台 shell、Minecraft 项目工具、skill、ask-user、权限、压缩和会话持久化仍来自它们既有的包。没有后台 job 控制时，长时间 Gradle 工作必须通过有界前台调用完成，或由显式 profile overlay 同时恢复 jobs 与 shell 后台支持。
