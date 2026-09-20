# dsh-mcmod-agent

[English](README.md) | 中文

面向 Fabric 与 NeoForge Minecraft Java 模组开发 agent（智能体）的纯提示词指导。它贡献系统提示词段落，不拥有任何面向模型的工具、服务、会话状态、文件系统访问、shell 访问、LSP 提供方或权限策略。

本包预期由 [agent preset](../../preset/agent-presets/README.zh.md) 挂载。外围 preset 与 profile bundle 选择工具和提供方；本包教模型如何把这些能力用于 Minecraft Java 模组开发。


挂载的 Minecraft 工作台通过 `query_mc_api` 提供精确 classpath 证据，并在修改工具前自动创建项目恢复点。`run_mc_check` 接受 `testMode: development | artifact`（默认 development）；成品运行检查要求挂载工作台，保留 shell 策略与运行批准，不自动接受服务端 EULA。参见[工作台契约](../mc-workbench/README.zh.md)。

## 提示词段落

| 段落 | 用途 |
|---|---|
| `minecraft:identity` | 按当前请求选择工作范围，并将项目任务锚定在项目根目录。 |
| `minecraft:scope` | 在同一工作流支持 Fabric 与 NeoForge；新项目由宿主本地“新模组”向导初始化，模型对已有项目先检测 loader 再选择 API 或 datagen。 |
| `minecraft:workflow` | 按任务选择证据、技能、修改和验证；复用有效事实，游戏启动仍需授权。 |
| `minecraft:resources` | 保持 registry name、namespace、版本适用的资源、数据文件、语言键和生成数据一致，并说明静态检查的边界。 |
| `minecraft:version-discipline` | 防止把 loader、版本或 mappings 冲突变成 API 猜测，优先使用项目事实、源码和 LSP 结果。 |

这些段落以 `40` 到 `44` 的顺序渲染，位于 persona 文本之后、工具指导之前。

## 按需工作流

Minecraft 预设使用本包的规则替代通用编码流程。普通知识可以直接回答；视觉问题先看附图和选区，图片缺失时明确说明，不遍历临时目录、会话日志或游戏存档寻找图片。代码解释和诊断按相关证据调查。修改需要适用技能及聚焦验证；明确要求完整开发或审计时，仍完成全部验收步骤。

已确认的项目事实可复用，直到项目、相关配置或证据变化。追问不会重启已完成的开发，历史流程只适用于匹配的任务。必要的 loader/version 研究、资源验证、高风险检查和游戏启动授权仍保留。普通启动独立执行项目运行任务，不附加 test/build/datagen 门禁，也不依赖 IDEA。客户端停留标题画面不算启动失败，也不能证明玩法通过。这是模型指导，不是运行时工具限制，也不能保证模型总会遵从。

## 配置

本包没有配置。Loader、JDTLS 命令、工具暴露、skill root、压缩阈值和权限选择都属于 profile bundle 或 agent preset。

## 模型体验

### Minecraft 模组开发指导

#### What the model sees

模型会看到下列固定提示词指导。

##### Minecraft prompt sections

```markdown
minecraft:identity — Match work to the current request and unfinished objective; general and visual questions do not require a development workflow.
minecraft:scope — New projects are initialized only by the host-local New Mod wizard; after its successful first build, detect Fabric or NeoForge and report determined, unknown, conflicting, or unsupported loader/version/mappings evidence before choosing APIs. Forge, Quilt, Architectury, and other loaders are diagnostic-only in this profile.
minecraft:workflow — Choose only the steps needed for the current request; inspect images first for visual questions, investigate relevant code for diagnosis, and verify changes with focused checks.
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
- **新项目归属** —— 宿主本地“新模组”向导负责版本解析、项目生成、创建 Gradle Wrapper 与首次构建；模型只修改向导成功后的项目，不初始化空目录。
- **不检索文档** —— 本包不启用 web search，也不携带 Minecraft 文档索引。特定版本 API 事实必须来自项目、本地依赖、本地文档或用户明确提供的材料。
- **没有 Minecraft 专用工具** —— 文件、搜索、shell、LSP、skill、压缩、权限和持久化都复用 harness 既有能力，而不是包一层 Minecraft 专用工具。

工作台片段保留草稿、文件／行号、依赖角色和源码映射来源。修改草稿前先读取磁盘版本，可选联动在未安装目标模组时也必须有效。[工作台契约](../mc-workbench/README.zh.md)。
