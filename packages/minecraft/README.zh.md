# minecraft/ — Minecraft agent 包

[English](README.md) | 中文

用于 DeepSeek Harness agent 组装的 Minecraft 领域包。

| 包 | 职责 | ctx key |
|---|---|---|
| [`mcmod-agent/`](mcmod-agent/README.zh.md) | 面向 agent preset 的纯提示词 Fabric-first Minecraft Java 模组开发指导 | —（仅提示词段落） |
| [`tool-mc-project/`](tool-mc-project/README.zh.md) | 只读 `detect_mc_project` 工具，报告 Gradle、metadata、source、resource、mixin、datagen 与验证命令线索 | —（仅工具） |

这些领域包不替换核心 agent loop。它们与 profile bundle 和 preset 组合，复用既有的文件、搜索、shell、LSP、skill、压缩、权限和会话持久化能力系列。
