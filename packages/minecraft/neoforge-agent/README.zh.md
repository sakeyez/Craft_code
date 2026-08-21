# dsh-minecraft-neoforge-agent

[English](README.md) | 中文

面向 Minecraft NeoForge 模组开发 agent（智能体）的纯提示词指导。它贡献 NeoForge 专用系统提示词段落，不拥有任何面向模型的工具、服务、会话状态、文件系统访问、shell 访问、LSP 提供方或权限策略。

本包预期由 [agent preset](../../preset/agent-presets/README.zh.md) 挂载。外围 preset 与 profile bundle 选择工具和提供方；本包只教模型如何把这些能力用于 NeoForge Java 模组开发。

## 提示词段落

| 段落 | 用途 |
|---|---|
| `minecraft:identity` | 将 agent 标识为 NeoForge 模组开发 agent，并把工作锚定在项目根目录。 |
| `minecraft:scope` | 将 v1 限定为 NeoForge Java 模组，并列出用于 loader 检测的项目文件。 |
| `minecraft:workflow` | 指导模型在编辑前发现 Gradle、Java toolchain、版本、源码、LSP 与验证任务。 |
| `minecraft:resources` | 保持 registry name、namespace、资源、数据文件、语言键和生成数据一致。 |
| `minecraft:version-discipline` | 防止混用不同版本 API 的猜测，优先使用本地项目事实、源码和 LSP 结果。 |

这些段落以 `40` 到 `44` 的顺序渲染，位于 persona 文本之后、工具指导之前。

## 配置

本包没有配置。Loader、JDTLS 命令、工具暴露、skill root、压缩阈值和权限选择都属于 profile bundle 或 agent preset。

## 模型体验

### NeoForge 指导

#### What the model sees

模型会看到下列固定提示词指导。

##### NeoForge prompt sections

```markdown
minecraft:identity — Treat the working directory as the NeoForge mod project root and follow local Gradle, Java, resource, and data-generation conventions.
minecraft:scope — Detect NeoForge from Gradle and mod metadata; report non-NeoForge projects as outside the preset's v1 scope unless the user asks for migration or analysis.
minecraft:workflow — Use file reads, search, and LSP facts before editing; verify with project Gradle tasks and explain risk before expensive runs.
minecraft:resources — Keep Java registry names, namespaces, assets, data files, language keys, and generated data aligned.
minecraft:version-discipline — Derive API usage from pinned project versions, local source, dependency sources, and LSP results instead of cross-version memory.
```

##### Tool schema

```markdown
This package contributes no tool schema.
```

#### Token effect

对挂载本行的 preset 中的每次 agent 请求都是固定成本。token 成本仅来自这五个提示词段落；工具 schema 和 runtime context 由各自包拥有。

#### KV Cache effect

在已挂载 preset 的生命周期内保持前缀稳定。包含或省略本包的不同 preset，会从第一个 Minecraft 段落开始建立不同的系统提示词前缀。

## 已知限制与暂缓事项

- **v1 仅限 NeoForge** —— Fabric、Forge、Architectury、混合 loader 项目和非模组项目都不在支持的实现范围内，除非用户明确要求分析或迁移。
- **不检索文档** —— 本包不启用 web search，也不携带 NeoForge 文档索引。特定版本 API 事实必须来自项目、本地依赖、本地文档或用户明确提供的材料。
- **没有 Minecraft 专用工具** —— 文件、搜索、shell、LSP、skill、压缩、权限和持久化都复用 harness 既有能力，而不是包一层 Minecraft 专用工具。
