---
name: neoforge-datagen
description: Use for NeoForge data generation, GatherDataEvent wiring, providers, generated resources, runData, processResources, and output verification.
---

# NeoForge Data Generation

Use this skill when the project is detected as NeoForge and a change affects generated assets, data, recipes, tags, loot, models, or datagen Gradle wiring.

## Read First

- pinned NeoForge/Minecraft versions, `settings.gradle(.kts)`, `build.gradle(.kts)`, `gradle.properties`, and version catalogs
- the `@Mod` entrypoint and the event-bus wiring for `GatherDataEvent`
- existing data providers, helper classes, output directories, and `neoforge.mods.toml`
- handwritten resources under `assets/<modid>/` and `data/<modid>/` that are not provider-owned

Confirm event names, provider constructors, and output paths from project sources, dependency sources, JDTLS, generated sources, or version-specific user docs. Do not infer NeoForge APIs from Forge or Fabric examples.

## Agent Rules

- Register providers on the event path used by this project and preserve existing `includeServer`, `includeClient`, and required-mod filtering decisions.
- Update the provider or its inputs when generated output changes; do not make generated JSON the only source of truth.
- Keep generated namespace, registry ids, model parents, textures, language keys, recipes, tags, and loot aligned with the `@Mod` id and Java registration.
- Run the project's `runData` task, inspect the generated diff, then run `processResources`, tests, or `build` as needed.
- Do not write Fabric `entrypoints.fabric-datagen`, `DataGeneratorEntrypoint`, or `runDatagen` into a NeoForge project.

## Common Traps

- Registering a provider on the wrong event bus or only in a client-only class.
- Assuming `runData` output paths from another NeoForge or Minecraft version.
- Editing generated files while leaving `GatherDataEvent` providers stale.

## Checks

Prefer the pinned wrapper and a focused sequence: `runData`, inspect the generated diff, `processResources`, then `test` or `build`. Do not launch `runClient` or `runServer` for datagen unless the user explicitly approves it.
