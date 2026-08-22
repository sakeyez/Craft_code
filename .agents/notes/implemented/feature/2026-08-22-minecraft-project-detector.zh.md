# Agent Note: Minecraft project detector

Status: implemented

[English](2026-08-22-minecraft-project-detector.md) | 中文

## Problem

Minecraft modding preset 要求模型在编辑前识别 loader、Minecraft 版本、mappings、source set、resources、mixins 与 datagen 线索。仅靠提示词时，这些事实仍散落在 Gradle 文件、mod metadata 和目录布局里，模型可能基于不完整读取猜测，或把常见 Fabric 模式当成当前仓库事实。

## Decision

`@deepseek-ai/dsh-tool-mc-project` 注册只读 `detect_mc_project` 工具。它通过 `ctx.fs` 扫描当前 session workspace，读取有界的 Gradle 与 metadata 文件，遍历有界的 source/resource root，并返回一个结构化 JSON 对象，包含 loader、Minecraft 版本、mappings、mod id 候选、Java/Kotlin 使用、source set、resource root、mixin config、datagen 线索、推荐验证命令、已检查路径与 warnings。

检测器提取证据；它不求值 Gradle，也不执行命令。缺失文件、解析失败、过大的候选文件、扫描上限、未知事实和 loader 证据冲突都会产生 warning，同时工具仍返回符合 schema 的结果。loader 证据冲突时，`loader` 设为 `unknown`，而不是选择某个 API family。

随包 `mcmod` Web preset 与 `mcmod-headless` profile 会把检测器挂在既有 file/search/shell/LSP/skill 工具旁边，因此两个 Minecraft 入口都能在编辑前取得同一份项目事实摘要。

## Alternatives considered

**只保留提示词检测。** 拒绝，因为模型可见请求仍只携带指令，而不是可重复的事实提取结果。提示词纪律不能把 loader 冲突、缺失 metadata 或扫描上限显式变成结构化数据。

**运行 Gradle task 来发现项目状态。** 拒绝用于检测器，因为 Gradle 可能下载依赖、运行任意 build logic，并且远慢于廉价的首次读取。工具只推荐验证命令；agent 获得上下文后，再通过普通 shell 路径决定是否执行。

**冲突时选择最强 loader 线索。** 拒绝，因为混合证据正是选择 Fabric、Forge、NeoForge 或 Quilt API 最危险的时候。返回带冲突 loader 的 `unknown` 会迫使下一步继续检查或询问，而不是静默混用 API。

## Consequences

Minecraft agents 现在拥有确定性的首轮项目摘要，易于测试和回放。该摘要保持保守：convention plugin、生成的 Gradle source set 与变量间接引用，只有在文本中留下直接线索时才会被检测。后续可以增加更多 metadata reader 或 Gradle 文本模式，而无需改变核心 agent loop。
