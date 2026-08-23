# dsh-mcmod-agent

English | [中文](README.zh.md)

Prompt-only guidance for a Fabric and NeoForge Minecraft Java mod-development agent. It contributes system-prompt sections and owns no model-facing tools, services, session state, filesystem access, shell access, LSP provider, or permission policy.

The package is meant to be mounted from an [agent preset](../../preset/agent-presets/README.md). The surrounding preset and profile bundle choose the tools and providers; this package teaches the model how to use those capabilities for Minecraft Java mod work.

## Prompt sections

| Section | Purpose |
|---|---|
| `minecraft:identity` | Anchors work in the project root and requires loader, version, mappings, Gradle plugin, source set, and resource-root discovery. |
| `minecraft:scope` | Supports Fabric and NeoForge in one workflow; detects loader facts before APIs or datagen, with Fabric 1.21.x only as a blank-project default. |
| `minecraft:workflow` | Requires Gradle files, metadata, entrypoint, registries, event wiring, side separation, and mixin config reads before edits, then directs focused validation and approved run tasks. |
| `minecraft:resources` | Keeps registry names, namespaces, version-appropriate assets, data files, language keys, and generated data aligned while stating static-check limits. |
| `minecraft:version-discipline` | Prevents loader/version/mappings conflicts from becoming API guesses and prefers project facts, sources, and LSP results. |

The sections render at orders `40` through `44`, after persona text and before tool guidance.

## Config

This package has no config. Loader, JDTLS command, tool exposure, skill roots, compaction thresholds, and permission choices belong to the profile bundle or agent preset.

## Model Experience

### Minecraft Modding Guidance

#### What the model sees

The model sees the fixed prompt guidance below.

##### Minecraft prompt sections

```markdown
minecraft:identity — Identify loader, Minecraft version, mappings, Gradle plugin, source sets, and resource roots before acting.
minecraft:scope — Detect Fabric or NeoForge and report determined, unknown, or conflicting loader/version/mappings evidence before choosing APIs; only a genuinely blank project may use a provisional Fabric + Java + Minecraft 1.21.x default.
minecraft:workflow — Read Gradle files, loader metadata, entrypoint, registries, event wiring, side configuration, and mixin config before edits; verify with focused loader-appropriate Gradle tasks.
minecraft:resources — Keep Java registry names, namespaces, assets, data files, language keys, and generated data aligned.
minecraft:version-discipline — Do not mix Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs.
```

##### Tool schema

```markdown
This package contributes no tool schema.
```

#### Token effect

Fixed for every request made by an agent whose preset mounts this row. The token cost is the five prompt sections only; tool schemas and runtime context are owned by their own packages.

#### KV Cache effect

Prefix-stable for the life of the mounted preset. Different presets that omit or include this package establish different system-prompt prefixes from the first Minecraft section onward.

## Known Limitations and Deferred Work

- **Supported loaders** — Fabric and NeoForge Java projects are supported by the shared guidance. Forge, Architectury, mixed-loader, multi-module, convention-plugin, and non-mod projects require explicit scope reporting; the agent must not invent support from a partial scan.
- **Blank-project default** — Fabric + Java + Minecraft 1.21.x is only a provisional default for a genuinely blank project with no loader decision; it is not a stable API promise.
- **No documentation retrieval** — this package does not enable web search or a Minecraft documentation index. Version-specific API facts must come from the project, local dependencies, local documentation, or explicit user-provided material.
- **No Minecraft-specific tools** — file, search, shell, LSP, skills, compaction, permissions, and persistence are reused from the harness rather than wrapped by Minecraft-specific tools.
