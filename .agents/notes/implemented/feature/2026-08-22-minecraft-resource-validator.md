# Agent Note: Minecraft resource validator

Status: implemented

English | [中文](2026-08-22-minecraft-resource-validator.zh.md)

## Problem

Minecraft mod resource mistakes often survive TypeScript/Java compilation and ordinary project detection. Invalid language, recipe, or tag JSON breaks at load time; item and block models can point at missing textures; blockstates can name models that do not exist; and asset/data namespaces can drift from the mod id declared in metadata. Prompt guidance asks the model to keep these files aligned, but without a structured check it must rediscover the same path rules by reading scattered resource files.

## Decision

`@deepseek-ai/dsh-tool-mc-project` registers the read-only `validate_mc_resources` tool beside `detect_mc_project`. The validator uses the same bounded workspace scan through `ctx.fs`, respects detected resource roots and mod id metadata, and falls back to conventional `src/*/resources` or top-level `assets`/`data` only when project detection finds no resource roots.

The validator returns one structured JSON object with `errors`, `warnings`, `checkedFiles`, and `detectedModId`. It parses `assets/<modid>/lang/**/*.json`, `assets/<modid>/models/item/**/*.json`, `assets/<modid>/models/block/**/*.json`, `assets/<modid>/blockstates/**/*.json`, `data/<namespace>/recipes/**/*.json`, and `data/<namespace>/tags/**/*.json`. It reports malformed JSON, local model texture references whose `assets/<namespace>/textures/<path>.png` file is absent, local blockstate model references whose `assets/<namespace>/models/<path>.json` file is absent, suspicious data namespaces, suspicious explicit `namespace:path` references, and asset namespaces that disagree with a unique high-confidence metadata mod id.

The check is deliberately static and conservative. It does not execute Gradle, run datagen, inspect Minecraft jars, read dependency resource packs, follow resource-pack priority rules, resolve generated runtime resources, or validate every Minecraft JSON schema. Missing vanilla or third-party namespace references are ignored unless the reference targets the current mod namespace.

## Alternatives considered

**Keep resource consistency as prompt-only guidance.** Rejected because the agent would still have no repeatable structured result for common load-time mistakes, and model-visible diagnosis would depend on how completely it happened to search resource folders.

**Invoke Gradle datagen or a Minecraft resource loader.** Rejected because those paths can download dependencies, run arbitrary build logic, require a pinned loader environment, and blur a cheap read-only check with build validation. The ordinary shell path remains available when a task needs project-specific validation.

**Validate full Minecraft JSON schemas.** Rejected for the first version because loader and Minecraft-version-specific data formats change frequently. The shipped tool checks only deterministic path and JSON-syntax relationships that do not require version-specific runtime semantics.

## Consequences

Minecraft agents can ask for a compact resource consistency report before or after editing assets and data files. The result is stable enough for tests and replay, while still avoiding false authority over resources supplied by Minecraft, dependencies, datagen, or runtime packs. Future work can add more deterministic checks when a concrete project surface justifies them.
