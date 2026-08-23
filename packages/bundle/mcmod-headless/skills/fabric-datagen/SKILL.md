---
name: fabric-datagen
description: Use for Fabric data-generation providers, generated resources, Fabric entrypoints, source-set wiring, runDatagen tasks, and generated-output verification.
---

# Fabric Data Generation

Use this skill when adding or maintaining Fabric datagen providers, generated resource files, datagen Gradle wiring, or generated-output checks. Confirm the project is Fabric before using Fabric APIs.

## Read First

- Gradle files, `gradle.properties`, pinned Minecraft/mappings versions, and the Loom configuration
- Fabric datagen source sets, provider classes, run configs, and existing generated-resource directories
- `fabric.mod.json` and `entrypoints.fabric-datagen`
- Existing resources under `assets/<modid>/` and `data/<modid>/` that providers own

Treat the project's datagen setup as authoritative. Provider APIs and constructors are version-sensitive; confirm them from local dependencies, existing providers, generated sources, LSP results, or user-provided version-specific docs.

## Agent Rules

- Extend existing providers and helper methods before creating a parallel datagen style.
- Keep provider output aligned with Java registry ids and handwritten resources.
- Do not edit generated output as the only source of truth unless the project has no provider for that file.
- Confirm every provider is registered in the Fabric datagen entrypoint or provider pack.
- Do not use `runData` or NeoForge/Forge event APIs in a Fabric project.

## Common Traps

- Updating generated JSON without updating the provider that will overwrite it.
- Forgetting to include a provider in the datagen initialization path.
- Assuming the task name, output directory, or source set without reading Gradle.

## Checks

Prefer the project Gradle wrapper. Run `./gradlew runDatagen` or the project's focused Fabric datagen task, inspect the generated diff, and run `./gradlew build` or tests when output participates in compilation or packaging.
