# Agent Note: Minecraft loader support scope

Status: implemented

[English](2026-08-23-minecraft-loader-support-scope.md) | 中文

## Problem

Minecraft 检测器可以识别 Fabric、NeoForge、Forge 和 Quilt，但随包提示词与 skills 只支持 Fabric 和 NeoForge。因此 Forge、Quilt 或 Architectury 项目虽然被识别，仍可能获得 loader-specific task 推荐；Fabric metadata 还可能掩盖 Architectury 的 Gradle 证据。

## Decision

`detect_mc_project` 返回 `loaderSupport`，取值为 `supported`、`unsupported` 或 `unknown`。Fabric 与 NeoForge 属于支持范围；Forge、Quilt 与 Architectury 仅用于诊断。Architectury 具有明确的 Gradle/plugin/dependency 证据，并保持与 Fabric metadata 的分类独立；混合证据返回 unknown。loader-specific datagen 与 runtime 检查会拒绝 unsupported 项目，通用 build、test 与资源检查仍可用。提示词与包文档要求 agent 对 unsupported loader 停止 loader-specific 编辑。

可选的真实 Gradle fixture 会使用固定 loader API 编译代表性的 Fabric 与 NeoForge Java 源码，再运行 fixture datagen task。Gradle 或依赖解析不可用时仍会跳过。

## 考虑过的替代方案

保留 Forge、Quilt 或 Architectury 的 task 选择并只发出 warning 被拒绝，因为当前 profile 没有对应的编辑指导或集成覆盖。把所有已检测 loader 都视为 unknown 也被拒绝，因为 loader 证据仍可用于诊断与通用检查。

## Consequences

loader 证据仍可用于诊断，但不会静默扩大支持的 API 范围。以后加入 Forge、Quilt 或 Architectury 时，必须同时更新支持分类、skills、提示词与集成 fixture。
