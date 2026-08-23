# dsh-mcmod-agent

[English](README.md) | 中文

面向 Fabric 与 NeoForge Minecraft Java 模组开发 agent（智能体）的纯提示词指导。它贡献系统提示词段落，不拥有任何面向模型的工具、服务、会话状态、文件系统访问、shell 访问、LSP 提供方或权限策略。

本包预期由 [agent preset](../../preset/agent-presets/README.zh.md) 挂载。外围 preset 与 profile bundle 选择工具和提供方；本包教模型如何把这些能力用于 Minecraft Java 模组开发。

## 提示词段落

| 段落 | 用途 |
|---|---|
| `minecraft:identity` | 把工作锚定在项目根目录，并要求先识别 loader、Minecraft 版本、mappings、Gradle 插件、源码集与资源根。 |
| `minecraft:scope` | 在同一工作流支持 Fabric 与 NeoForge；先检测 loader，只有空白项目才临时默认 Fabric 1.21.x。 |
| `minecraft:workflow` | 要求编辑前读取 Gradle 文件、元数据、入口类、registry、事件、端隔离和 mixin，并指向聚焦验证及需批准的运行任务。 |
| `minecraft:resources` | 保持 registry name、namespace、版本适用的资源、数据文件、语言键和生成数据一致，并说明静态检查的边界。 |
| `minecraft:version-discipline` | 防止把 loader、版本或 mappings 冲突变成 API 猜测，优先使用项目事实、源码和 LSP 结果。 |

这些段落以 `40` 到 `44` 的顺序渲染，位于 persona 文本之后、工具指导之前。

## 配置

本包没有配置。Loader、JDTLS 命令、工具暴露、skill root、压缩阈值和权限选择都属于 profile bundle 或 agent preset。

## 模型体验

### Minecraft 模组开发指导

#### What the model sees

模型会看到下列固定提示词指导。

##### Minecraft prompt sections

```markdown
minecraft:identity — Identify loader, Minecraft version, mappings, Gradle plugin, source sets, and resource roots before acting.
minecraft:scope — Detect Fabric or NeoForge and report determined, unknown, conflicting, or unsupported loader/version/mappings evidence before choosing APIs; Forge, Quilt, Architectury, and other loaders are diagnostic-only in this profile, and only a genuinely blank project may use a provisional Fabric + Java + Minecraft 1.21.x default.
minecraft:workflow — Read Gradle files, loader metadata, entrypoint, registries, event wiring, side configuration, and mixin config before edits; verify with focused loader-appropriate Gradle tasks.
minecraft:resources — Keep Java registry names, namespaces, assets, data files, language keys, and generated data aligned.
minecraft:version-discipline — Do not mix Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs.
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

- **支持的 loader** —— 共享指导支持 Fabric 与 NeoForge Java 项目。Forge、Architectury、混合 loader、多模块、convention plugin 和非模组项目必须明确报告范围；不能根据局部扫描臆造支持。
- **空白项目默认值** —— Fabric + Java + Minecraft 1.21.x 只适用于没有 loader 决策的真正空白项目，不是稳定 API 承诺。
- **不检索文档** —— 本包不启用 web search，也不携带 Minecraft 文档索引。特定版本 API 事实必须来自项目、本地依赖、本地文档或用户明确提供的材料。
- **没有 Minecraft 专用工具** —— 文件、搜索、shell、LSP、skill、压缩、权限和持久化都复用 harness 既有能力，而不是包一层 Minecraft 专用工具。
