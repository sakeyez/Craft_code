# Agent Note: Minecraft check runner

Status: implemented

[English](2026-08-22-minecraft-check-runner.md) | 中文

## Problem

Minecraft 模组开发 agent 在项目检测之后需要可重复的验证选择。检测器可以推荐可能的 Gradle 命令，但如果每轮都让模型自己选择命令，agent 仍会手写 wrapper、loader、datagen 与 resource 检查规则；失败结果也只是非结构化 shell 文本。

## Decision

当已挂载的 composition 提供 `ctx.shell` 时，`@deepseek-ai/dsh-tool-mc-project` 注册 `run_mc_check`。该工具先调用包内检测逻辑，根据 workspace 证据选择 Gradle wrapper 或 `gradle`，把请求的 target 映射为 loader-aware task，并通过 `ctx.shell.run(ctx.shell.resolve(...))` 逐条运行 Gradle 命令。

runner 支持 `build`、`test`、`datagen`、`resources`、`runtime` 和 `all`。Fabric 与 NeoForge 支持 loader-specific datagen/runtime task 选择；Forge 与 Quilt 仅用于诊断，并会在这些 task 执行前安全失败。loader 证据未知或冲突时同样会在 loader-specific 执行前失败。`resources` 在 Gradle `processResources` 前运行静态 `validate_mc_resources` 检查；`all` 仅在支持范围内且检测到 datagen 线索时运行 datagen，然后运行 resources、test 与 build，并在第一处失败后停止。支持分类由[loader 范围 note](2026-08-23-minecraft-loader-support-scope.zh.md)维护。

结果是一个结构化 JSON 对象，包含计划中的 `commands`、每个 step 的退出与 sandbox facts、stdout/stderr 摘要、`failedStep` 和 `suggestedNextAction`。shell-level timeout、sandbox、subprocess 与 spill 行为仍由已挂载的 shell executor 拥有；`run_mc_check` 只用自己的内联字节上限摘要已经收集到的 stream tail。

## Alternatives considered

**继续只提供 shell 指引。** 拒绝，因为 agent 仍需每次把检测事实翻译成命令，失败也只会表现为普通 shell 输出，而不是稳定的步骤记录。

**选择命令前探测 Gradle task graph。** 拒绝用于 v1，因为 `gradle tasks` 可能运行 build logic、下载依赖，并且成本接近实际选择的检查。缺失 task 会作为所选命令的失败返回。

**直接通过 `ctx.subprocess` 运行。** 拒绝，因为这会绕过已配置 shell executor 的 sandbox、timeout、环境与输出保留策略。runner 是既有 shell 能力之上的编排器，不是 process provider。

**让 `resources` 只运行 Gradle task。** 拒绝，因为该包已经拥有 Gradle 编译可能漏掉的确定性 resource-reference 检查。在 `processResources` 前运行静态校验，可以让 agent 先得到精确资源失败，再进入更宽的构建步骤。

## Consequences

Minecraft agents 现在有一个用于常见验证 target 的单一工具，并能获得一致的失败定位。没有 `ctx.shell` 的 detection-only composition 不会出现该工具，因此只读部署仍保留更小的依赖集合。第一版不推断 subproject task path、included build、Maven build、自定义 launcher 或动态 Gradle task；这些场景会表现为项目证据不可用或普通 Gradle 命令失败。
