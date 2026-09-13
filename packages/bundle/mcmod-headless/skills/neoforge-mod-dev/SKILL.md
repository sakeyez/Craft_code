---
name: neoforge-mod-dev
description: Use for NeoForge Java mod code and Gradle wiring, including @Mod entrypoints, DeferredRegister, registry objects, event buses, side separation, access transformers, mixins, and approved run tasks.
---

# NeoForge Mod Development

Use this skill for NeoForge Java implementation or project-wiring diagnosis and changes; detecting a NeoForge project alone does not require loading it. Keep the implementation on the project's pinned NeoForge and Minecraft versions; do not import Forge, Fabric, Architectury, or another version's API.

## Relevant evidence

This is task-specific guidance, not a checklist for every request. Read only the evidence needed for the affected behavior, reuse still-valid project facts, and expand when dependencies or errors require it. General questions and screenshot identification do not require this skill.

- `settings.gradle(.kts)`, `build.gradle(.kts)`, `gradle.properties`, version catalogs, included builds, and convention-plugin declarations
- the fixed ModDevGradle or other NeoForge Gradle plugin configuration
- `src/main/resources/META-INF/neoforge.mods.toml`
- the `@Mod` entry class, mod id constants, `DeferredRegister` declarations, registry objects, and event-bus subscriptions
- physical client/server entrypoints, logical-side checks, access transformers, mixin configs, run configurations, and tests

Treat project source, pinned dependency sources, generated sources, JDTLS results, and user-provided version-specific docs as authoritative. If the project uses a convention plugin or multi-module build, locate its owner before changing a leaf file.

## Agent Rules

- Register content through the existing `DeferredRegister` and registry-object pattern, then attach it to the correct mod event bus.
- Keep common, physical client, physical server, and logical-side code separated according to the project's existing setup. Do not load client-only classes on a dedicated server.
- Keep `neoforge.mods.toml`, `@Mod` id, Gradle properties, resource namespace, and Java identifiers aligned.
- Inspect access transformers and mixin configuration before changing visibility or injection behavior.
- Discover the project's actual `runClient` and `runServer` tasks. Ask the user for approval before launching either task; compilation, `test`, `processResources`, `runData`, and `build` remain distinct checks.
- Use `runData` for NeoForge datagen only when detection and project wiring support it. Never substitute Fabric `runDatagen` or Forge APIs.

## Common Traps

- Copying Forge examples into NeoForge without checking the pinned ModDevGradle API.
- Registering an object on the wrong event bus or touching client-only classes from common code.
- Changing `modId` in one metadata or resource path while leaving `@Mod`, registry names, or generated data unchanged.
- Assuming a root Gradle task reaches a subproject, included build, or convention plugin.

## Checks

Use the project's wrapper and fixed tasks: focused tests, `processResources`, `runData`, `build`, and any project-specific validation. Run approved `runClient`/`runServer` only when runtime behavior is necessary and the user has approved the launch.
