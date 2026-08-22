---
name: minecraft-resources
description: Use for Minecraft asset and data resource changes, including lang, models, blockstates, loot tables, recipes, tags, and namespace consistency.
---

# Minecraft Resources

Use this skill when adding, reviewing, or fixing files under Minecraft `assets/` or `data/` resource trees.

## Read First

- `src/main/resources/fabric.mod.json`, especially mod id and mixin declarations
- `src/main/resources/assets/<modid>/` and `src/main/resources/data/<modid>/`
- Java registry names, mod id constants, item/block/entity identifiers, and creative tab wiring
- Existing generated-resource output and datagen providers when resources are generated

Treat the discovered mod id and registry identifiers as authoritative. Do not invent namespace or path conventions from memory when the project already has examples.

## Agent Rules

- Keep registry ids, file paths, JSON references, language keys, model parents, blockstate variants, recipes, loot tables, and tags aligned.
- Preserve the project's generated-vs-handwritten split. If a file is generated, update the provider or ask before editing generated output directly.
- Validate JSON structure with project examples and local schemas or game docs when present; avoid version-specific fields unless the project proves them.
- Check every cross-reference after renaming or adding a resource.

## Common Traps

- Using the wrong namespace, singular/plural folder, or registry path.
- Adding a model without matching lang, blockstate, item model, loot, recipe, or tag files.
- Editing generated resources while leaving datagen providers stale.

## Checks

Use focused file inspection plus `./gradlew build` when available. Run `./gradlew runDatagen` or the project's focused datagen task when generated resources are involved.
