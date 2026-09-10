# Agent Note: Minecraft 资源校验器

Status: implemented

[English](2026-08-22-minecraft-resource-validator.md) | 中文

## Problem

Minecraft 模组资源错误经常躲过 TypeScript/Java 编译和普通项目检测。无效 language、recipe 或 tag JSON 会在加载时失败；item 与 block model 可能指向不存在的 texture；blockstate 可能命名不存在的 model；asset/data namespace 也可能与 metadata 声明的 mod id 漂移。提示词会要求模型保持这些文件一致，但如果没有结构化检查，模型每次都要靠读取分散资源文件重新推断同一组路径规则。

## Decision

`@deepseek-ai/dsh-tool-mc-project` 在 `detect_mc_project` 旁边注册只读 `validate_mc_resources` 工具。校验器通过 `ctx.fs` 使用同一组有界 workspace 扫描，尊重检测到的 resource root 与 mod id metadata；只有当项目检测找不到 resource root 时，才回退到约定的 `src/*/resources` 或顶层 `assets`/`data`。

校验器返回一个结构化 JSON 对象，包含 `errors`、`warnings`、`checkedFiles` 和 `detectedModId`。它解析 `assets/<modid>/lang/**/*.json`、`assets/<modid>/models/item/**/*.json`、`assets/<modid>/models/block/**/*.json`、`assets/<modid>/blockstates/**/*.json`、1.21 之前的复数 data 目录与 1.21 起的单数 data 目录，以及 `assets/<namespace>/items/**/*.json`。metadata 解析失败会保留为校验错误。未带 namespace 的资源引用按 `minecraft` namespace 解析。确定 Minecraft 版本时，使用另一版本的 data 目录拼写会产生 warning；版本未知或只有范围时会检查两种拼写而不臆断。它报告格式错误的 JSON、空或结构无效的 PNG、本地 model parent 引用缺少 `assets/<namespace>/models/<path>.json` 文件、本地 model texture 引用缺少 `assets/<namespace>/textures/<path>.png` 文件、本地 blockstate model 引用缺少 `assets/<namespace>/models/<path>.json` 文件、可疑 data namespace、可疑显式 `namespace:path` 引用、已知低于 1.21.4 版本却使用新 item-definition 路径，或版本未知/只有范围/存在冲突时无法确定格式的 item-definition warning，以及 asset namespace 与唯一高置信 metadata mod id 不一致。

该检查刻意保持静态和保守。它只读取有界二进制数据检查 PNG 结构，不执行 Gradle，不运行 datagen，不检查 Minecraft jar，不读取依赖资源包，不跟随 resource-pack 优先级规则，不解析生成的运行时资源，也不校验每一种 Minecraft JSON schema。缺失的 vanilla 或第三方 namespace 引用会被忽略，除非引用目标属于当前 mod namespace。

检测会为资源校验保留 metadata 解析错误和有界读取 warning，项目检测结果 schema 保持不变。`run_mc_check` 遇到 metadata 错误时会让静态资源步骤失败，步骤通过时也会包含有界 warning 详情。检测结果只在同一次检查且尚未执行任何 Gradle 命令时复用；task discovery 与 datagen 都可能运行构建逻辑，因此它们之后的资源校验会重新扫描 workspace。

## Alternatives considered

**继续只用提示词指导资源一致性。** 已拒绝，因为 agent 仍然没有可重复的结构化结果来发现常见加载期错误，模型可见诊断也会取决于它当次是否完整搜索了资源目录。

**调用 Gradle datagen 或 Minecraft resource loader。** 已拒绝，因为这些路径可能下载依赖、运行任意构建逻辑、要求固定 loader 环境，并把廉价只读检查和构建验证混在一起。需要项目特定验证时，普通 shell 路径仍然可用。

**校验完整 Minecraft JSON schema。** 第一版已拒绝，因为 loader 与 Minecraft 版本相关的数据格式变化频繁。已交付工具只检查不需要版本特定运行时语义的确定性路径和 JSON 语法关系。

## Consequences

Minecraft agent 可以在编辑 assets 和 data 文件前后请求一份紧凑资源一致性报告。该结果足够稳定，便于测试和回放，同时不会对 Minecraft、依赖、datagen 或运行时资源包提供的资源伪造权威。后续可以在具体项目表面证明需要时，加入更多确定性检查。

包测试覆盖不同版本的 data 目录、隐式 vanilla 引用、格式错误的 metadata、有界 warning，以及 Gradle 执行后的重新扫描。keyless headless composition 会检查持久化工具结果中的资源错误与已检查路径；其接线 wrapper 不证明 Minecraft 编译或运行时加载。
