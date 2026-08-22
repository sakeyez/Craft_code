---
name: mixin-debugging
description: Use for Minecraft Mixin configuration, target resolution, injection failures, refmap issues, and loader-time debugging.
---

# Mixin Debugging

Use this skill when diagnosing or changing Mixin configs, mixin classes, injection points, target methods, accessors, invokers, or runtime mixin failures.

## Read First

- `fabric.mod.json` and every referenced mixin config
- Mixin JSON files, package declarations, compatibility level, refmap settings, and plugin entries
- Target classes and methods from local dependency sources, decompiled sources, generated sources, or LSP results
- Build logs, game logs, stack traces, and any existing mixin debug flags or run configs

Mixin targets and descriptors are Minecraft-version and mapping-sensitive. Confirm names and method signatures from the local project and dependencies before editing an injection.

## Agent Rules

- Diagnose from the exact error first: missing target, failed injection, descriptor mismatch, refmap problem, priority conflict, or classloading issue.
- Keep mixin package names, config entries, Java class names, and resource paths in sync.
- Prefer the narrowest injection that matches the project style; avoid speculative redirects or broad overwrite changes.
- Do not mix loader-specific mixin setup across Fabric, Forge, NeoForge, or Architectury.

## Common Traps

- Guessing target names from another Minecraft version or mapping set.
- Renaming a mixin class without updating JSON config.
- Fixing a refmap symptom while leaving Gradle or resource wiring inconsistent.

## Checks

Use the smallest command that reaches mixin application: project tests, `./gradlew build`, a focused run task, or a user-approved client/server launch. Inspect logs after the run; a successful compile alone may not prove an injection applies.
