# Agent Note: Minecraft 验证证据边界

Status: implemented

[English](2026-09-13-minecraft-validation-evidence.md) | 中文

## Problem

有界项目扫描和进程退出码可能看起来成功，但仍有文件或运行时测试没有被检查。Minecraft Gradle 项目也经常把资源目录声明在约定 source set 之外。

## Decision

Minecraft 项目检测会报告扫描完整性，纳入静态声明的 Gradle resource directory，并将确定版本下不会加载的资源位置视为 error。一次检查内的资源验证会复用检测快照，但在 datagen 或其他可能改变项目输入的操作后使其失效。benchmark 运行成功必须在报告中找到带名称的 GameTest 证据；证据缺失或含义不明确时返回 inconclusive。Gradle 输出保留有界首尾摘要，并在 shell 提供时保留 spill 路径。

## Alternatives considered

**把有界扫描和零退出码进程视为通过。** 不采用，因为遗漏资源和空运行时进程会造成虚假的确定性。

**求值所有 Gradle DSL 声明。** 不采用，因为完整求值会重复构建系统并引入不可控执行；支持静态字面量，动态声明明确标记为不完整。

**跨独立工具调用缓存检测。** 不采用，因为调用之间的文件修改无法在没有持久指纹时安全观察；复用限制在一次检查调用内，并在修改步骤后失效。

## Consequences

证据不完整时会变成 inconclusive 或 failed，减少误判通过，同时普通项目避免重复检测。动态 Gradle 配置和不同的运行时输出格式在没有静态证据时仍需要项目级检查。
