---
name: fabric-mod-dev
description: Use for Fabric Java mod code changes, Gradle/Loom setup, entrypoints, registries, events, and loader-specific implementation work.
---

# Fabric Mod Development

Use this skill when changing Java mod code or Fabric project wiring. If the project already uses Forge, NeoForge, Architectury, or another loader, report that fact and do not introduce Fabric APIs unless the user asked for migration.

## Read First

- `settings.gradle`, `settings.gradle.kts`, `build.gradle`, `build.gradle.kts`, and `gradle.properties`
- `src/main/resources/fabric.mod.json`
- Java package roots, main mod class, entrypoint classes, mod id constants, registry helpers, and event setup
- Existing tests, run configs, and generated-source or source-set declarations

Treat the pinned Minecraft version, Fabric Loader/API versions, mappings, Java version, and Loom plugin as authoritative. Confirm version-sensitive APIs from project source, local dependency sources, generated sources, LSP results, or user-provided docs before using them.

## Agent Rules

- Follow the project's existing registration helpers, naming, package layout, and source sets.
- Keep code changes aligned with resources and data files; a new registry object usually needs assets, language keys, recipes, tags, or datagen updates.
- Do not mix Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs.
- Ask or state the missing evidence when the local project does not prove an API, mapping name, or Gradle task.

## Common Traps

- Assuming Yarn, Mojmap, or intermediary names without checking the build.
- Editing only Java registration while leaving resource namespaces or generated data stale.
- Adding dependencies or Loom settings that conflict with the existing Gradle plugin and Minecraft version.

## Checks

Prefer the project Gradle wrapper. Useful checks include `./gradlew build`, project tests, `./gradlew runDatagen`, or the nearest focused Gradle task. On Windows, use the wrapper form supported by the active shell.
