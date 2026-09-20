# minecraft/ — Minecraft agent 包

[English](README.md) | 中文

用于 DeepSeek Harness agent 组装的 Minecraft 领域包。

| 包 | 职责 | ctx key |
|---|---|---|
| [`mcmod-agent/`](mcmod-agent/README.zh.md) | 面向 agent preset 的纯提示词 Fabric 与 NeoForge Minecraft Java 模组开发指导 | —（仅提示词段落） |
| [`tool-mc-project/`](tool-mc-project/README.zh.md) | Minecraft 项目检测、静态资源校验与基于 shell 的 Gradle 检查编排工具 | —（仅工具） |
| [`tool-mc-bootstrap/`](tool-mc-bootstrap/README.zh.md) | “新模组”向导使用的宿主目录、模板、staging 与首次构建服务 | —（loopback 服务；无模型可见 Tool） |

这些领域包不替换核心 agent loop。它们与 profile bundle 和 preset 组合，复用既有的文件、搜索、shell、LSP、skill、压缩、权限和会话持久化能力系列。

新的 Minecraft 项目由宿主本地“新模组”向导初始化。模型可见的 profile 在向导生成项目、创建 Gradle Wrapper 并完成首次构建后才开始工作；随后 agent 只修改已有项目。

## 支持矩阵

| loader／项目类型 | 检测 | loader-specific 编辑与检查 |
|---|---|---|
| Fabric Java | 支持 | 支持；项目证据明确时可选择 `runDatagen` |
| NeoForge Java | 支持 | 支持；项目证据明确时可选择 `runData` |
| Forge 或 Quilt | 仅用于诊断 | 当前 profile 不支持 loader-specific 操作；通用 build、test 与资源检查仍可用 |
| Architectury | 仅用于诊断 | 当前 profile 不支持 loader-specific 编辑与检查，但通用检查仍可用 |
| 混合 loader、多模块或非模组项目 | 仅提供部分证据 | 不执行 loader-specific 编辑；agent 必须报告范围，并请求明确的迁移或项目专用工作流 |
