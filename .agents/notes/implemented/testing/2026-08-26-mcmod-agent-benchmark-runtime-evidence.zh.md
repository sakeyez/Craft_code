# Agent Note: Benchmark runtime evidence and cost accounting

Status: implemented

[English](2026-08-26-mcmod-agent-benchmark-runtime-evidence.md) | 中文

## Problem

Minecraft 基准测试此前从错误的工作区路径读取会话，导致工具、耗时、重试和 Token 指标显示为零或不可用。静态检查也把源代码文本当成唯一的游戏行为证据，并把成本固定标为美元。

## Decision

基准测试读取每轮自有 `DSH_HOME` 中的全部 Zstandard 会话帧，记录捕获状态和事件数量，并保留脱敏后的解压日志。Agent 退出后，测试向工作区注入自有的无界面 server GameTest，独立构建并执行 `runGameTestServer`。运行时测试失败会使该轮失败；运行环境缺失则标记为 `inconclusive`。

Token 报告分别记录输入、输出、缓存读取、缓存写入和推理字段。价格表声明提供商、模型、币种和每百万 Token 价格；可选的实际支付金额与估算值分开对账。

## Alternatives considered

**使用 Agent 编写的测试：** 拒绝，因为被测 Agent 可以省略或弱化测试。

**客户端 GUI 冒烟测试：** 拒绝，因为可复现基准需要无界面服务器信号，不依赖图形环境。

**一个含义不明的总 Token 或美元字段：** 拒绝，因为缓存计量和用户使用的 DeepSeek 币种不能混用。

## Consequences

报告区分静态、构建、运行时、会话捕获和成本证据。当前 GameTest 提供确定性的服务器注册冒烟覆盖；未执行的行为仍明确标记为未验证。旧价格文件中的 `cache` 字段仍可读取，新报告使用 `cacheRead` 和 `cacheWrite`。
