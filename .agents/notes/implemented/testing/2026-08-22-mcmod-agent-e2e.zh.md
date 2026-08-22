# Agent Note: mcmod agent 端到端 fixture

Status: implemented

[English](2026-08-22-mcmod-agent-e2e.md) | 中文

## 问题

mcmod profile 已有 prompt、bundle、项目检测、资源校验和检查 runner 覆盖，但没有单个测试证明随包 headless agent 能修改 Minecraft 项目，并随后通过面向模型的 Minecraft 工具校验结果。单元测试可以证明每个工具可用，却仍可能漏掉产品 CLI profile 初始化、Loader 组合、工具可见性和文件系统效果在同一次运行中的问题。

真实 Fabric build 不适合作为默认无密钥 fixture，因为它可能下载 Gradle、Minecraft jar、mappings 和 loader 依赖。可在 CI 中运行的证明需要保留同一条 agent 与工具路径，同时避免外部依赖解析。

## 决策

`examples/headless-agent/tests/mcmod.e2e.ts` 会创建最小 Fabric workspace，通过产品 CLI 启动 `dsh --profile mcmod`，并在 agent 外部验证最终世界。无密钥用例把 LLM route 替换为脚本化适配器。两个用例都会把部署自有的 Java LSP executable 替换成当前 Node binary，而 CLI、profile 初始化、Loader 树、文件工具、`detect_mc_project`、`validate_mc_resources`、`run_mc_check`、sandbox 模式和 session persistence 都保持真实。

该 fixture 的 Gradle wrapper 是本地且确定性的。`gradlew` 和 `gradlew.bat` 委托给 `gradle-fixture-check.mjs`；只有 agent 创建的 Java 注册、language 文件、item model 和占位 texture 存在且内部一致时，它才接受 `build` 任务。这样既保持 check runner 路径真实，又不让 CI 依赖 Gradle 或 Minecraft 下载。

有密钥 e2e 会在 `DEEPSEEK_API_KEY` 可用时使用真实 DeepSeek route。它断言相同的外部文件与 wrapper 结果，并检查持久化日志包含 Minecraft 工具调用。无密钥环境只跳过这个真实模型用例。

## 曾考虑的替代方案

- **只扩展 `tool-mc-project` 单元测试**——否决，因为这些测试不会启动产品 profile，不会覆盖模型可见的工具选择，不会持久化会话，也不能证明 agent 在校验前能编辑 workspace。
- **在无密钥 CI 中运行真实 Fabric Gradle build**——否决，因为依赖下载和缓存状态会让 fixture 变慢、不稳定或依赖网络。本地 wrapper 证明命令选择和编辑后的校验；真实项目 build 仍由具体项目自己的检查负责。
- **提交二进制 PNG fixture**——否决，因为这个场景下静态校验器只需要本地 texture 路径。文本占位文件让 fixture 保持小且可读 diff。

## 后果

mcmod profile 现在有一个通过组装后产品入口运行的 e2e：当 profile 不再暴露 Minecraft 工具、agent 无法创建预期文件，或 `run_mc_check build` 没有到达 wrapper 时，它会失败。无密钥证明不声称 Minecraft runtime compatibility 或依赖解析能力；这些仍属于具体项目中的真实 Gradle build。
