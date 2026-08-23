# Agent Note：Minecraft 检查运行器与运行时校验

状态：已实现

[English](2026-08-23-minecraft-check-runner-and-runtime.md) | 中文

## Problem

Minecraft 项目使用 loader 特定且由项目自定义的 Gradle task。固定猜测 `runDatagen` 或 `runData` 可能执行错误 task，或掩盖项目配置问题；agent 也没有明确的客户端/服务端运行时检查。静态资源检查还需要在不声称模拟 Minecraft 的前提下，有界地处理常见加载期错误。

## Decision

`detect_mc_project` 记录声明的 Gradle task 候选，并保留 loader、Minecraft 版本和 mappings 证据。`run_mc_check` 优先使用这些事实；只有 datagen 或已批准的 runtime task 无法确定时，才运行有界的 `tasks --all --console=plain` 探测。探测输出截断或候选有歧义时安全失败，并给出对应 task 类型的诊断。`runtime` target 要求明确提供 `runtimeMode`（`client` 或 `server`），只选择对应的常规或已发现 task。资源校验继续保持确定性和有界性，覆盖 JSON 关系与 PNG 结构，但不执行 Minecraft。

## Alternatives considered

**始终运行常规 task 名称。** 已拒绝，因为自定义 task 很常见，猜测 task 可能产生误导性结果。

**在进程内解析或执行完整 Gradle 模型。** 已拒绝，因为这需要项目级构建求值、依赖下载和任意构建逻辑；有界 task 列表让探测可观察且资源受控。

**把运行时启动隐式并入 all 检查。** 已拒绝，因为启动客户端或服务端成本高且有副作用；运行时模式必须由用户选择并批准。

工具的 `tools/pre-execute` waterfall 会为客户端/服务端启动返回 Harness approval 请求；拒绝发生在任何 Gradle 命令启动之前。无密钥 headless snapshot 在 Windows 上使用受限的 `bash` 兼容 fixture，使命令往返保持跨平台，同时不增加任意 shell 执行能力。

## Consequences

MC agent 现在可以校验更多真实项目布局，并在无法确定时报告不确定性而不是猜测。运行时检查成为显式且需用户批准的操作，拒绝批准时不会改动项目。这些检查仍不能替代真实 Minecraft 加载、游戏行为测试或特定 loader 版本的集成测试；真实 Gradle 行为必须在具有项目 wrapper 和依赖的环境中验证。
