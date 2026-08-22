---
name: minecraft-datagen
description: Use for Minecraft data generation providers, generated resources, source-set wiring, runDatagen tasks, and generated-output verification.
---

# Minecraft Data Generation

Use this skill when adding or maintaining datagen providers, generated resource files, datagen Gradle wiring, or generated-output checks.

## Read First

- Gradle files and `gradle.properties`
- Datagen source sets, provider classes, run configs, and existing generated-resource directories
- `fabric.mod.json` and any datagen entrypoint declarations
- Existing resources under `assets/<modid>/` and `data/<modid>/` that providers own

Treat the project's datagen setup as authoritative. Fabric datagen APIs and provider constructors are version-sensitive; confirm them from local dependencies, existing providers, LSP results, generated sources, or user-provided docs.

## Agent Rules

- Extend existing providers and helper methods before creating a parallel datagen style.
- Keep provider output aligned with Java registry ids and handwritten resources.
- Do not edit generated output as the only source of truth unless the project has no provider for that file.
- When adding a provider, confirm it is registered in the project's datagen entrypoint or provider pack.

## Common Traps

- Updating generated JSON without updating the provider that will overwrite it.
- Forgetting to include a provider in the datagen initialization path.
- Assuming the task name, output directory, or source set without reading Gradle.

## Checks

Prefer `./gradlew runDatagen` or the project's focused datagen task, then inspect the generated diff. Run `./gradlew build` or tests when datagen output participates in compilation or packaging.
