---
name: neoforge-modding
description: Use for Minecraft NeoForge Java mod development tasks, including registry code, resources, data generation, Gradle checks, and version-specific API discipline.
---

# NeoForge Modding

Use this skill when a task changes or reviews a Minecraft NeoForge Java mod.

## Project Facts

Read the local project before changing behavior:

- `settings.gradle`, `settings.gradle.kts`, `build.gradle`, `build.gradle.kts`, and `gradle.properties`
- `src/main/resources/META-INF/neoforge.mods.toml`
- Java package roots, main mod class, mod id constants, registry helpers, and data-generation classes
- `src/main/resources/assets/<modid>/` and `src/main/resources/data/<modid>/`

Treat the pinned Minecraft and NeoForge versions as authoritative. If a version-specific API fact is not discoverable from the project, local dependencies, generated sources, or local documentation, ask for the missing source or documentation.

## Editing Rules

Keep Java registration, resources, generated data, and language keys aligned. A new item, block, creative tab entry, entity, menu, recipe, tag, loot table, or data component normally touches more than one file. Verify the namespace and registry name at each reference.

Prefer existing project patterns over generic examples. Reuse the project's registration helpers, event subscribers, deferred registers, datagen providers, package naming, and Gradle task names.

Do not mix Fabric, Forge, Architectury, and NeoForge APIs. If the project is not NeoForge, report that this preset's v1 scope is NeoForge Java mods unless the user asked for migration or analysis.

## Checks

Prefer the project's own Gradle wrapper. Useful checks usually include `./gradlew build`, project tests, `./gradlew runData`, or a focused datagen task. Running a client, downloading dependencies, or starting a long Gradle task can be expensive; explain that before starting it and use background jobs when the command needs to keep running.
