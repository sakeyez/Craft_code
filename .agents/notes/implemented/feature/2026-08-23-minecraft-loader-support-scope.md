# Agent Note: Minecraft loader support scope

Status: implemented

English | [中文](2026-08-23-minecraft-loader-support-scope.zh.md)

## Problem

The Minecraft detector recognized Fabric, NeoForge, Forge, and Quilt, while the shipped prompt and skills only supported Fabric and NeoForge. A Forge, Quilt, or Architectury project could therefore look detected and still receive a loader-specific task recommendation; Fabric metadata could also hide Architectury Gradle evidence.

## Decision

`detect_mc_project` returns `loaderSupport` as `supported`, `unsupported`, or `unknown`. Fabric and NeoForge are supported; Forge, Quilt, and Architectury remain diagnostic-only. Architectury has explicit Gradle/plugin/dependency evidence and remains distinct from Fabric metadata; mixed evidence returns unknown. Loader-specific datagen and runtime checks refuse unsupported projects, while generic build, test, and resource checks remain available. The prompt and package documentation tell the agent to stop loader-specific edits for unsupported loaders.

The optional real Gradle fixtures compile representative Fabric and NeoForge Java sources with their pinned loader APIs before running the fixture datagen task. They still skip when Gradle or dependency resolution is unavailable.

## Alternatives considered

Keeping Forge, Quilt, or Architectury task selection enabled behind a warning was rejected because the profile has no corresponding edit guidance or integration coverage. Treating every detected loader as unknown was rejected because the evidence remains useful for diagnostics and generic checks.

## Consequences

Loader evidence remains useful for diagnosis without silently widening the supported API surface. The profile can add Forge, Quilt, or Architectury later by changing the support classification together with their skills, prompts, and integration fixtures.
