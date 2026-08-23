# Agent Note: mcmod agent 端到端 fixture

Status: implemented

[English](2026-08-22-mcmod-agent-e2e.md) | 中文

## 问题

mcmod profile 已有 prompt、bundle、项目检测、资源校验和检查 runner 覆盖，但没有单个测试证明随包 headless agent 能修改 Minecraft 项目，并随后通过面向模型的 Minecraft 工具校验结果。单元测试可以证明每个工具可用，却仍可能漏掉产品 CLI profile 初始化、Loader 组合、工具可见性和文件系统效果在同一次运行中的问题。

真实 Fabric 或 NeoForge build 不适合作为默认无密钥 fixture，因为它可能下载 Gradle、Minecraft jar、mappings 和 loader 依赖。可在 CI 中运行的证明需要保留同一条 agent 与工具路径，同时避免外部依赖解析；独立的真实构建场景在 Gradle 或依赖不可用时必须明确写出环境 skip 原因。

## 决策

`examples/headless-agent/tests/mcmod.e2e.ts` 会创建最小 Fabric 与 NeoForge workspace，通过产品 CLI 启动 `dsh --profile mcmod`，并在 agent 外部验证最终世界。无密钥用例把 LLM route 替换为脚本化适配器。每个用例都会把部署自有的 Java LSP executable 替换成当前 Node binary，而 CLI、profile 初始化、Loader 树、文件工具、`detect_mc_project`、`validate_mc_resources`、`run_mc_check`、sandbox 模式和 session persistence 都保持真实。

无密钥 fixture 使用本地确定性的 wiring wrapper，而不是 Gradle 实现。`gradlew` 和 `gradlew.bat` 委托给 Node 检查；只有 agent 创建的 Java 注册、loader metadata、language 文件、item model 和二进制 PNG 存在且内部一致时，它才接受请求的 `build` 或 `runData` task。这样保持 check runner 路径真实，但不声称编译或 Minecraft runtime 兼容性。独立的真实 Gradle fixture 使用固定的 wrapper/plugin/dependency 版本；宿主没有 Gradle 或依赖缓存时，测试会带出缺失前置条件并 skip。

有密钥 e2e 会在 `DEEPSEEK_API_KEY` 可用时使用真实 DeepSeek route。它断言相同的外部文件与 wrapper 结果，并检查持久化日志包含 Minecraft 工具调用。无密钥环境只跳过这个真实模型用例。

## 曾考虑的替代方案

- **只扩展 `tool-mc-project` 单元测试**——否决，因为这些测试不会启动产品 profile，不会覆盖模型可见的工具选择，不会持久化会话，也不能证明 agent 在校验前能编辑 workspace。
- **每次无密钥 CI 都运行真实 Fabric 或 NeoForge Gradle build**——否决，因为依赖下载和缓存状态会让 fixture 变慢、不稳定或依赖网络。本地 wiring wrapper 证明命令选择和编辑后的校验；真实项目 build 作为明确受环境控制的场景运行。
- **使用文本占位 texture**——否决，因为静态校验器必须拒绝伪装的 PNG。无密钥 fixture 携带一个很小的有效二进制 PNG。

## 后果

mcmod profile 现在有一个通过组装后产品入口运行的 e2e：当 profile 不再暴露 Minecraft 工具、agent 无法创建预期文件，或 `run_mc_check build` 没有到达 wrapper 时，它会失败。无密钥证明不声称 Minecraft runtime compatibility 或依赖解析能力；这些仍属于具体项目中的真实 Gradle build。
