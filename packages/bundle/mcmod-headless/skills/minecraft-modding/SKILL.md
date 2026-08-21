---
name: minecraft-modding
description: Use for Minecraft Fabric-first Java mod development tasks, including registry code, resources, data generation, Gradle checks, and version-specific API discipline.
---

# Minecraft Modding

Use this skill when a task changes or reviews a Minecraft Java mod. The first supported implementation target is Fabric + Java + Minecraft 1.21.x when the project has not already made a loader or version decision.

## Project Facts

Read the local project before changing behavior:

- `settings.gradle`, `settings.gradle.kts`, `build.gradle`, `build.gradle.kts`, and `gradle.properties`
- `src/main/resources/fabric.mod.json`, or the corresponding metadata file for an existing non-Fabric project
- Java package roots, main mod class, mod id constants, mixin configs, registry helpers, and data-generation classes
- `src/main/resources/assets/<modid>/` and `src/main/resources/data/<modid>/`

Treat the pinned Minecraft version, loader, mappings, and Gradle plugin as authoritative. If a version-specific API fact is not discoverable from the project, local dependencies, generated sources, or local documentation, ask for the missing source or documentation.

## Editing Rules

Keep Java registration, resources, generated data, and language keys aligned. A new item, block, creative tab entry, entity, menu, recipe, tag, loot table, or data component normally touches more than one file. Verify the namespace and registry name at each reference.

Prefer existing project patterns over generic examples. Reuse the project's registration helpers, entrypoints, events, datagen providers, package naming, and Gradle task names.

Do not mix Fabric, Forge, NeoForge, and Architectury APIs. If the project has no loader decision, use Fabric APIs; if it already uses another loader, report the detected loader and do not introduce Fabric APIs unless the user asked for migration or analysis.

## Checks

Prefer the project's own Gradle wrapper. Useful checks usually include `./gradlew build`, project tests, `./gradlew runDatagen`, or a focused datagen task. Running a client, downloading dependencies, or starting a long Gradle task can be expensive; explain that before starting it.
